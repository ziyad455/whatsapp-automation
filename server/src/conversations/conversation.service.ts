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
  requestedConversationId: z.uuid().optional(),
  createIfMissing: z.boolean(),
}).strict();

export type ConversationReference = Pick<
  Conversation,
  'id' | 'businessId' | 'channel' | 'participantKey' | 'pendingActions'
>;

export interface ResolveChannelConversationInput {
  readonly channel: ConversationChannel;
  readonly participantKey: string;
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
  );
};
