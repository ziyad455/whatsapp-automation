import type {
  ConversationChannel,
  ConversationHandoffReason,
  ConversationMessage,
  ConversationMessageSenderType,
} from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantScope } from '../tenancy/tenant-context';
import { isExplicitFollowUpOptOut } from '../follow-ups/follow-up-policy';
import {
  pendingCustomerActionsSchema,
  type PendingCustomerAction,
} from '../ai/customer-capabilities';

export interface ConversationParticipantIdentity {
  readonly customerId?: string;
  readonly whatsappConnectionId?: string;
}

export interface AppendConversationMessageInput {
  readonly senderType: ConversationMessageSenderType;
  readonly content: string;
  readonly sentByBusinessUserId?: string;
  readonly whatsappMessageId?: string;
  readonly pendingActions?: readonly PendingCustomerAction[];
}

export interface CommitAutomatedReplyInput {
  readonly conversationId: string;
  readonly expectedControlVersion: number;
  readonly content: string;
  readonly pendingActions: readonly PendingCustomerAction[];
  readonly handoffReason: ConversationHandoffReason | null;
}

export interface CommitHumanReplyInput {
  readonly conversationId: string;
  readonly expectedControlVersion: number;
  readonly content: string;
  readonly membershipId: string;
}

export interface CommittedOutboundConversationMessage {
  readonly message: ConversationMessage;
  readonly transportMessageId: string;
  readonly controlVersion: number;
}

const directionFor = (senderType: ConversationMessageSenderType) =>
  senderType === 'CUSTOMER' ? 'INBOUND' as const : 'OUTBOUND' as const;

const pendingActionsValue = (
  pendingActions: readonly PendingCustomerAction[],
): Prisma.InputJsonValue =>
  pendingCustomerActionsSchema.parse(pendingActions)
    .map(action => ({ ...action })) as Prisma.InputJsonValue;

const hasPendingOutboundMessage = (
  transaction: Prisma.TransactionClient,
  businessId: string,
  conversationId: string,
): Promise<number> => transaction.whatsAppMessage.count({
  where: {
    businessId,
    direction: 'OUTBOUND',
    deliveryStatus: 'PENDING',
    conversationMessage: { conversationId },
  },
});

const reserveWhatsAppTransport = async (
  transaction: Prisma.TransactionClient,
  conversation: {
    readonly customerId: string | null;
    readonly whatsappConnectionId: string | null;
    readonly customer: { readonly whatsappPhone: string } | null;
  },
  businessId: string,
  conversationMessageId: string,
): Promise<string> => {
  if (
    !conversation.customerId ||
    !conversation.whatsappConnectionId ||
    !conversation.customer
  ) {
    throw new Error('The conversation has no WhatsApp transport identity.');
  }

  const transportMessage = await transaction.whatsAppMessage.create({
    data: {
      businessId,
      whatsappConnectionId: conversation.whatsappConnectionId,
      customerId: conversation.customerId,
      conversationMessageId,
      direction: 'OUTBOUND',
      recipientPhone: conversation.customer.whatsappPhone,
      deliveryStatus: 'PENDING',
    },
    select: { id: true },
  });
  return transportMessage.id;
};

