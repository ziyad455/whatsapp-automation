import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type {
  ConversationMode,
  ConversationMessage,
  WhatsAppMessage,
} from '../generated/prisma/client';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  sendWhatsAppText,
  type PersistedWhatsAppSendResult,
} from '../whatsapp/whatsapp-send.service';
import type { WhatsAppTenantContext } from '../whatsapp/whatsapp-tenant-context';
import { createTenantConversationRepository } from './tenant-conversation.repository';

export type ConversationOperationErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_MODE'
  | 'CONFLICT'
  | 'UNAVAILABLE_CONNECTION';

export class ConversationOperationError extends Error {
  readonly code: ConversationOperationErrorCode;

  constructor(code: ConversationOperationErrorCode, message: string) {
    super(message);
    this.name = 'ConversationOperationError';
    this.code = code;
  }
}

interface AssignmentDto {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

interface ConversationMessageDto {
  readonly id: string;
  readonly sequence: number;
  readonly direction: ConversationMessage['direction'];
  readonly senderType: ConversationMessage['senderType'];
  readonly content: string;
  readonly createdAt: string;
  readonly sentBy: AssignmentDto | null;
  readonly transport: {
    readonly externalMessageId: string | null;
    readonly deliveryStatus: WhatsAppMessage['deliveryStatus'];
    readonly failureTitle: string | null;
  } | null;
}

const assignmentDto = (assignment: {
  id: string;
  userId: string;
  user: { name: string; email: string };
} | null): AssignmentDto | null => assignment
  ? {
      membershipId: assignment.id,
      userId: assignment.userId,
      name: assignment.user.name,
      email: assignment.user.email,
    }
  : null;

const messageDto = (message: ConversationMessage & {
  sentByBusinessUser: {
    id: string;
    userId: string;
    user: { name: string; email: string };
  } | null;
  whatsappMessage: Pick<
    WhatsAppMessage,
    'externalMessageId' | 'deliveryStatus' | 'failureTitle'
  > | null;
}): ConversationMessageDto => ({
  id: message.id,
  sequence: message.sequence,
  direction: message.direction,
  senderType: message.senderType,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  sentBy: assignmentDto(message.sentByBusinessUser),
  transport: message.whatsappMessage
    ? {
        externalMessageId: message.whatsappMessage.externalMessageId,
        deliveryStatus: message.whatsappMessage.deliveryStatus,
        failureTitle: message.whatsappMessage.failureTitle,
      }
    : null,
});

const messageInclude = {
  sentByBusinessUser: {
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  },
  whatsappMessage: {
    select: {
      externalMessageId: true,
      deliveryStatus: true,
      failureTitle: true,
    },
  },
} as const;

export const createTenantConversationInboxService = (tenant: TenantContext) => ({
  list: async () => {
    const conversations = await prisma.conversation.findMany({
      where: {
        businessId: tenant.businessId,
        channel: 'WHATSAPP',
        customerId: { not: null },
      },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      include: {
        customer: { select: { id: true, whatsappPhone: true } },
        assignedBusinessUser: {
          select: {
            id: true,
            userId: true,
            user: { select: { name: true, email: true } },
          },
        },
        messages: {
          orderBy: { sequence: 'desc' },
          take: 1,
          include: messageInclude,
        },
      },
    });

    return conversations.map(conversation => ({
      id: conversation.id,
      customer: {
        id: conversation.customer!.id,
        whatsappPhone: conversation.customer!.whatsappPhone,
      },
      mode: conversation.mode,
      status: conversation.status,
      handoffReason: conversation.handoffReason,
      attentionRequired: conversation.mode === 'HUMAN',
      assignment: assignmentDto(conversation.assignedBusinessUser),
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      latestMessage: conversation.messages[0]
        ? messageDto(conversation.messages[0])
        : null,
    }));
  },

  getById: async (conversationId: string) => {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        businessId: tenant.businessId,
        channel: 'WHATSAPP',
      },
      include: {
        customer: {
          select: {
            id: true,
            whatsappPhone: true,
            lifecycleEvents: {
              orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
              take: 3,
              select: { id: true, type: true, occurredAt: true },
            },
          },
        },
        assignedBusinessUser: {
          select: {
            id: true,
            userId: true,
            user: { select: { name: true, email: true } },
          },
        },
        messages: {
          orderBy: { sequence: 'asc' },
          include: messageInclude,
        },
      },
    });
    if (!conversation?.customer) return null;

