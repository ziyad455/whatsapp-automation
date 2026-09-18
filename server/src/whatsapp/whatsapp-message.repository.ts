import type {
  Prisma,
  WhatsAppDeliveryStatus,
  WhatsAppInboundProcessingStatus,
} from '../generated/prisma/client';
import { Prisma as PrismaRuntime } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { InboundMessage, WhatsAppMessageStatusEvent } from './normalize-inbound-message';
import type { WhatsAppTenantContext } from './whatsapp-tenant-context';

export type InboundMessageClaim =
  | { readonly outcome: 'CLAIMED'; readonly messageId: string }
  | { readonly outcome: 'DUPLICATE' };

export const claimInboundWhatsAppMessage = async (
  tenant: WhatsAppTenantContext,
  customerId: string,
  message: InboundMessage,
): Promise<InboundMessageClaim> => {
  try {
    const created = await prisma.whatsAppMessage.create({
      data: {
        businessId: tenant.businessId,
        whatsappConnectionId: tenant.whatsappConnectionId,
        customerId,
        direction: 'INBOUND',
        externalMessageId: message.externalMessageId,
        processingStatus: 'RECEIVED',
        providerTimestamp: message.timestamp,
      },
      select: { id: true },
    });
    return Object.freeze({ outcome: 'CLAIMED', messageId: created.id });
  } catch (error) {
    if (
      error instanceof PrismaRuntime.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const reclaimed = await prisma.whatsAppMessage.updateMany({
        where: {
          businessId: tenant.businessId,
          whatsappConnectionId: tenant.whatsappConnectionId,
          customerId,
          direction: 'INBOUND',
          externalMessageId: message.externalMessageId,
          processingStatus: 'FAILED',
          conversationMessageId: null,
        },
        data: {
          processingStatus: 'RECEIVED',
          processingStartedAt: null,
          processingFailedAt: null,
          processedAt: null,
        },
      });
      if (reclaimed.count === 1) {
        const existing = await prisma.whatsAppMessage.findUniqueOrThrow({
          where: { externalMessageId: message.externalMessageId },
          select: { id: true },
        });
        return Object.freeze({ outcome: 'CLAIMED', messageId: existing.id });
      }
      return Object.freeze({ outcome: 'DUPLICATE' });
    }
    throw error;
  }
};

const transitionInboundProcessing = (
  tenant: WhatsAppTenantContext,
  messageId: string,
  from: readonly WhatsAppInboundProcessingStatus[],
  data: Prisma.WhatsAppMessageUpdateManyMutationInput,
) => prisma.whatsAppMessage.updateMany({
  where: {
    id: messageId,
    businessId: tenant.businessId,
    whatsappConnectionId: tenant.whatsappConnectionId,
    direction: 'INBOUND',
    processingStatus: { in: [...from] },
  },
  data,
});

export const startInboundWhatsAppMessageProcessing = (
  tenant: WhatsAppTenantContext,
  messageId: string,
) => transitionInboundProcessing(tenant, messageId, ['RECEIVED', 'FAILED'], {
  processingStatus: 'PROCESSING',
  processingStartedAt: new Date(),
  processingFailedAt: null,
});

export const markInboundWhatsAppMessageProcessed = (
  tenant: WhatsAppTenantContext,
  messageId: string,
) => transitionInboundProcessing(tenant, messageId, ['PROCESSING'], {
  processingStatus: 'PROCESSED',
  processedAt: new Date(),
});

export const markInboundWhatsAppMessageFailed = (
  tenant: WhatsAppTenantContext,
  messageId: string,
) => transitionInboundProcessing(tenant, messageId, ['PROCESSING'], {
  processingStatus: 'FAILED',
  processingFailedAt: new Date(),
});

export interface CreatePendingOutgoingWhatsAppMessageInput {
  readonly tenant: WhatsAppTenantContext;
  readonly customerId: string;
  readonly recipientPhone: string;
  readonly conversationMessageId?: string;
}

export const createPendingOutgoingWhatsAppMessage = (
  input: CreatePendingOutgoingWhatsAppMessageInput,
) => prisma.whatsAppMessage.create({
  data: {
    businessId: input.tenant.businessId,
    whatsappConnectionId: input.tenant.whatsappConnectionId,
    customerId: input.customerId,
    ...(input.conversationMessageId
      ? { conversationMessageId: input.conversationMessageId }
      : {}),
    direction: 'OUTBOUND',
    recipientPhone: input.recipientPhone,
    deliveryStatus: 'PENDING',
  },
  select: { id: true },
});

export const findPendingOutgoingWhatsAppMessage = (
  tenant: WhatsAppTenantContext,
  messageId: string,
  recipientPhone: string,
) => prisma.whatsAppMessage.findFirst({
  where: {
    id: messageId,
    businessId: tenant.businessId,
    whatsappConnectionId: tenant.whatsappConnectionId,
    direction: 'OUTBOUND',
    deliveryStatus: 'PENDING',
    recipientPhone,
  },
  select: { id: true },
});

export const markOutgoingWhatsAppMessageSent = async (
  tenant: WhatsAppTenantContext,
  messageId: string,
  externalMessageId: string,
  sentAt = new Date(),
): Promise<void> => {
  const updated = await prisma.whatsAppMessage.updateMany({
    where: {
      id: messageId,
      businessId: tenant.businessId,
      whatsappConnectionId: tenant.whatsappConnectionId,
      direction: 'OUTBOUND',
      deliveryStatus: 'PENDING',
    },
    data: {
      externalMessageId,
      deliveryStatus: 'SENT',
      sentAt,
    },
  });
  if (updated.count !== 1) {
    throw new Error('The pending WhatsApp message could not be marked as sent.');
  }
};

