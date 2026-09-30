import { z } from 'zod';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { Prisma } from '../generated/prisma/client';
import type { TenantContext, TenantScope } from '../tenancy/tenant-context';

const scalarMetadataValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const lifecycleEventInputSchema = z.object({
  type: z.enum([
    'BOOKING_COMPLETED',
    'PURCHASE_COMPLETED',
    'MEMBERSHIP_STARTED',
    'MEMBERSHIP_EXPIRED',
    'SERVICE_COMPLETED',
  ]),
  occurredAt: z.union([
    z.date(),
    z.iso.datetime({ offset: true }).transform(value => new Date(value)),
  ]),
  relatedLeadId: z.uuid().optional(),
  relatedConversationId: z.uuid().optional(),
  relatedEntityId: z.uuid().optional(),
  metadata: z.record(z.string().min(1).max(80), scalarMetadataValueSchema).default({}),
}).strict().superRefine((value, context) => {
  if (value.type !== 'MEMBERSHIP_STARTED') return;
  const expiresAt = value.metadata.expiresAt;
  if (expiresAt !== undefined &&
    (typeof expiresAt !== 'string' || Number.isNaN(new Date(expiresAt).getTime()))) {
    context.addIssue({
      code: 'custom',
      path: ['metadata', 'expiresAt'],
      message: 'expiresAt must be an ISO date when provided',
    });
  }
});

export type LifecycleEventInput = z.input<typeof lifecycleEventInputSchema>;

export class CustomerLifecycleError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_RELATION',
    message: string,
  ) {
    super(message);
    this.name = 'CustomerLifecycleError';
  }
}

const relationExists = async (
  transaction: Prisma.TransactionClient,
  tenant: TenantScope,
  relation: 'lead' | 'conversation' | 'businessEntity',
  id: string | undefined,
): Promise<boolean> => {
  if (!id) return true;
  if (relation === 'lead') {
    return (await transaction.lead.count({
      where: { id, businessId: tenant.businessId },
    })) === 1;
  }
  if (relation === 'conversation') {
    return (await transaction.conversation.count({
      where: { id, businessId: tenant.businessId },
    })) === 1;
  }
  return (await transaction.businessEntity.count({
    where: { id, businessId: tenant.businessId },
  })) === 1;
};

export const listTenantCustomers = (tenant: TenantScope) =>
  prisma.customer.findMany({
    where: { businessId: tenant.businessId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      whatsappPhone: true,
      marketingConsentAt: true,
      marketingConsentSource: true,
      marketingOptedOutAt: true,
      marketingOptOutSource: true,
      _count: { select: { lifecycleEvents: true } },
    },
  });

