import { Prisma, type LeadIntent, type LeadStatus } from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { analyzeCustomerMessage } from '../ai/customer-message-analysis';
import type { AgentIntent } from '../ai/agent-result';
import { classifyCustomerScope } from '../ai/customer-scope';
import { prisma } from '../db/prisma';
import { applicationLogger } from '../http/logger';
import type { TenantContext, TenantScope } from '../tenancy/tenant-context';
import {
  qualifyLeadMessage,
  messageUsesPriorReference,
  type LeadQualificationResult,
} from './lead-qualification';
import {
  buildProvisionalLeadSummary,
  leadSummarySchema,
  runLeadSummaryWorker,
  type LeadSummary,
  type LeadSummaryExecutor,
} from './lead-summary';

const ACTIVE_LEAD_STATUSES: readonly LeadStatus[] = ['NEW', 'INTERESTED', 'QUALIFIED'];
const ACTIVE_STATUS_SET = new Set<LeadStatus>(ACTIVE_LEAD_STATUSES);

export type LeadOperationErrorCode = 'NOT_FOUND' | 'CONFLICT';

export class LeadOperationError extends Error {
  readonly code: LeadOperationErrorCode;

  constructor(code: LeadOperationErrorCode, message: string) {
    super(message);
    this.name = 'LeadOperationError';
    this.code = code;
  }
}

export interface CaptureLeadInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly detectedIntent?: AgentIntent;
}

export interface LeadCaptureResult {
  readonly qualification: LeadQualificationResult;
  readonly leadId: string | null;
  readonly created: boolean;
  readonly evidenceAdded: boolean;
  readonly summaryRequired: boolean;
}

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const mergeLeadIntent = (current: LeadIntent, incoming: LeadIntent): LeadIntent => {
  if (incoming === 'BOOKING_INTEREST' || incoming === 'PURCHASE_INTEREST') return incoming;
  return current;
};

