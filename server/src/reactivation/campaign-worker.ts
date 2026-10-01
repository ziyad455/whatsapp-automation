import { prisma } from '../db/prisma';
import { signalOperationalFailure } from '../observability/operational-alerts';
import { applicationLogger } from '../http/logger';
import { resolveChannelConversation } from '../conversations/conversation.service';
import type { TenantScope } from '../tenancy/tenant-context';
import { WhatsAppSendError } from '../whatsapp/whatsapp-send.types';
import { nextSendAttempt } from '../whatsapp/retry-policy';
import { sendWhatsAppTemplate } from '../whatsapp/whatsapp-send.service';
import { evaluateCampaignRecipientEligibility } from './campaign-compliance';
import {
  verifyMetaCampaignTemplate,
  type VerifyCampaignTemplate,
} from './meta-template-verifier';

const BATCH_SIZE = 20;
const STALE_CLAIM_MS = 15 * 60_000;

export interface CampaignWorkerDependencies {
  readonly now?: () => Date;
  readonly verifyTemplate?: VerifyCampaignTemplate;
  readonly sendTemplate?: typeof sendWhatsAppTemplate;
}

const finishRecipient = async (
  id: string,
  businessId: string,
  status: 'FAILED' | 'SKIPPED',
  reasonCode: string,
  now: Date,
  expectedStatus: 'PENDING' | 'SENDING' = 'PENDING',
) => {
  await prisma.campaignRecipient.updateMany({
    where: { id, businessId, status: expectedStatus },
    data: {
      status,
      ...(status === 'FAILED'
        ? { failedAt: now, failureReasonCode: reasonCode }
        : { exclusionReasonCode: reasonCode }),
      claimedAt: null,
    },
  });
};

const verifyCurrentTemplate = async (
  recipient: {
    campaign: {
      templateName: string;
      templateLanguage: string;
    };
    businessId: string;
  },
  verifier: VerifyCampaignTemplate,
) => {
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { businessId: recipient.businessId, status: 'ACTIVE', outboundBlockedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { whatsappBusinessAccountId: true },
  });
  if (!connection) return { approved: false, category: null, reason: 'NOT_FOUND' as const };
  return verifier({
    whatsappBusinessAccountId: connection.whatsappBusinessAccountId,
    name: recipient.campaign.templateName,
    language: recipient.campaign.templateLanguage,
  });
};

