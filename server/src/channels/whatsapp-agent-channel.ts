import type { AgentResult } from '../ai/agent-result';
import { determineHandoffReason } from '../conversations/conversation-escalation';
import { resolveChannelConversation } from '../conversations/conversation.service';
import {
  generateCustomerServiceReply,
  type GeneratedCustomerServiceReply,
} from '../conversations/customer-service-conversation';
import {
  createTenantConversationRepository,
  type TenantConversationRepository,
} from '../conversations/tenant-conversation.repository';
import type { ConversationMode } from '../generated/prisma/client';
import type { TenantScope } from '../tenancy/tenant-context';
import type { ResolvedInboundMessage } from '../whatsapp/process-inbound-webhook';
import {
  markInboundWhatsAppMessageFailed,
  markInboundWhatsAppMessageProcessed,
  startInboundWhatsAppMessageProcessing,
} from '../whatsapp/whatsapp-message.repository';
import {
  sendWhatsAppText,
  type PersistedWhatsAppSendResult,
} from '../whatsapp/whatsapp-send.service';

export type WhatsAppAgentChannelOutcome =
  | 'AI_REPLIED'
  | 'STORED_WITHOUT_AUTOMATION'
  | 'AI_REPLY_SUPPRESSED';

export interface WhatsAppAgentChannelResult {
  readonly conversationId: string;
  readonly outcome: WhatsAppAgentChannelOutcome;
  readonly mode: ConversationMode;
  readonly result?: AgentResult;
  readonly outbound?: PersistedWhatsAppSendResult;
}

export interface WhatsAppAgentChannelDependencies {
  readonly resolveConversation?: typeof resolveChannelConversation;
  readonly generateReply?: (
    input: Parameters<typeof generateCustomerServiceReply>[0],
  ) => Promise<GeneratedCustomerServiceReply>;
  readonly createRepository?: (
    tenant: TenantScope,
  ) => TenantConversationRepository;
  readonly sendText?: typeof sendWhatsAppText;
  readonly startProcessing?: typeof startInboundWhatsAppMessageProcessing;
  readonly markProcessed?: typeof markInboundWhatsAppMessageProcessed;
  readonly markFailed?: typeof markInboundWhatsAppMessageFailed;
}

export const handleWhatsAppAgentMessage = async (
  input: ResolvedInboundMessage,
  dependencies: WhatsAppAgentChannelDependencies = {},
): Promise<WhatsAppAgentChannelResult> => {
  const tenant: TenantScope = Object.freeze({
    businessId: input.tenant.businessId,
  });
  const resolveConversation = dependencies.resolveConversation ??
    resolveChannelConversation;
  const conversation = await resolveConversation(tenant, {
    channel: 'WHATSAPP',
    participantKey: input.customer.id,
    customerId: input.customer.id,
    whatsappConnectionId: input.tenant.whatsappConnectionId,
    createIfMissing: true,
  });

  if (!conversation) {
    throw new Error('The WhatsApp customer conversation could not be resolved.');
  }

  const startProcessing = dependencies.startProcessing ??
    startInboundWhatsAppMessageProcessing;
  const started = await startProcessing(input.tenant, input.inboxMessageId);
  if (started.count !== 1) {
    throw new Error('The WhatsApp inbound message could not start processing.');
  }

  const repository = (dependencies.createRepository ??
    createTenantConversationRepository)(tenant);
  const markProcessed = dependencies.markProcessed ??
    markInboundWhatsAppMessageProcessed;
  let failureControlVersion = conversation.controlVersion;

  try {
    const customerMessage = await repository.appendMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: input.message.content.text,
      whatsappMessageId: input.inboxMessageId,
    });
    const currentConversation = await repository.findById(conversation.id);
    if (!currentConversation) {
      throw new Error('The WhatsApp customer conversation could not be reloaded.');
    }

    if (currentConversation.mode !== 'AI' || currentConversation.status !== 'OPEN') {
      const processed = await markProcessed(input.tenant, input.inboxMessageId);
      if (processed.count !== 1) {
        throw new Error('The WhatsApp inbound message could not be marked as processed.');
      }
      return {
        conversationId: currentConversation.id,
        outcome: 'STORED_WITHOUT_AUTOMATION',
        mode: currentConversation.mode,
      };
    }

    const generateReply = dependencies.generateReply ?? generateCustomerServiceReply;
    const generated = await generateReply({
      tenant,
      conversation: currentConversation,
      message: customerMessage.content,
      customerMessageId: customerMessage.id,
    });
    const handoffReason = determineHandoffReason(generated.result);
    const committed = await repository.commitAutomatedReply({
      conversationId: currentConversation.id,
      expectedControlVersion: currentConversation.controlVersion,
      content: generated.result.reply,
      pendingActions: generated.offeredActions,
      handoffReason,
    });

    if (!committed) {
      const processed = await markProcessed(input.tenant, input.inboxMessageId);
      if (processed.count !== 1) {
        throw new Error('The WhatsApp inbound message could not be marked as processed.');
      }
      const latest = await repository.findById(currentConversation.id);
      return {
        conversationId: currentConversation.id,
        outcome: 'AI_REPLY_SUPPRESSED',
        mode: latest?.mode ?? 'HUMAN',
      };
    }
    failureControlVersion = committed.controlVersion;

    const sendText = dependencies.sendText ?? sendWhatsAppText;
    const outbound = await sendText({
      tenant: input.tenant,
      to: input.message.customerPhone,
      text: generated.result.reply,
      conversationMessageId: committed.message.id,
      reservedTransportMessageId: committed.transportMessageId,
    });
    const processed = await markProcessed(input.tenant, input.inboxMessageId);
    if (processed.count !== 1) {
      throw new Error('The WhatsApp inbound message could not be marked as processed.');
    }

    return {
      conversationId: currentConversation.id,
      outcome: 'AI_REPLIED',
      mode: handoffReason ? 'HUMAN' : 'AI',
      result: generated.result,
      outbound,
    };
  } catch (error) {
    await repository.escalateFailedAiRun(
      conversation.id,
      failureControlVersion,
    );
    const markFailed = dependencies.markFailed ?? markInboundWhatsAppMessageFailed;
    await markFailed(input.tenant, input.inboxMessageId);
    throw error;
  }
};