const toSummaryDetails = (value: Prisma.JsonValue | null): LeadSummary | null => {
  const parsed = leadSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const persistQualifiedMessage = async (
  tenant: TenantScope,
  input: CaptureLeadInput,
  qualification: LeadQualificationResult,
) => prisma.$transaction(async transaction => {
  const message = await transaction.conversationMessage.findFirst({
    where: {
      id: input.messageId,
      businessId: tenant.businessId,
      conversationId: input.conversationId,
      senderType: 'CUSTOMER',
      conversation: {
        businessId: tenant.businessId,
        customerId: { not: null },
      },
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      sequence: true,
      conversation: { select: { customerId: true } },
    },
  });
  if (!message?.conversation.customerId) {
    throw new LeadOperationError('NOT_FOUND', 'Customer conversation message was not found.');
  }

  const activeLead = await transaction.lead.findFirst({
    where: {
      businessId: tenant.businessId,
      conversationId: input.conversationId,
      status: { in: [...ACTIVE_LEAD_STATUSES] },
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
  });

  if (!activeLead) {
    if (!qualification.qualifies) {
      return { leadId: null, created: false, evidenceAdded: false };
    }
    const lead = await transaction.lead.create({
      data: {
        businessId: tenant.businessId,
        customerId: message.conversation.customerId,
        conversationId: input.conversationId,
        status: 'NEW',
        intent: qualification.intent,
        lastActivityAt: message.createdAt,
      },
    });
    const previousMessage = messageUsesPriorReference(message.content)
      ? await transaction.conversationMessage.findFirst({
          where: {
            businessId: tenant.businessId,
            conversationId: input.conversationId,
            senderType: 'CUSTOMER',
            sequence: { lt: message.sequence },
          },
          orderBy: { sequence: 'desc' },
          select: { id: true, content: true },
        })
      : null;
    const previousScope = previousMessage
      ? classifyCustomerScope(previousMessage.content).scope
      : null;
    const previousIntent = previousMessage
      ? analyzeCustomerMessage(previousMessage.content).detectedIntent
      : null;
    const previousSupportsReference = previousMessage !== null &&
      previousScope === 'BUSINESS_RELATED' &&
      previousIntent !== null &&
      !['GENERAL_QUESTION', 'HUMAN_REQUEST', 'COMPLAINT', 'SUPPORT_REQUEST']
        .includes(previousIntent);

    await transaction.leadEvidence.createMany({
      data: [{
        businessId: tenant.businessId,
        leadId: lead.id,
        conversationId: input.conversationId,
        messageId: message.id,
        evidenceTypes: [...qualification.evidenceTypes],
      }, ...(previousSupportsReference ? [{
        businessId: tenant.businessId,
        leadId: lead.id,
        conversationId: input.conversationId,
        messageId: previousMessage.id,
        evidenceTypes: ['ITEM_OR_SERVICE' as const],
      }] : [])],
    });
    return { leadId: lead.id, created: true, evidenceAdded: true };
  }

  if (!qualification.qualifies || qualification.evidenceTypes.length === 0) {
    return { leadId: activeLead.id, created: false, evidenceAdded: false };
  }

  const evidence = await transaction.leadEvidence.createMany({
    data: [{
      businessId: tenant.businessId,
      leadId: activeLead.id,
      conversationId: input.conversationId,
      messageId: message.id,
      evidenceTypes: [...qualification.evidenceTypes],
    }],
    skipDuplicates: true,
  });
  if (evidence.count === 1) {
    await transaction.lead.update({
      where: {
        businessId_id: { businessId: tenant.businessId, id: activeLead.id },
      },
      data: {
        intent: mergeLeadIntent(activeLead.intent, qualification.intent),
        lastActivityAt: message.createdAt,
      },
    });
  }
  return {
    leadId: activeLead.id,
    created: false,
    evidenceAdded: evidence.count === 1,
  };
});

export const captureLeadFromCustomerMessage = async (
  tenant: TenantScope,
  input: CaptureLeadInput,
): Promise<LeadCaptureResult> => {
  const canonicalMessage = await prisma.conversationMessage.findFirst({
    where: {
      id: input.messageId,
      businessId: tenant.businessId,
      conversationId: input.conversationId,
      senderType: 'CUSTOMER',
    },
    select: { content: true },
  });
  if (!canonicalMessage) {
    throw new LeadOperationError('NOT_FOUND', 'Customer conversation message was not found.');
  }
  const detectedIntent = input.detectedIntent ??
    analyzeCustomerMessage(canonicalMessage.content).detectedIntent;
  const activeLead = await prisma.lead.findFirst({
    where: {
      businessId: tenant.businessId,
      conversationId: input.conversationId,
      status: { in: [...ACTIVE_LEAD_STATUSES] },
    },
    select: { id: true },
  });
  const qualification = qualifyLeadMessage({
    message: canonicalMessage.content,
    detectedIntent,
    hasActiveLead: activeLead !== null,
  });

  let persisted: Awaited<ReturnType<typeof persistQualifiedMessage>>;
  try {
    persisted = await persistQualifiedMessage(tenant, input, qualification);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    persisted = await persistQualifiedMessage(tenant, input, qualification);
  }

  if (persisted.leadId) {
    applicationLogger.info('Lead opportunity captured', {
      businessId: tenant.businessId,
      conversationId: input.conversationId,
      leadId: persisted.leadId,
      qualification: qualification.reasonCode,
      created: persisted.created,
      evidenceAdded: persisted.evidenceAdded,
    });
  }

  return {
    qualification,
    ...persisted,
    summaryRequired: persisted.created || persisted.evidenceAdded,
  };
};

export const refreshLeadSummary = async (
  tenant: TenantScope,
  leadId: string,
  executor?: LeadSummaryExecutor,
) => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId: tenant.businessId },
    include: {
      evidence: {
        where: { businessId: tenant.businessId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
        include: { message: { select: { content: true } } },
      },
    },
  });
  if (!lead) throw new LeadOperationError('NOT_FOUND', 'Lead was not found.');
  if (lead.evidence.length === 0) {
    throw new LeadOperationError('CONFLICT', 'Lead has no evidence to summarize.');
  }

  const summaryInput = {
    intent: lead.intent,
    evidence: [...lead.evidence].reverse().map(item => ({
      content: item.message.content,
      evidenceTypes: item.evidenceTypes,
    })),
  } satisfies Parameters<typeof runLeadSummaryWorker>[0];
  let summary: LeadSummary;
  try {
    summary = await runLeadSummaryWorker(summaryInput, executor);
  } catch (error) {
    if (lead.summary !== null) throw error;
    summary = buildProvisionalLeadSummary(summaryInput);
    applicationLogger.warn('Lead summary worker failed; stored grounded provisional summary', {
      businessId: tenant.businessId,
      conversationId: lead.conversationId,
      leadId: lead.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  const updated = await prisma.lead.updateMany({
    where: { id: lead.id, businessId: tenant.businessId },
    data: {
      summary: summary.summary,
      summaryDetails: summary,
      summaryUpdatedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new LeadOperationError('NOT_FOUND', 'Lead was not found.');

  applicationLogger.info('Lead summary refreshed', {
    businessId: tenant.businessId,
    conversationId: lead.conversationId,
    leadId: lead.id,
  });
  return summary;
};

const leadDto = (lead: {
  id: string;
  status: LeadStatus;
  intent: LeadIntent;
  statusSource: 'AUTOMATIC' | 'MANUAL';
  summary: string | null;
  summaryDetails: Prisma.JsonValue | null;
  lastActivityAt: Date;
  statusUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; whatsappPhone: string };
  conversation: {
    id: string;
    mode: 'AI' | 'HUMAN' | 'PAUSED';
    handoffReason: string | null;
  };
  evidence: Array<{
    id: string;
    evidenceTypes: readonly string[];
    createdAt: Date;
    message: { id: string; content: string; createdAt: Date };
  }>;
}) => ({
  id: lead.id,
  status: lead.status,
  intent: lead.intent,
  statusSource: lead.statusSource,
  summary: lead.summary,
  summaryDetails: toSummaryDetails(lead.summaryDetails),
  lastActivityAt: lead.lastActivityAt.toISOString(),
  statusUpdatedAt: lead.statusUpdatedAt.toISOString(),
  createdAt: lead.createdAt.toISOString(),
  updatedAt: lead.updatedAt.toISOString(),
  customer: lead.customer,
  conversation: lead.conversation,
  evidence: lead.evidence.map(item => ({
    id: item.id,
    evidenceTypes: item.evidenceTypes,
    createdAt: item.createdAt.toISOString(),
    message: {
      id: item.message.id,
      content: item.message.content,
      createdAt: item.message.createdAt.toISOString(),
    },
  })),
});

const dashboardInclude = {
  customer: { select: { id: true, whatsappPhone: true } },
  conversation: { select: { id: true, mode: true, handoffReason: true } },
  evidence: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { message: { select: { id: true, content: true, createdAt: true } } },
  },
} satisfies Prisma.LeadInclude;

export const createTenantLeadDashboardService = (tenant: TenantContext) => ({
  list: async (status?: LeadStatus) => {
    const leads = await prisma.lead.findMany({
      where: {
        businessId: tenant.businessId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      include: dashboardInclude,
    });
    leads.sort((left, right) => {
      const activeDifference = Number(ACTIVE_STATUS_SET.has(right.status)) -
        Number(ACTIVE_STATUS_SET.has(left.status));
      return activeDifference || right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    });
    return leads.map(leadDto);
  },

  getById: async (leadId: string) => {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, businessId: tenant.businessId },
      include: dashboardInclude,
    });
    return lead ? leadDto(lead) : null;
  },

  setStatus: async (leadId: string, status: LeadStatus) => {
    try {
      await prisma.$transaction(async transaction => {
        const existing = await transaction.lead.findFirst({
          where: { id: leadId, businessId: tenant.businessId },
        });
        if (!existing) throw new LeadOperationError('NOT_FOUND', 'Lead was not found.');

        const updated = await transaction.lead.updateMany({
          where: { id: leadId, businessId: tenant.businessId, updatedAt: existing.updatedAt },
          data: { status, statusSource: 'MANUAL', statusUpdatedAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new LeadOperationError('CONFLICT', 'Lead changed. Reload and try again.');
        }
        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'LEAD',
          targetId: leadId,
          action: 'STATUS_CHANGE',
          before: { status: existing.status, statusSource: existing.statusSource },
          after: { status, statusSource: 'MANUAL' },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new LeadOperationError(
          'CONFLICT',
          'This conversation already has another active Lead.',
        );
      }
      throw error;
    }

    applicationLogger.info('Lead status changed manually', {
      businessId: tenant.businessId,
      leadId,
      status,
      actorUserId: tenant.userId,
    });
    return (await createTenantLeadDashboardService(tenant).getById(leadId))!;
  },

  refreshSummary: async (leadId: string) => {
    await refreshLeadSummary(tenant, leadId);
    return (await createTenantLeadDashboardService(tenant).getById(leadId))!;
  },
});

export type TenantLeadDashboardService = ReturnType<
  typeof createTenantLeadDashboardService
>;
