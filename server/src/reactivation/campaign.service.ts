import { z } from 'zod';
import { prisma } from '../db/prisma';
import type { Campaign, CampaignTemplateStatus, Prisma } from '../generated/prisma/client';
import type { TenantContext, TenantScope } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';
import {
  evaluateCampaignRecipientEligibility,
  type CampaignEligibilityReason,
} from './campaign-compliance';
import {
  type TemplateVerificationResult,
  type VerifyCampaignTemplate,
  verifyMetaCampaignTemplate,
} from './meta-template-verifier';
import {
  previewReactivationSegment,
  reactivationSegmentSchema,
  type ReactivationSegment,
} from './reactivation-segment';

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  segmentDefinition: reactivationSegmentSchema,
  templateName: z.string().trim().regex(/^[a-z0-9_]+$/).max(512),
  templateLanguage: z.string().trim().min(2).max(35),
  templateBody: z.string().trim().min(1).max(4_096),
  templateParameters: z.array(z.string().trim().min(1).max(1_024)).max(20).default([]),
}).strict();

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export class CampaignOperationError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_TEMPLATE',
    message: string,
  ) {
    super(message);
    this.name = 'CampaignOperationError';
  }
}

const placeholders = (body: string): number[] =>
  [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));

export const renderCampaignTemplate = (
  body: string,
  parameters: readonly string[],
): string => {
  const used = [...new Set(placeholders(body))].sort((left, right) => left - right);
  const expected = parameters.map((_, index) => index + 1);
  if (used.length !== expected.length || used.some((value, index) => value !== expected[index])) {
    throw new CampaignOperationError(
      'INVALID_TEMPLATE',
      'Template placeholders must be sequential and have one supplied value each.',
    );
  }
  return parameters.reduce(
    (message, value, index) => message.replaceAll(`{{${index + 1}}}`, value),
    body,
  );
};

const parseParameters = (value: Prisma.JsonValue): string[] => {
  const parsed = z.array(z.string()).safeParse(value);
  if (!parsed.success) {
    throw new CampaignOperationError('INVALID_TEMPLATE', 'Campaign template parameters are invalid.');
  }
  return parsed.data;
};

const parseSegment = (value: Prisma.JsonValue): ReactivationSegment => {
  const parsed = reactivationSegmentSchema.safeParse(value);
  if (!parsed.success) {
    throw new CampaignOperationError('CONFLICT', 'Campaign segment definition is invalid.');
  }
  return parsed.data;
};

const verifyTemplate = async (
  campaign: Pick<Campaign, 'templateName' | 'templateLanguage'>,
  wabaId: string | null,
  verifier: VerifyCampaignTemplate,
): Promise<TemplateVerificationResult> => {
  if (!wabaId) return { approved: false, category: null, reason: 'NOT_FOUND' };
  return verifier({
    whatsappBusinessAccountId: wabaId,
    name: campaign.templateName,
    language: campaign.templateLanguage,
  });
};

const campaignSummaryInclude = {
  recipients: {
    select: {
      status: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      repliedAt: true,
      convertedAt: true,
    },
  },
} satisfies Prisma.CampaignInclude;

const toCampaignSummary = <T extends Campaign & {
  recipients: Array<{
    status: string;
    sentAt: Date | null;
    deliveredAt: Date | null;
    readAt: Date | null;
    repliedAt: Date | null;
    convertedAt: Date | null;
  }>;
}>(campaign: T) => ({
  ...campaign,
  metrics: {
    recipients: campaign.recipients.length,
    sent: campaign.recipients.filter(item => item.sentAt !== null).length,
    delivered: campaign.recipients.filter(item => item.deliveredAt !== null).length,
    read: campaign.recipients.filter(item => item.readAt !== null).length,
    replied: campaign.recipients.filter(item => item.repliedAt !== null).length,
    failed: campaign.recipients.filter(item => item.status === 'FAILED').length,
    converted: campaign.recipients.filter(item => item.convertedAt !== null).length,
  },
  recipients: undefined,
});

export interface CampaignPreviewRecipient {
  readonly customerId: string;
  readonly whatsappPhone: string;
  readonly matchedReasons: readonly string[];
  readonly eligibility: CampaignEligibilityReason;
}

export interface CampaignPreview {
  readonly campaignId: string;
  readonly finalMessage: string;
  readonly template: {
    readonly name: string;
    readonly language: string;
    readonly parameters: readonly string[];
    readonly status: CampaignTemplateStatus;
    readonly category: string | null;
  };
  readonly matchedCount: number;
  readonly eligibleCount: number;
  readonly recipients: readonly CampaignPreviewRecipient[];
  readonly warnings: readonly string[];
}

