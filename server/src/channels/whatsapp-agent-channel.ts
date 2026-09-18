import type { AgentResult } from '../ai/agent-result';
import { resolveChannelConversation } from '../conversations/conversation.service';
import {
  runCustomerServiceConversation,
  type CustomerServiceConversationResult,
} from '../conversations/customer-service-conversation';
import type { TenantScope } from '../tenancy/tenant-context';
import type { ResolvedInboundMessage } from '../whatsapp/process-inbound-webhook';
import {
  markInboundWhatsAppMessageFailed,
  markInboundWhatsAppMessageProcessed,
  startInboundWhatsAppMessageProcessing,
} from '../whatsapp/whatsapp-message.repository';
import { sendWhatsAppText } from '../whatsapp/whatsapp-send.service';
import type { WhatsAppSendResult } from '../whatsapp/whatsapp-send.types';

export interface WhatsAppAgentChannelResult {
  readonly conversationId: string;
  readonly result: AgentResult;
  readonly outbound: WhatsAppSendResult;
}

export interface WhatsAppAgentChannelDependencies {
  readonly resolveConversation?: typeof resolveChannelConversation;
  readonly runConversation?: typeof runCustomerServiceConversation;
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

  try {
    const runConversation = dependencies.runConversation ??
      runCustomerServiceConversation;
    const response: CustomerServiceConversationResult = await runConversation({
      tenant,
      conversation,
      message: input.message.content.text,
    });
    const sendText = dependencies.sendText ?? sendWhatsAppText;
    const outbound = await sendText({
      tenant: input.tenant,
      to: input.message.customerPhone,
      text: response.result.reply,
    });
    const markProcessed = dependencies.markProcessed ??
      markInboundWhatsAppMessageProcessed;
    const processed = await markProcessed(input.tenant, input.inboxMessageId);
    if (processed.count !== 1) {
      throw new Error('The WhatsApp inbound message could not be marked as processed.');
    }

    return {
      conversationId: response.conversationId,
      result: response.result,
      outbound,
    };
  } catch (error) {
    const markFailed = dependencies.markFailed ?? markInboundWhatsAppMessageFailed;
    await markFailed(input.tenant, input.inboxMessageId);
    throw error;
  }
};