export const listCustomerLifecycleHistory = async (
  tenant: TenantScope,
  customerId: string,
) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: tenant.businessId },
    select: {
      id: true,
      whatsappPhone: true,
      marketingConsentAt: true,
      marketingConsentSource: true,
      marketingOptedOutAt: true,
      marketingOptOutSource: true,
      lifecycleEvents: {
        where: { businessId: tenant.businessId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        include: {
          relatedLead: { select: { id: true, status: true } },
          relatedConversation: { select: { id: true } },
          relatedEntity: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!customer) throw new CustomerLifecycleError('NOT_FOUND', 'Customer was not found.');
  return customer;
};

export const createCustomerLifecycleEvent = async (
  tenant: TenantContext,
  customerId: string,
  rawInput: LifecycleEventInput,
) => {
  const input = lifecycleEventInputSchema.parse(rawInput);
  const event = await prisma.$transaction(async transaction => {
    const customer = await transaction.customer.findFirst({
      where: { id: customerId, businessId: tenant.businessId },
      select: { id: true },
    });
    if (!customer) throw new CustomerLifecycleError('NOT_FOUND', 'Customer was not found.');

    const relations = await Promise.all([
      relationExists(transaction, tenant, 'lead', input.relatedLeadId),
      relationExists(transaction, tenant, 'conversation', input.relatedConversationId),
      relationExists(transaction, tenant, 'businessEntity', input.relatedEntityId),
    ]);
    if (relations.some(exists => !exists)) {
      throw new CustomerLifecycleError(
        'INVALID_RELATION',
        'A related lifecycle record does not belong to this business.',
      );
    }

    return transaction.customerLifecycleEvent.create({
      data: {
        businessId: tenant.businessId,
        customerId,
        type: input.type,
        occurredAt: input.occurredAt,
        metadata: input.metadata,
        ...(input.relatedLeadId ? { relatedLeadId: input.relatedLeadId } : {}),
        ...(input.relatedConversationId
          ? { relatedConversationId: input.relatedConversationId }
          : {}),
        ...(input.relatedEntityId ? { relatedEntityId: input.relatedEntityId } : {}),
      },
    });
  });

  await attributeCampaignConversion(tenant, customerId, event.id, event.occurredAt);
  return event;
};

export const recordMarketingPreference = async (
  tenant: TenantContext,
  customerId: string,
  input: {
    readonly consent: boolean;
    readonly source: 'STAFF' | 'CUSTOMER' | 'PROVIDER';
    readonly evidence?: string;
  },
) => prisma.$transaction(async transaction => {
  await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
    hashtext(${tenant.businessId}), hashtext(${customerId}))`;
  const customer = await transaction.customer.findFirst({
    where: { id: customerId, businessId: tenant.businessId },
  });
  if (!customer) throw new CustomerLifecycleError('NOT_FOUND', 'Customer was not found.');

  const now = new Date();
  const updated = await transaction.customer.update({
    where: { businessId_id: { businessId: tenant.businessId, id: customerId } },
    data: input.consent ? {
      marketingConsentAt: now,
      marketingConsentSource: input.source,
      marketingConsentEvidence: input.evidence?.trim() || null,
      marketingOptedOutAt: null,
      marketingOptOutSource: null,
    } : {
      marketingOptedOutAt: now,
      marketingOptOutSource: input.source,
    },
    select: {
      id: true,
      marketingConsentAt: true,
      marketingConsentSource: true,
      marketingOptedOutAt: true,
      marketingOptOutSource: true,
    },
  });
  if (!input.consent) {
    await transaction.campaignRecipient.updateMany({
      where: {
        businessId: tenant.businessId,
        customerId,
        status: 'PENDING',
      },
      data: {
        status: 'SKIPPED',
        exclusionReasonCode: 'OPTED_OUT',
      },
    });
  }
  await appendTenantAuditEvent(transaction, tenant, {
    targetType: 'CUSTOMER',
    targetId: customerId,
    action: 'UPDATE',
    before: {
      marketingConsentAt: customer.marketingConsentAt,
      marketingOptedOutAt: customer.marketingOptedOutAt,
    },
    after: updated,
  });
  return updated;
});

const CONVERSION_ATTRIBUTION_DAYS = 30;

export const attributeCampaignConversion = async (
  tenant: TenantScope,
  customerId: string,
  lifecycleEventId: string,
  occurredAt: Date,
): Promise<boolean> => {
  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      businessId: tenant.businessId,
      customerId,
      status: 'SENT',
      convertedAt: null,
      sentAt: {
        lte: occurredAt,
        gte: new Date(occurredAt.getTime() - CONVERSION_ATTRIBUTION_DAYS * 86_400_000),
      },
    },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!recipient) return false;
  const updated = await prisma.campaignRecipient.updateMany({
    where: {
      id: recipient.id,
      businessId: tenant.businessId,
      customerId,
      convertedAt: null,
    },
    data: {
      convertedAt: occurredAt,
      conversionLifecycleEventId: lifecycleEventId,
    },
  });
  return updated.count === 1;
};

const REPLY_ATTRIBUTION_DAYS = 14;

export const attributeCampaignReply = async (
  tenant: TenantScope,
  customerId: string,
  repliedAt: Date,
): Promise<boolean> => {
  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      businessId: tenant.businessId,
      customerId,
      status: 'SENT',
      repliedAt: null,
      sentAt: {
        lte: repliedAt,
        gte: new Date(repliedAt.getTime() - REPLY_ATTRIBUTION_DAYS * 86_400_000),
      },
    },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!recipient) return false;
  const updated = await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, businessId: tenant.businessId, repliedAt: null },
    data: { repliedAt },
  });
  return updated.count === 1;
};