const previewCampaign = async (
  tenant: TenantScope,
  campaignId: string,
  verifier: VerifyCampaignTemplate,
  now = new Date(),
): Promise<CampaignPreview> => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, businessId: tenant.businessId },
    include: {
      business: { select: { lifecycleStatus: true } },
    },
  });
  if (!campaign) throw new CampaignOperationError('NOT_FOUND', 'Campaign was not found.');
  const parameters = parseParameters(campaign.templateParameters);
  const finalMessage = renderCampaignTemplate(campaign.templateBody, parameters);
  const segment = parseSegment(campaign.segmentDefinition);
  const matches = await previewReactivationSegment(tenant, segment, now);
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { businessId: tenant.businessId, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, whatsappBusinessAccountId: true },
  });

  let verification: TemplateVerificationResult;
  try {
    verification = await verifyTemplate(
      campaign,
      connection?.whatsappBusinessAccountId ?? null,
      verifier,
    );
  } catch {
    verification = { approved: false, category: null, reason: 'NOT_FOUND' };
  }
  const templateStatus: CampaignTemplateStatus = verification.approved
    ? 'APPROVED'
    : verification.reason === 'NOT_APPROVED' || verification.reason === 'NOT_MARKETING'
      ? 'REJECTED'
      : 'UNVERIFIED';
  await prisma.campaign.updateMany({
    where: { id: campaign.id, businessId: tenant.businessId, status: 'DRAFT' },
    data: {
      templateStatus,
      templateCategory: verification.category,
      templateVerifiedAt: new Date(),
    },
  });

  const customerIds = matches.map(match => match.customerId);
  const [customers, recentRecipients] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId: tenant.businessId, id: { in: customerIds } },
      select: {
        id: true,
        marketingConsentAt: true,
        marketingOptedOutAt: true,
        conversations: {
          where: { businessId: tenant.businessId, channel: 'WHATSAPP' },
          select: { mode: true, status: true },
        },
      },
    }),
    prisma.campaignRecipient.groupBy({
      by: ['customerId'],
      where: {
        businessId: tenant.businessId,
        customerId: { in: customerIds },
        status: 'SENT',
        sentAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
      },
      _count: { _all: true },
    }),
  ]);
  const customersById = new Map(customers.map(customer => [customer.id, customer]));
  const frequencyByCustomer = new Map(
    recentRecipients.map(item => [item.customerId, item._count._all]),
  );
  const recipients = matches.map(match => {
    const customer = customersById.get(match.customerId);
    const conversation = customer?.conversations[0];
    const eligibility = evaluateCampaignRecipientEligibility({
      businessActive: campaign.business.lifecycleStatus === 'ACTIVE',
      connectionActive: connection !== null,
      consentAt: customer?.marketingConsentAt ?? null,
      optedOutAt: customer?.marketingOptedOutAt ?? null,
      templateName: campaign.templateName,
      templateStatus,
      templateCategory: verification.category,
      customerEligible: customer !== undefined &&
        (conversation === undefined ||
          (conversation.mode === 'AI' && conversation.status === 'OPEN')),
      promotionalMessagesInWindow: frequencyByCustomer.get(match.customerId) ?? 0,
    });
    return { ...match, eligibility };
  });
  const warnings = [
    ...(connection ? [] : ['No active WhatsApp connection is available.']),
    ...(templateStatus === 'APPROVED'
      ? []
      : ['The marketing template is not currently verified as approved by Meta.']),
    ...(recipients.every(recipient => recipient.eligibility !== 'ELIGIBLE')
      ? ['No matched customer is currently eligible to receive this campaign.']
      : []),
  ];
  return {
    campaignId: campaign.id,
    finalMessage,
    template: {
      name: campaign.templateName,
      language: campaign.templateLanguage,
      parameters,
      status: templateStatus,
      category: verification.category,
    },
    matchedCount: recipients.length,
    eligibleCount: recipients.filter(recipient => recipient.eligibility === 'ELIGIBLE').length,
    recipients,
    warnings,
  };
};

