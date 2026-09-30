import { prisma } from '../db/prisma';
import { applicationLogger } from '../http/logger';
import { sendWhatsAppText } from '../whatsapp/whatsapp-send.service';
import { markOutgoingWhatsAppMessageFailed } from '../whatsapp/whatsapp-message.repository';
import { WhatsAppSendError } from '../whatsapp/whatsapp-send.types';
import {
  businessFollowUpSettings,
} from './follow-up.service';
import {
  evaluateFollowUpGuard,
  nextMessagingWindowAt,
  type FollowUpGuardReason,
} from './follow-up-policy';

const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 2 * 60_000;
const BATCH_SIZE = 25;

export interface FollowUpWorkerDependencies {
  readonly sendText?: typeof sendWhatsAppText;
  readonly now?: () => Date;
}

const finish = async (
  id: string,
  businessId: string,
  status: 'CANCELLED' | 'FAILED',
  reasonCode: string,
  now: Date,
) => prisma.followUp.updateMany({
  where: { id, businessId, status: 'PROCESSING' },
  data: {
    status,
    reasonCode,
    ...(status === 'CANCELLED' ? { cancelledAt: now } : { failedAt: now }),
  },
});

export const processDueFollowUp = async (
  id: string,
  dependencies: FollowUpWorkerDependencies = {},
): Promise<'SKIPPED' | 'SENT' | 'DEFERRED' | 'CANCELLED' | 'FAILED'> => {
  const now = dependencies.now?.() ?? new Date();
  const claimed = await prisma.followUp.updateMany({
    where: { id, status: 'PENDING', scheduledAt: { lte: now } },
    data: {
      status: 'PROCESSING', claimedAt: now,
      attemptCount: { increment: 1 }, lastAttemptAt: now,
    },
  });
  if (claimed.count !== 1) return 'SKIPPED';

  const followUp = await prisma.followUp.findUniqueOrThrow({
    where: { id },
    include: { business: true, lead: true, conversation: true, customer: true },
  });
  const tenant = {
    businessId: followUp.businessId,
    whatsappConnectionId: followUp.conversation.whatsappConnectionId ?? '',
  };
  const latestCustomer = await prisma.conversationMessage.findFirst({
    where: {
      businessId: followUp.businessId,
      conversationId: followUp.conversationId,
      senderType: 'CUSTOMER',
    },
    orderBy: [{ sequence: 'desc' }],
    select: { createdAt: true,
      whatsappMessage: { select: { providerTimestamp: true } } },
  });
  const connection = followUp.conversation.whatsappConnectionId
    ? await prisma.whatsAppConnection.findFirst({
        where: {
          id: followUp.conversation.whatsappConnectionId,
          businessId: followUp.businessId,
          status: 'ACTIVE',
        },
        select: { id: true },
      })
    : null;
  const [sentForLead, latestSentForCustomer] = await Promise.all([
    prisma.followUp.count({
      where: { businessId: followUp.businessId, leadId: followUp.leadId, status: 'SENT' },
    }),
    prisma.followUp.findFirst({
      where: { businessId: followUp.businessId, customerId: followUp.customerId, status: 'SENT' },
      orderBy: [{ sentAt: 'desc' }], select: { sentAt: true },
    }),
  ]);
  if (!latestCustomer) {
    await finish(id, followUp.businessId, 'CANCELLED', 'CUSTOMER_REPLIED', now);
    return 'CANCELLED';
  }
  const settings = businessFollowUpSettings(followUp.business);
  const reason: FollowUpGuardReason = evaluateFollowUpGuard({
    now,
    customerActivityAt: followUp.customerActivityAt,
    latestCustomerMessageAt: latestCustomer.createdAt,
    latestCustomerProviderAt: latestCustomer.whatsappMessage?.providerTimestamp ??
      latestCustomer.createdAt,
    businessStatus: followUp.business.lifecycleStatus,
    settings,
    timezone: followUp.business.timezone,
    leadStatus: followUp.lead.status,
    conversationMode: followUp.conversation.mode,
    conversationStatus: followUp.conversation.status,
    consentAt: followUp.customer.followUpConsentAt,
    optedOutAt: followUp.customer.followUpOptedOutAt,
    connectionActive: connection !== null,
    sentForLead,
    lastCustomerFollowUpAt: latestSentForCustomer?.sentAt ?? null,
  });

  if (reason === 'QUIET_HOURS') {
    const next = nextMessagingWindowAt(now, followUp.business.timezone,
      settings.followUpWindowStartMinutes, settings.followUpWindowEndMinutes);
    await prisma.followUp.updateMany({
      where: { id, businessId: followUp.businessId, status: 'PROCESSING' },
      data: { status: 'PENDING', scheduledAt: next, claimedAt: null, reasonCode: reason,
        attemptCount: { decrement: 1 } },
    });
    return 'DEFERRED';
  }
  if (reason !== 'ELIGIBLE') {
    await finish(id, followUp.businessId,
      reason === 'CONNECTION_UNAVAILABLE' || reason === 'TEMPLATE_REQUIRED' ? 'FAILED' : 'CANCELLED',
      reason, now);
    return reason === 'CONNECTION_UNAVAILABLE' || reason === 'TEMPLATE_REQUIRED'
      ? 'FAILED' : 'CANCELLED';
  }

  // One canonical outbound message survives definite provider rejections and retries.
  const reserved = await prisma.$transaction(async transaction => {
    const current = await transaction.followUp.findFirst({
      where: { id, businessId: followUp.businessId, status: 'PROCESSING' },
      select: { conversationMessageId: true },
    });
    if (!current) return null;
    if (current.conversationMessageId) {
      const transport = await transaction.whatsAppMessage.findFirst({
        where: {
          businessId: followUp.businessId,
          conversationMessageId: current.conversationMessageId,
          direction: 'OUTBOUND', deliveryStatus: 'FAILED',
          failureCode: { in: ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'] },
        }, select: { id: true },
      });
      if (!transport) return null;
      await transaction.whatsAppMessage.update({
        where: { id: transport.id },
        data: { deliveryStatus: 'PENDING', failedAt: null, failureCode: null,
          failureTitle: null, failureDetails: null },
      });
      return transport.id;
    }
    const conversation = await transaction.conversation.update({
      where: { businessId_id: { businessId: followUp.businessId, id: followUp.conversationId } },
      data: { messageCount: { increment: 1 }, lastActivityAt: now },
      select: { messageCount: true },
    });
    const message = await transaction.conversationMessage.create({
      data: {
        businessId: followUp.businessId,
        conversationId: followUp.conversationId,
        sequence: conversation.messageCount,
        direction: 'OUTBOUND', senderType: 'SYSTEM',
        content: followUp.content,
      }, select: { id: true },
    });
    const transport = await transaction.whatsAppMessage.create({
      data: {
        businessId: followUp.businessId,
        whatsappConnectionId: tenant.whatsappConnectionId,
        customerId: followUp.customerId,
        conversationMessageId: message.id,
        direction: 'OUTBOUND', recipientPhone: followUp.customer.whatsappPhone,
        deliveryStatus: 'PENDING',
      }, select: { id: true },
    });
    await transaction.followUp.update({
      where: { id }, data: { conversationMessageId: message.id },
    });
    return transport.id;
  });
  if (!reserved) {
    await finish(id, followUp.businessId, 'FAILED', 'TRANSPORT_STATE_UNAVAILABLE', now);
    return 'FAILED';
  }

  // Cancellation wins until the atomic transition into the irrevocable external-send phase.
  const sending = await prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
      hashtext(${followUp.businessId}), hashtext(${followUp.customerId}))`;
    const otherActiveSend = await transaction.followUp.count({
      where: {
        businessId: followUp.businessId,
        customerId: followUp.customerId,
        id: { not: id },
        OR: [
          { status: 'SENDING' },
          { status: 'SENT', sentAt: {
            gte: new Date(now.getTime() -
              settings.minimumFollowUpIntervalMinutes * 60_000),
          } },
        ],
      },
    });
    if (otherActiveSend > 0) return 'FREQUENCY_LIMIT' as const;
    const transitioned = await transaction.followUp.updateMany({
      where: {
        id, businessId: followUp.businessId, status: 'PROCESSING',
        business: { followUpsEnabled: true, lifecycleStatus: 'ACTIVE' },
        lead: { status: { in: ['NEW', 'INTERESTED', 'QUALIFIED'] } },
        conversation: { mode: 'AI', status: 'OPEN',
          whatsappConnection: { status: 'ACTIVE' } },
        customer: { followUpConsentAt: { not: null }, followUpOptedOutAt: null },
      },
      data: { status: 'SENDING' },
    });
    return transitioned.count === 1 ? 'SENDING' as const : 'CANCELLED' as const;
  });
  if (sending !== 'SENDING') {
    await markOutgoingWhatsAppMessageFailed(tenant, reserved, {
      code: sending, title: 'Follow-up cancelled before provider send.',
    });
    await finish(id, followUp.businessId, 'CANCELLED', sending, now);
    return 'CANCELLED';
  }

  try {
    await (dependencies.sendText ?? sendWhatsAppText)({
      tenant, to: followUp.customer.whatsappPhone, text: followUp.content,
      reservedTransportMessageId: reserved,
      conversationMessageId: followUp.conversationMessageId ?? undefined,
    });
    await prisma.followUp.updateMany({
      where: { id, businessId: followUp.businessId, status: 'SENDING' },
      data: { status: 'SENT', sentAt: new Date(), reasonCode: null },
    });
    return 'SENT';
  } catch (error) {
    const definiteRetryable = error instanceof WhatsAppSendError &&
      ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(error.code);
    const retry = definiteRetryable && followUp.attemptCount < MAX_ATTEMPTS;
    const reasonCode = error instanceof WhatsAppSendError ? error.code : 'INDETERMINATE_ATTEMPT';
    await prisma.followUp.updateMany({
      where: { id, businessId: followUp.businessId, status: 'SENDING' },
      data: retry ? {
        status: 'PENDING', claimedAt: null, reasonCode,
        scheduledAt: new Date(now.getTime() + 60_000 * 2 ** followUp.attemptCount),
      } : { status: 'FAILED', failedAt: new Date(), reasonCode },
    });
    applicationLogger.warn('Follow-up transport attempt failed', {
      businessId: followUp.businessId, followUpId: id, reasonCode, retry,
    });
    return retry ? 'DEFERRED' : 'FAILED';
  }
};

export const processDueFollowUps = async (
  dependencies: FollowUpWorkerDependencies = {},
): Promise<{ processed: number; sent: number }> => {
  const now = dependencies.now?.() ?? new Date();
  await prisma.followUp.updateMany({
    where: {
      status: { in: ['PROCESSING', 'SENDING'] },
      claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    data: { status: 'FAILED', failedAt: now, reasonCode: 'INDETERMINATE_ATTEMPT' },
  });
  const due = await prisma.followUp.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: now } },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
    select: { id: true },
  });
  let sent = 0;
  for (const item of due) {
    try {
      if (await processDueFollowUp(item.id, dependencies) === 'SENT') sent += 1;
    } catch (error) {
      await prisma.followUp.updateMany({
        where: { id: item.id, status: { in: ['PROCESSING', 'SENDING'] } },
        data: { status: 'FAILED', failedAt: new Date(), reasonCode: 'INDETERMINATE_ATTEMPT' },
      });
      applicationLogger.error('Follow-up processing failed', {
        followUpId: item.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  return { processed: due.length, sent };
};
