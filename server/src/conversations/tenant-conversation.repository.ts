import type {
  ConversationChannel,
  ConversationMessageRole,
} from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { pendingCustomerActionsSchema, type PendingCustomerAction } from '../ai/customer-capabilities';

export const createTenantConversationRepository = (tenant: TenantContext) => ({
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
  ) => {
    const identity = {
      businessId_channel_participantKey: {
        businessId: tenant.businessId,
        channel,
        participantKey,
      },
    };

    try {
      return await prisma.conversation.upsert({
        where: identity,
        update: {},
        create: {
          businessId: tenant.businessId,
          channel,
          participantKey,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const conversation = await prisma.conversation.findUnique({ where: identity });
      if (!conversation) throw error;
      return conversation;
    }
  },

  appendMessage: async (
    conversationId: string,
    role: ConversationMessageRole,
    content: string,
    state?: { readonly pendingActions: readonly PendingCustomerAction[] },
  ) => {
    const createdAt = new Date();
    const pendingActions = state
      ? pendingCustomerActionsSchema.parse(state.pendingActions).map(action => ({ ...action })) as Prisma.InputJsonValue
      : undefined;
    return prisma.$transaction(async transaction => {
      const conversation = await transaction.conversation.update({
        where: {
          businessId_id: {
            businessId: tenant.businessId,
            id: conversationId,
          },
        },
        data: {
          lastMessageAt: createdAt,
          messageCount: { increment: 1 },
          ...(pendingActions ? { pendingActions } : {}),
        },
        select: { messageCount: true },
      });
      return transaction.conversationMessage.create({
        data: {
          businessId: tenant.businessId,
          conversationId,
          sequence: conversation.messageCount,
          role,
          content,
          createdAt,
        },
      });
    });
  },

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