export const markOutgoingWhatsAppMessageFailed = async (
  tenant: WhatsAppTenantContext,
  messageId: string,
  failure: {
    readonly code: string;
    readonly title: string;
    readonly details?: string;
  },
  failedAt = new Date(),
): Promise<void> => {
  const updated = await prisma.whatsAppMessage.updateMany({
    where: {
      id: messageId,
      businessId: tenant.businessId,
      whatsappConnectionId: tenant.whatsappConnectionId,
      direction: 'OUTBOUND',
      deliveryStatus: 'PENDING',
    },
    data: {
      deliveryStatus: 'FAILED',
      failedAt,
      failureCode: failure.code.slice(0, 100),
      failureTitle: failure.title.slice(0, 500),
      failureDetails: failure.details?.slice(0, 1_000),
    },
  });
  if (updated.count !== 1) {
    throw new Error('The pending WhatsApp message could not be marked as failed.');
  }
};

export type WhatsAppStatusUpdateOutcome =
  | { readonly outcome: 'APPLIED'; readonly status: WhatsAppDeliveryStatus }
  | { readonly outcome: 'IGNORED'; readonly status: WhatsAppDeliveryStatus }
  | { readonly outcome: 'UNKNOWN' };

const transitionSourceStatuses: Record<
  WhatsAppMessageStatusEvent['status'],
  readonly WhatsAppDeliveryStatus[]
> = {
  SENT: ['PENDING'],
  DELIVERED: ['PENDING', 'SENT'],
  READ: ['PENDING', 'SENT', 'DELIVERED'],
  FAILED: ['PENDING', 'SENT'],
};

const statusUpdateData = (
  event: WhatsAppMessageStatusEvent,
): Prisma.WhatsAppMessageUpdateManyMutationInput => {
  switch (event.status) {
    case 'SENT':
      return { deliveryStatus: 'SENT', sentAt: event.timestamp };
    case 'DELIVERED':
      return { deliveryStatus: 'DELIVERED', deliveredAt: event.timestamp };
    case 'READ':
      return { deliveryStatus: 'READ', readAt: event.timestamp };
    case 'FAILED':
      return {
        deliveryStatus: 'FAILED',
        failedAt: event.timestamp,
        failureCode: event.failureCode,
        failureTitle: event.failureTitle,
        failureDetails: event.failureDetails,
      };
  }
};

const milestoneBackfill = (
  event: WhatsAppMessageStatusEvent,
): {
  readonly laterStatuses: readonly WhatsAppDeliveryStatus[];
  readonly missingField: 'sentAt' | 'deliveredAt';
  readonly data: Prisma.WhatsAppMessageUpdateManyMutationInput;
} | null => {
  if (event.status === 'SENT') {
    return {
      laterStatuses: ['DELIVERED', 'READ'],
      missingField: 'sentAt',
      data: { sentAt: event.timestamp },
    };
  }
  if (event.status === 'DELIVERED') {
    return {
      laterStatuses: ['READ'],
      missingField: 'deliveredAt',
      data: { deliveredAt: event.timestamp },
    };
  }
  return null;
};

export const applyWhatsAppMessageStatusEvent = async (
  tenant: WhatsAppTenantContext,
  event: WhatsAppMessageStatusEvent,
): Promise<WhatsAppStatusUpdateOutcome> => prisma.$transaction(async transaction => {
  const identity = {
    businessId: tenant.businessId,
    whatsappConnectionId: tenant.whatsappConnectionId,
    direction: 'OUTBOUND' as const,
    externalMessageId: event.externalMessageId,
    recipientPhone: event.recipientPhone,
  };
  const transitioned = await transaction.whatsAppMessage.updateMany({
    where: {
      ...identity,
      deliveryStatus: { in: [...transitionSourceStatuses[event.status]] },
    },
    data: statusUpdateData(event),
  });
  if (transitioned.count === 1) {
    return Object.freeze({ outcome: 'APPLIED', status: event.status });
  }

  const backfill = milestoneBackfill(event);
  if (backfill) {
    const backfilled = await transaction.whatsAppMessage.updateMany({
      where: {
        ...identity,
        deliveryStatus: { in: [...backfill.laterStatuses] },
        [backfill.missingField]: null,
      },
      data: backfill.data,
    });
    if (backfilled.count === 1) {
      const current = await transaction.whatsAppMessage.findFirstOrThrow({
        where: identity,
        select: { deliveryStatus: true },
      });
      return Object.freeze({
        outcome: 'APPLIED',
        status: current.deliveryStatus!,
      });
    }
  }

  const existing = await transaction.whatsAppMessage.findFirst({
    where: {
      businessId: tenant.businessId,
      whatsappConnectionId: tenant.whatsappConnectionId,
      direction: 'OUTBOUND',
      externalMessageId: event.externalMessageId,
    },
    select: { deliveryStatus: true, recipientPhone: true },
  });
  if (!existing || existing.recipientPhone !== event.recipientPhone) {
    return Object.freeze({ outcome: 'UNKNOWN' });
  }

  return Object.freeze({
    outcome: 'IGNORED',
    status: existing.deliveryStatus!,
  });
});

export const findTenantWhatsAppMessageByExternalId = (
  tenant: WhatsAppTenantContext,
  externalMessageId: string,
) => prisma.whatsAppMessage.findFirst({
  where: {
    businessId: tenant.businessId,
    whatsappConnectionId: tenant.whatsappConnectionId,
    externalMessageId,
  },
});