export const createTenantCampaignService = (
  tenant: TenantContext,
  dependencies: { readonly verifyTemplate?: VerifyCampaignTemplate } = {},
) => {
  const verifier = dependencies.verifyTemplate ?? verifyMetaCampaignTemplate;
  return {
    list: async () => {
      const campaigns = await prisma.campaign.findMany({
        where: { businessId: tenant.businessId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: campaignSummaryInclude,
      });
      return campaigns.map(toCampaignSummary);
    },
    get: async (campaignId: string) => {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, businessId: tenant.businessId },
        include: {
          recipients: {
            where: { businessId: tenant.businessId },
            orderBy: [{ selectedAt: 'asc' }, { id: 'asc' }],
            include: {
              customer: { select: { id: true, whatsappPhone: true } },
            },
          },
        },
      });
      if (!campaign) throw new CampaignOperationError('NOT_FOUND', 'Campaign was not found.');
      return campaign;
    },
    create: async (rawInput: CampaignInput) => {
      requireBusinessPermission(tenant, 'CAMPAIGN_CREATE');
      const input = campaignInputSchema.parse(rawInput);
      renderCampaignTemplate(input.templateBody, input.templateParameters);
      return prisma.campaign.create({
        data: {
          businessId: tenant.businessId,
          name: input.name,
          segmentDefinition: input.segmentDefinition,
          templateName: input.templateName,
          templateLanguage: input.templateLanguage,
          templateBody: input.templateBody,
          templateParameters: input.templateParameters,
        },
      });
    },
    preview: (campaignId: string, now?: Date) =>
      previewCampaign(tenant, campaignId, verifier, now),
    prepare: async (campaignId: string, now = new Date()) => {
      requireBusinessPermission(tenant, 'CAMPAIGN_PREPARE');
      const preview = await previewCampaign(tenant, campaignId, verifier, now);
      if (preview.eligibleCount === 0) {
        throw new CampaignOperationError(
          'CONFLICT',
          'Campaign cannot be prepared because it has no eligible recipients.',
        );
      }
      await prisma.$transaction(async transaction => {
        const claimed = await transaction.campaign.updateMany({
          where: { id: campaignId, businessId: tenant.businessId, status: 'DRAFT' },
          data: { status: 'READY', approvedAt: now, failureReasonCode: null },
        });
        if (claimed.count !== 1) {
          throw new CampaignOperationError('CONFLICT', 'Only a draft campaign can be prepared.');
        }
        await transaction.campaignRecipient.deleteMany({
          where: { businessId: tenant.businessId, campaignId },
        });
        await transaction.campaignRecipient.createMany({
          data: preview.recipients.map(recipient => ({
            businessId: tenant.businessId,
            campaignId,
            customerId: recipient.customerId,
            status: recipient.eligibility === 'ELIGIBLE' ? 'PENDING' : 'SKIPPED',
            matchedReasons: [...recipient.matchedReasons],
            renderedMessage: preview.finalMessage,
            exclusionReasonCode: recipient.eligibility === 'ELIGIBLE'
              ? null
              : recipient.eligibility,
          })),
        });
      });
      return preview;
    },
    launch: async (campaignId: string, now = new Date()) => {
      requireBusinessPermission(tenant, 'CAMPAIGN_LAUNCH');
      const pending = await prisma.campaignRecipient.count({
        where: { businessId: tenant.businessId, campaignId, status: 'PENDING' },
      });
      if (pending === 0) {
        throw new CampaignOperationError('CONFLICT', 'Campaign has no pending recipients.');
      }
      const updated = await prisma.campaign.updateMany({
        where: { id: campaignId, businessId: tenant.businessId, status: 'READY' },
        data: { status: 'SENDING', launchedAt: now },
      });
      if (updated.count !== 1) {
        throw new CampaignOperationError('CONFLICT', 'Only a ready campaign can be launched.');
      }
      return { campaignId, status: 'SENDING' as const, pending };
    },
    cancel: async (campaignId: string, now = new Date()) => {
      requireBusinessPermission(tenant, 'CAMPAIGN_CANCEL');
      const updated = await prisma.$transaction(async transaction => {
        const changed = await transaction.campaign.updateMany({
          where: {
            id: campaignId,
            businessId: tenant.businessId,
            status: { in: ['DRAFT', 'READY', 'SENDING'] },
          },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
        if (changed.count !== 1) return false;
        await transaction.campaignRecipient.updateMany({
          where: { businessId: tenant.businessId, campaignId, status: 'PENDING' },
          data: { status: 'SKIPPED', exclusionReasonCode: 'OTHER_COMPLIANCE_BLOCK' },
        });
        return true;
      });
      if (!updated) {
        throw new CampaignOperationError('CONFLICT', 'Campaign cannot be cancelled in its current state.');
      }
      return { campaignId, status: 'CANCELLED' as const };
    },
  };
};