    return {
      id: conversation.id,
      customer: {
        id: conversation.customer.id,
        whatsappPhone: conversation.customer.whatsappPhone,
      },
      mode: conversation.mode,
      status: conversation.status,
      handoffReason: conversation.handoffReason,
      attentionRequired: conversation.mode === 'HUMAN',
      assignment: assignmentDto(conversation.assignedBusinessUser),
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      messages: conversation.messages.map(messageDto),
      recentOutcomes: conversation.customer.lifecycleEvents.map(event => ({
        id: event.id,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  },

  setMode: async (conversationId: string, mode: ConversationMode) => {
    const nextState = mode === 'HUMAN'
      ? {
          mode,
          assignedBusinessUserId: tenant.membershipId,
          handoffReason: 'MANUAL' as const,
          attentionSince: new Date(),
        }
      : {
          mode,
          assignedBusinessUserId: null,
          handoffReason: null,
          attentionSince: null,
        };

    const changed = await prisma.$transaction(async transaction => {
      const existing = await transaction.conversation.findFirst({
        where: {
          id: conversationId,
          businessId: tenant.businessId,
          channel: 'WHATSAPP',
        },
      });
      if (!existing) {
        throw new ConversationOperationError('NOT_FOUND', 'Conversation was not found.');
      }
      if (mode !== 'AI' && existing.customerId) {
        await transaction.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(
          hashtext(${tenant.businessId}), hashtext(${existing.customerId}))`;
      }
      const pendingOutbound = await transaction.whatsAppMessage.count({
        where: {
          businessId: tenant.businessId,
          direction: 'OUTBOUND',
          deliveryStatus: 'PENDING',
          conversationMessage: { conversationId },
        },
      });
      if (pendingOutbound > 0) {
        throw new ConversationOperationError(
          'CONFLICT',
          'An outbound reply is still being sent. Reload and try again.',
        );
      }

      const updated = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          businessId: tenant.businessId,
          controlVersion: existing.controlVersion,
        },
        data: {
          ...nextState,
          pendingActions: [],
          controlVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;

      if (mode !== 'AI') {
        await transaction.followUp.updateMany({
          where: { businessId: tenant.businessId, conversationId,
            status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'CANCELLED', cancelledAt: new Date(),
            reasonCode: mode === 'HUMAN' ? 'HUMAN_MODE' : 'PAUSED' },
        });
      }

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'CONVERSATION',
        targetId: conversationId,
        action: 'MODE_CHANGE',
        before: {
          mode: existing.mode,
          handoffReason: existing.handoffReason,
          assignedBusinessUserId: existing.assignedBusinessUserId,
        },
        after: nextState,
      });
      return true;
    });

    if (!changed) {
      throw new ConversationOperationError(
        'CONFLICT',
        'Conversation control changed. Reload and try again.',
      );
    }
    return (await createTenantConversationInboxService(tenant).getById(conversationId))!;
  },

  sendManualReply: async (
    conversationId: string,
    content: string,
    dependencies: { readonly sendText?: typeof sendWhatsAppText } = {},
  ): Promise<{
    readonly message: ConversationMessageDto;
    readonly outbound: PersistedWhatsAppSendResult;
  }> => {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        businessId: tenant.businessId,
        channel: 'WHATSAPP',
      },
      include: { customer: true },
    });
    if (!conversation?.customer) {
      throw new ConversationOperationError('NOT_FOUND', 'Conversation was not found.');
    }
    if (conversation.mode !== 'HUMAN' || conversation.status !== 'OPEN') {
      throw new ConversationOperationError(
        'INVALID_MODE',
        'Take over this open conversation before sending a manual reply.',
      );
    }
    if (!conversation.whatsappConnectionId) {
      throw new ConversationOperationError(
        'UNAVAILABLE_CONNECTION',
        'This conversation has no active WhatsApp connection.',
      );
    }

    const repository = createTenantConversationRepository(tenant);
    const committed = await repository.commitHumanReply({
      conversationId: conversation.id,
      expectedControlVersion: conversation.controlVersion,
      content,
      membershipId: tenant.membershipId,
    });
    if (!committed) {
      throw new ConversationOperationError(
        'CONFLICT',
        'Conversation control changed. Reload before replying.',
      );
    }
    const whatsappTenant: WhatsAppTenantContext = Object.freeze({
      businessId: tenant.businessId,
      whatsappConnectionId: conversation.whatsappConnectionId,
    });
    const sendText = dependencies.sendText ?? sendWhatsAppText;
    const outbound = await sendText({
      tenant: whatsappTenant,
      to: conversation.customer.whatsappPhone,
      text: content,
      conversationMessageId: committed.message.id,
      reservedTransportMessageId: committed.transportMessageId,
    });
    const persisted = await prisma.conversationMessage.findFirstOrThrow({
      where: { id: committed.message.id, businessId: tenant.businessId },
      include: messageInclude,
    });

    return { message: messageDto(persisted), outbound };
  },
});

export type TenantConversationInboxService = ReturnType<
  typeof createTenantConversationInboxService
>;