export const createTenantConversationRepository = (tenant: TenantScope) => ({
  findById: (conversationId: string) =>
    prisma.conversation.findFirst({
      where: { id: conversationId, businessId: tenant.businessId },
    }),

  findByChannelParticipant: (
    channel: ConversationChannel,
    participantKey: string,
  ) =>
    prisma.conversation.findUnique({
      where: {
        businessId_channel_participantKey: {
          businessId: tenant.businessId,
          channel,
          participantKey,
        },
      },
    }),

  getOrCreateByChannelParticipant: async (
    channel: ConversationChannel,
    participantKey: string,
    identity: ConversationParticipantIdentity = {},
  ) => {
    const selector = {
      businessId_channel_participantKey: {
        businessId: tenant.businessId,
        channel,
        participantKey,
      },
    };
    const participantData = {
      ...(identity.customerId ? { customerId: identity.customerId } : {}),
      ...(identity.whatsappConnectionId
        ? { whatsappConnectionId: identity.whatsappConnectionId }
        : {}),
    };

    try {
      return await prisma.conversation.upsert({
        where: selector,
        update: participantData,
        create: {
          businessId: tenant.businessId,
          channel,
          participantKey,
          ...participantData,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const conversation = await prisma.conversation.findUnique({ where: selector });
      if (!conversation) throw error;
      return conversation;
    }
  },

  appendMessage: async (
    conversationId: string,
    input: AppendConversationMessageInput,
  ) => {
    const createdAt = new Date();
    return prisma.$transaction(async transaction => {
      if (input.senderType === 'CUSTOMER') {
        const participant = await transaction.conversation.findFirst({
          where: { id: conversationId, businessId: tenant.businessId },
          select: { channel: true, customerId: true },
        });
        if (participant?.channel === 'WHATSAPP' && participant.customerId) {
          await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
            hashtext(${tenant.businessId}), hashtext(${participant.customerId}))`;
        }
      }
      const conversation = await transaction.conversation.update({
        where: {
          businessId_id: {
            businessId: tenant.businessId,
            id: conversationId,
          },
        },
        data: {
          lastActivityAt: createdAt,
          messageCount: { increment: 1 },
          ...(input.pendingActions === undefined
            ? {}
            : { pendingActions: pendingActionsValue(input.pendingActions) }),
        },
        select: { messageCount: true, customerId: true, channel: true },
      });
      const message = await transaction.conversationMessage.create({
        data: {
          businessId: tenant.businessId,
          conversationId,
          sequence: conversation.messageCount,
          direction: directionFor(input.senderType),
          senderType: input.senderType,
          content: input.content,
          ...(input.sentByBusinessUserId
            ? { sentByBusinessUserId: input.sentByBusinessUserId }
            : {}),
          createdAt,
        },
      });

      if (input.senderType === 'CUSTOMER') {
        if (conversation.channel === 'WHATSAPP' && conversation.customerId &&
          isExplicitFollowUpOptOut(input.content)) {
          await transaction.customer.updateMany({
            where: { businessId: tenant.businessId, id: conversation.customerId },
            data: {
              followUpOptedOutAt: createdAt,
              marketingOptedOutAt: createdAt,
              marketingOptOutSource: 'CUSTOMER',
            },
          });
          await transaction.campaignRecipient.updateMany({
            where: {
              businessId: tenant.businessId,
              customerId: conversation.customerId,
              status: 'PENDING',
            },
            data: { status: 'SKIPPED', exclusionReasonCode: 'OPTED_OUT' },
          });
        }
        await transaction.followUp.updateMany({
          where: {
            businessId: tenant.businessId,
            conversationId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'CANCELLED',
            cancelledAt: createdAt,
            reasonCode: isExplicitFollowUpOptOut(input.content)
              ? 'CUSTOMER_OPTED_OUT' : 'CUSTOMER_REPLIED',
          },
        });
      }

      if (input.whatsappMessageId) {
        const linked = await transaction.whatsAppMessage.updateMany({
          where: {
            id: input.whatsappMessageId,
            businessId: tenant.businessId,
            conversationMessageId: null,
          },
          data: { conversationMessageId: message.id },
        });
        if (linked.count !== 1) {
          throw new Error('The WhatsApp transport message could not be linked.');
        }
      }

      return message;
    });
  },

  commitAutomatedReply: async (input: CommitAutomatedReplyInput) => {
    const createdAt = new Date();
    return prisma.$transaction(async transaction => {
      if (await hasPendingOutboundMessage(
        transaction,
        tenant.businessId,
        input.conversationId,
      )) {
        return null;
      }

      const claimed = await transaction.conversation.updateMany({
        where: {
          id: input.conversationId,
          businessId: tenant.businessId,
          mode: 'AI',
          status: 'OPEN',
          controlVersion: input.expectedControlVersion,
        },
        data: {
          lastActivityAt: createdAt,
          messageCount: { increment: 1 },
          pendingActions: input.handoffReason
            ? pendingActionsValue([])
            : pendingActionsValue(input.pendingActions),
          controlVersion: { increment: 1 },
          ...(input.handoffReason
            ? {
                mode: 'HUMAN' as const,
                handoffReason: input.handoffReason,
                assignedBusinessUserId: null,
                attentionSince: createdAt,
              }
            : {}),
        },
      });
      if (claimed.count !== 1) return null;

      if (input.handoffReason) {
        await transaction.followUp.updateMany({
          where: { businessId: tenant.businessId,
            conversationId: input.conversationId,
            status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'CANCELLED', cancelledAt: createdAt,
            reasonCode: 'HUMAN_MODE' },
        });
      }

      const conversation = await transaction.conversation.findUniqueOrThrow({
        where: {
          businessId_id: {
            businessId: tenant.businessId,
            id: input.conversationId,
          },
        },
        select: {
          messageCount: true,
          controlVersion: true,
          customerId: true,
          whatsappConnectionId: true,
          customer: { select: { whatsappPhone: true } },
        },
      });

      const message = await transaction.conversationMessage.create({
        data: {
          businessId: tenant.businessId,
          conversationId: input.conversationId,
          sequence: conversation.messageCount,
          direction: 'OUTBOUND',
          senderType: 'AI',
          content: input.content,
          createdAt,
        },
      });
      if (input.handoffReason) {
        await transaction.auditEvent.create({
          data: {
            businessId: tenant.businessId,
            actorKind: 'SYSTEM',
            targetType: 'CONVERSATION',
            targetId: input.conversationId,
            action: 'MODE_CHANGE',
            before: { mode: 'AI' },
            after: { mode: 'HUMAN', handoffReason: input.handoffReason },
          },
        });
      }
      const transportMessageId = await reserveWhatsAppTransport(
        transaction,
        conversation,
        tenant.businessId,
        message.id,
      );
      return {
        message,
        transportMessageId,
        controlVersion: conversation.controlVersion,
      } satisfies CommittedOutboundConversationMessage;
    });
  },

  commitHumanReply: async (input: CommitHumanReplyInput) => {
    const createdAt = new Date();
    return prisma.$transaction(async transaction => {
      if (await hasPendingOutboundMessage(
        transaction,
        tenant.businessId,
        input.conversationId,
      )) {
        return null;
      }

      const claimed = await transaction.conversation.updateMany({
        where: {
          id: input.conversationId,
          businessId: tenant.businessId,
          mode: 'HUMAN',
          status: 'OPEN',
          controlVersion: input.expectedControlVersion,
        },
        data: {
          assignedBusinessUserId: input.membershipId,
          lastActivityAt: createdAt,
          messageCount: { increment: 1 },
          controlVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return null;

      const conversation = await transaction.conversation.findUniqueOrThrow({
        where: {
          businessId_id: {
            businessId: tenant.businessId,
            id: input.conversationId,
          },
        },
        select: {
          messageCount: true,
          controlVersion: true,
          customerId: true,
          whatsappConnectionId: true,
          customer: { select: { whatsappPhone: true } },
        },
      });
      const message = await transaction.conversationMessage.create({
        data: {
          businessId: tenant.businessId,
          conversationId: input.conversationId,
          sequence: conversation.messageCount,
          direction: 'OUTBOUND',
          senderType: 'HUMAN',
          sentByBusinessUserId: input.membershipId,
          content: input.content,
          createdAt,
        },
      });
      const transportMessageId = await reserveWhatsAppTransport(
        transaction,
        conversation,
        tenant.businessId,
        message.id,
      );
      return {
        message,
        transportMessageId,
        controlVersion: conversation.controlVersion,
      } satisfies CommittedOutboundConversationMessage;
    });
  },

  escalateFailedAiRun: (conversationId: string, expectedControlVersion: number) =>
    prisma.$transaction(async transaction => {
      const escalated = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          businessId: tenant.businessId,
          mode: 'AI',
          status: 'OPEN',
          controlVersion: expectedControlVersion,
        },
        data: {
          mode: 'HUMAN',
          handoffReason: 'LOW_CONFIDENCE',
          assignedBusinessUserId: null,
          attentionSince: new Date(),
          pendingActions: pendingActionsValue([]),
          controlVersion: { increment: 1 },
        },
      });
      if (escalated.count === 1) {
        await transaction.auditEvent.create({
          data: {
            businessId: tenant.businessId,
            actorKind: 'SYSTEM',
            targetType: 'CONVERSATION',
            targetId: conversationId,
            action: 'MODE_CHANGE',
            before: { mode: 'AI' },
            after: { mode: 'HUMAN', handoffReason: 'LOW_CONFIDENCE' },
          },
        });
      }
      return escalated;
    }),

  listRecentMessages: async (
    conversationId: string,
    limit: number,
    excludeMessageId?: string,
  ) => {
    const messages = await prisma.conversationMessage.findMany({
      where: {
        businessId: tenant.businessId,
        conversationId,
        ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: limit,
    });

    return messages.reverse();
  },

  deleteById: (conversationId: string) =>
    prisma.conversation.deleteMany({
      where: { id: conversationId, businessId: tenant.businessId },
    }),
});

export type TenantConversationRepository = ReturnType<
  typeof createTenantConversationRepository
>;