export const processCampaignRecipient = async (
  id: string,
  dependencies: CampaignWorkerDependencies = {},
): Promise<'SENT' | 'SKIPPED' | 'FAILED' | 'DEFERRED'> => {
  const now = dependencies.now?.() ?? new Date();
  const initial = await prisma.campaignRecipient.findFirst({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now }, campaign: { status: 'SENDING' } },
    include: { campaign: true },
  });
  if (!initial) return 'SKIPPED';

  let verification;
  try {
    verification = await verifyCurrentTemplate(
      initial,
      dependencies.verifyTemplate ?? verifyMetaCampaignTemplate,
    );
  } catch {
    await finishRecipient(id, initial.businessId, 'FAILED', 'TEMPLATE_UNAVAILABLE', now);
    return 'FAILED';
  }
  const templateStatus = verification.approved ? 'APPROVED' as const :
    verification.reason === 'NOT_APPROVED' || verification.reason === 'NOT_MARKETING'
      ? 'REJECTED' as const
      : 'UNVERIFIED' as const;
  await prisma.campaign.updateMany({
    where: { id: initial.campaignId, businessId: initial.businessId, status: 'SENDING' },
    data: {
      templateStatus,
      templateCategory: verification.category,
      templateVerifiedAt: now,
    },
  });

  const tenant: TenantScope = Object.freeze({ businessId: initial.businessId });
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { businessId: initial.businessId, status: 'ACTIVE', outboundBlockedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const conversation = connection
    ? await resolveChannelConversation(tenant, {
        channel: 'WHATSAPP',
        participantKey: initial.customerId,
        customerId: initial.customerId,
        whatsappConnectionId: connection.id,
        createIfMissing: true,
      })
    : null;

  const claimed = await prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
      hashtext(${initial.businessId}), hashtext(${initial.customerId}))`;
    const current = await transaction.campaignRecipient.findFirst({
      where: {
        id,
        businessId: initial.businessId,
        status: 'PENDING',
        nextAttemptAt: { lte: now },
        campaign: { status: 'SENDING' },
      },
      include: {
        campaign: { include: { business: { select: { lifecycleStatus: true } } } },
        customer: true,
      },
    });
    if (!current) return { outcome: 'SKIPPED' as const };
    const recentSends = await transaction.campaignRecipient.count({
      where: {
        businessId: current.businessId,
        customerId: current.customerId,
        id: { not: current.id },
        OR: [
          { status: 'SENDING' },
          { status: 'SENT', sentAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
        ],
      },
    });
    const currentConversation = conversation ? await transaction.conversation.findFirst({
      where: { id: conversation.id, businessId: initial.businessId },
      select: { mode: true, status: true },
    }) : null;
    const eligibility = evaluateCampaignRecipientEligibility({
      businessActive: current.campaign.business.lifecycleStatus === 'ACTIVE',
      connectionActive: connection !== null,
      consentAt: current.customer.marketingConsentAt,
      optedOutAt: current.customer.marketingOptedOutAt,
      templateName: current.campaign.templateName,
      templateStatus,
      templateCategory: verification.category,
      customerEligible: currentConversation !== null &&
        currentConversation.mode === 'AI' && currentConversation.status === 'OPEN',
      promotionalMessagesInWindow: recentSends,
    });
    if (eligibility !== 'ELIGIBLE' || !connection || !conversation) {
      await transaction.campaignRecipient.update({
        where: { id: current.id },
        data: { status: 'SKIPPED', exclusionReasonCode: eligibility },
      });
      return { outcome: 'SKIPPED' as const };
    }

    let transportMessageId: string;
    if (current.conversationMessageId) {
      const transport = await transaction.whatsAppMessage.findFirst({
        where: {
          businessId: current.businessId,
          conversationMessageId: current.conversationMessageId,
          direction: 'OUTBOUND',
          deliveryStatus: 'FAILED',
          failureCode: { in: ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'] },
        },
        select: { id: true },
      });
      if (!transport) return { outcome: 'FAILED' as const, reason: 'TRANSPORT_STATE_UNAVAILABLE' };
      await transaction.whatsAppMessage.update({
        where: { id: transport.id },
        data: {
          deliveryStatus: 'PENDING',
          sendStartedAt: null,
          failedAt: null,
          failureCode: null,
          failureTitle: null,
          failureDetails: null,
        },
      });
      transportMessageId = transport.id;
    } else {
      const updatedConversation = await transaction.conversation.update({
        where: {
          businessId_id: {
            businessId: current.businessId,
            id: conversation.id,
          },
        },
        data: { messageCount: { increment: 1 }, lastActivityAt: now },
        select: { messageCount: true },
      });
      const message = await transaction.conversationMessage.create({
        data: {
          businessId: current.businessId,
          conversationId: conversation.id,
          sequence: updatedConversation.messageCount,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          content: current.renderedMessage,
        },
        select: { id: true },
      });
      const transport = await transaction.whatsAppMessage.create({
        data: {
          businessId: current.businessId,
          whatsappConnectionId: connection.id,
          customerId: current.customerId,
          conversationMessageId: message.id,
          direction: 'OUTBOUND',
          recipientPhone: current.customer.whatsappPhone,
          deliveryStatus: 'PENDING',
        },
        select: { id: true },
      });
      await transaction.campaignRecipient.update({
        where: { id: current.id },
        data: { conversationMessageId: message.id },
      });
      transportMessageId = transport.id;
    }

    const transitioned = await transaction.campaignRecipient.updateMany({
      where: {
        id: current.id,
        businessId: current.businessId,
        status: 'PENDING',
        customer: { marketingConsentAt: { not: null }, marketingOptedOutAt: null },
        campaign: { status: 'SENDING', business: { lifecycleStatus: 'ACTIVE' } },
      },
      data: {
        status: 'SENDING',
        claimedAt: now,
        attemptCount: { increment: 1 },
        exclusionReasonCode: null,
      },
    });
    return transitioned.count === 1
      ? {
          outcome: 'SENDING' as const,
          transportMessageId,
          customerPhone: current.customer.whatsappPhone,
          connectionId: connection.id,
          templateName: current.campaign.templateName,
          templateLanguage: current.campaign.templateLanguage,
          templateParameters: current.campaign.templateParameters,
          attemptCount: current.attemptCount + 1,
        }
      : { outcome: 'SKIPPED' as const };
  });

  if (claimed.outcome === 'SKIPPED') return 'SKIPPED';
  if (claimed.outcome === 'FAILED') {
    await finishRecipient(id, initial.businessId, 'FAILED', claimed.reason, now);
    return 'FAILED';
  }

  const parameters = Array.isArray(claimed.templateParameters) &&
    claimed.templateParameters.every(value => typeof value === 'string')
    ? claimed.templateParameters
    : null;
  if (!parameters) {
    await finishRecipient(id, initial.businessId, 'FAILED', 'INVALID_TEMPLATE', now, 'SENDING');
    return 'FAILED';
  }

  try {
    await (dependencies.sendTemplate ?? sendWhatsAppTemplate)({
      tenant: Object.freeze({
        businessId: initial.businessId,
        whatsappConnectionId: claimed.connectionId,
      }),
      to: claimed.customerPhone,
      template: {
        name: claimed.templateName,
        languageCode: claimed.templateLanguage,
        bodyParameters: parameters,
      },
      reservedTransportMessageId: claimed.transportMessageId,
    });
    await prisma.campaignRecipient.updateMany({
      where: { id, businessId: initial.businessId, status: 'SENDING' },
      data: { status: 'SENT', sentAt: new Date(), claimedAt: null, failureReasonCode: null },
    });
    return 'SENT';
  } catch (error) {
    const nextAttemptAt = nextSendAttempt(error, claimed.attemptCount, now);
    const retry = nextAttemptAt !== null;
    const reason = error instanceof WhatsAppSendError ? error.code : 'INDETERMINATE_ATTEMPT';
    await prisma.campaignRecipient.updateMany({
      where: { id, businessId: initial.businessId, status: 'SENDING' },
      data: retry ? {
        status: 'PENDING', claimedAt: null, failureReasonCode: reason,
        nextAttemptAt: nextAttemptAt!,
      } : {
        status: 'FAILED', claimedAt: null, failedAt: new Date(), failureReasonCode: reason,
      },
    });
    applicationLogger.warn('Campaign recipient transport attempt failed', {
      businessId: initial.businessId,
      campaignId: initial.campaignId,
      campaignRecipientId: id,
      reasonCode: reason,
      retry,
    });
    return retry ? 'DEFERRED' : 'FAILED';
  }
};

const finalizeCampaigns = async (campaignIds: readonly string[], now: Date): Promise<void> => {
  for (const campaignId of new Set(campaignIds)) {
    const active = await prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ['PENDING', 'SENDING'] } },
    });
    if (active === 0) {
      await prisma.campaign.updateMany({
        where: { id: campaignId, status: 'SENDING' },
        data: { status: 'COMPLETED', completedAt: now },
      });
    }
  }
};

export const processDueCampaignRecipients = async (
  dependencies: CampaignWorkerDependencies = {},
): Promise<{ processed: number; sent: number }> => {
  const now = dependencies.now?.() ?? new Date();
  const stale = await prisma.campaignRecipient.updateMany({
    where: {
      status: 'SENDING',
      claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    data: {
      status: 'FAILED',
      failedAt: now,
      claimedAt: null,
      failureReasonCode: 'INDETERMINATE_ATTEMPT',
    },
  });
  if (stale.count) signalOperationalFailure('STALE_ATTEMPT');
  const pending = await prisma.campaignRecipient.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now }, campaign: { status: 'SENDING' } },
    orderBy: [{ selectedAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
    select: { id: true, campaignId: true },
  });
  let sent = 0;
  for (const recipient of pending) {
    try {
      if (await processCampaignRecipient(recipient.id, dependencies) === 'SENT') sent += 1;
    } catch (error) {
      signalOperationalFailure('WORKFLOW_FAILURE');
      await prisma.campaignRecipient.updateMany({
        // This dispatcher has no claim token. Never finalize another worker's
        // in-flight send; uncertain SENDING claims use stale-attempt recovery.
        where: { id: recipient.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          claimedAt: null,
          failureReasonCode: 'INDETERMINATE_ATTEMPT',
        },
      });
      applicationLogger.error('Campaign recipient processing failed', {
        campaignRecipientId: recipient.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  const sendingCampaigns = await prisma.campaign.findMany({
    where: { status: 'SENDING' },
    select: { id: true },
  });
  await finalizeCampaigns(sendingCampaigns.map(item => item.id), now);
  return { processed: pending.length, sent };
};

export const syncCampaignRecipientTransportStatus = async (
  tenant: TenantScope,
  externalMessageId: string,
  _status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  _timestamp: Date,
): Promise<void> => {
  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      businessId: tenant.businessId,
      conversationMessage: {
        whatsappMessage: { externalMessageId },
      },
    },
    select: { id: true, conversationMessage: { select: { whatsappMessage: true } } },
  });
  if (!recipient) return;
  const transport = recipient.conversationMessage?.whatsappMessage;
  if (!transport) return;
  // Reconcile from the canonical ledger, including on webhook replay. A previous
  // projection failure must not be made permanent by inbound idempotency.
  for (const field of ['sentAt', 'deliveredAt', 'readAt'] as const) {
    if (transport[field]) await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, businessId: tenant.businessId, [field]: null },
      data: { [field]: transport[field] },
    });
  }
  if (transport.deliveryStatus === 'FAILED') await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, businessId: tenant.businessId, deliveredAt: null, readAt: null },
    data: { status: 'FAILED', failedAt: transport.failedAt, failureReasonCode: 'PROVIDER_FAILED' },
  });
};
