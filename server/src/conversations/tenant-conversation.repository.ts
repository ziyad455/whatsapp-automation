import type {
  ConversationChannel,
  ConversationMessageRole,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

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

  getOrCreateByChannelParticipant: (
    channel: ConversationChannel,
    participantKey: string,
  ) =>
    prisma.conversation.upsert({
      where: {
        businessId_channel_participantKey: {
          businessId: tenant.businessId,
          channel,
          participantKey,
        },
      },
      update: {},
      create: {
        businessId: tenant.businessId,
        channel,
        participantKey,
      },
    }),

  appendMessage: async (
    conversationId: string,
    role: ConversationMessageRole,
    content: string,
  ) => {
    const createdAt = new Date();
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
});

export type TenantConversationRepository = ReturnType<
  typeof createTenantConversationRepository
>;
