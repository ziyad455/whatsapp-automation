import { z } from 'zod';
import type {
  Conversation,
  ConversationChannel,
} from '../generated/prisma/client';
import type { TenantScope } from '../tenancy/tenant-context';
import {
  createTenantConversationRepository,
  type TenantConversationRepository,
} from './tenant-conversation.repository';

const conversationIdentitySchema = z.object({
  channel: z.enum(['DASHBOARD', 'WHATSAPP']),
  participantKey: z.string().trim().min(1).max(200),
  customerId: z.uuid().optional(),
  whatsappConnectionId: z.uuid().optional(),
  requestedConversationId: z.uuid().optional(),
  createIfMissing: z.boolean(),
}).strict().superRefine((value, context) => {
  const hasWhatsAppIdentity = Boolean(value.customerId && value.whatsappConnectionId);
  if (value.channel === 'WHATSAPP' && !hasWhatsAppIdentity) {
    context.addIssue({
      code: 'custom',
      message: 'WhatsApp conversations require trusted customer and connection identities.',
    });
  }
  if (value.channel === 'DASHBOARD' && (value.customerId || value.whatsappConnectionId)) {
    context.addIssue({
      code: 'custom',
      message: 'Dashboard simulation conversations cannot use WhatsApp identities.',
    });
  }
});

export type ConversationReference = Pick<
  Conversation,
  | 'id'
  | 'businessId'
  | 'channel'
  | 'participantKey'
  | 'pendingActions'
  | 'mode'
  | 'status'
  | 'controlVersion'
>;

export interface ResolveChannelConversationInput {
  readonly channel: ConversationChannel;
  readonly participantKey: string;
  readonly customerId?: string;
  readonly whatsappConnectionId?: string;
  readonly requestedConversationId?: string;
  readonly createIfMissing: boolean;
}

export const resolveChannelConversation = async (
  tenant: TenantScope,
  input: ResolveChannelConversationInput,
  repository: TenantConversationRepository = createTenantConversationRepository(tenant),
): Promise<Conversation | null> => {
  const identity = conversationIdentitySchema.parse(input);

  if (identity.requestedConversationId) {
    const conversation = await repository.findById(identity.requestedConversationId);

    if (
      !conversation ||
      conversation.channel !== identity.channel ||
      conversation.participantKey !== identity.participantKey
    ) {
      return null;
    }

    return conversation;
  }

  const existing = await repository.findByChannelParticipant(
    identity.channel,
    identity.participantKey,
  );

  if (existing || !identity.createIfMissing) {
    return existing;
  }

  return repository.getOrCreateByChannelParticipant(
    identity.channel,
    identity.participantKey,
    {
      ...(identity.customerId ? { customerId: identity.customerId } : {}),
      ...(identity.whatsappConnectionId
        ? { whatsappConnectionId: identity.whatsappConnectionId }
        : {}),
    },
  );
};
