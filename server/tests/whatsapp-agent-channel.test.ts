import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { agentResultSchema } from '../src/ai/agent-result';
import { handleWhatsAppAgentMessage } from '../src/channels/whatsapp-agent-channel';
import type { ResolvedInboundMessage } from '../src/whatsapp/process-inbound-webhook';

const inbound = (): ResolvedInboundMessage => {
  const businessId = randomUUID();
  return {
    message: {
      provider: 'WHATSAPP',
      externalMessageId: 'wamid.inbound-channel',
      phoneNumberId: '111111111111111',
      customerPhone: '212600000001',
      type: 'TEXT',
      content: { text: 'Hello' },
      timestamp: new Date('2026-09-18T10:00:00.000Z'),
    },
    tenant: {
      businessId,
      whatsappConnectionId: randomUUID(),
    },
    customer: {
      id: randomUUID(),
      businessId,
      whatsappPhone: '212600000001',
    },
    inboxMessageId: randomUUID(),
  };
};

const agentResult = agentResultSchema.parse({
  reply: 'Hello! How can I help with Atlas Cars?',
  needsHuman: false,
  detectedIntent: 'GENERAL_QUESTION',
  reasonCode: 'NONE',
  detectedLanguage: 'en',
});

describe('WhatsApp shared customer-service channel', () => {
  it('uses the resolved customer conversation, shared runtime, and real send service boundary', async () => {
    const input = inbound();
    const conversation = {
      id: randomUUID(),
      businessId: input.tenant.businessId,
      channel: 'WHATSAPP' as const,
      participantKey: input.customer.id,
      pendingActions: [],
      messageCount: 0,
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const resolveConversation = vi.fn().mockResolvedValue(conversation);
    const runConversation = vi.fn().mockResolvedValue({
      conversationId: conversation.id,
      result: agentResult,
    });
    const sendText = vi.fn().mockResolvedValue({
      provider: 'WHATSAPP',
      accepted: true,
      externalMessageId: 'wamid.outbound-channel',
    });
    const startProcessing = vi.fn().mockResolvedValue({ count: 1 });
    const markProcessed = vi.fn().mockResolvedValue({ count: 1 });
    const markFailed = vi.fn();

    await expect(handleWhatsAppAgentMessage(input, {
      resolveConversation,
      runConversation,
      sendText,
      startProcessing,
      markProcessed,
      markFailed,
    })).resolves.toMatchObject({
      conversationId: conversation.id,
      result: agentResult,
      outbound: { externalMessageId: 'wamid.outbound-channel' },
    });

    expect(resolveConversation).toHaveBeenCalledWith(
      { businessId: input.tenant.businessId },
      {
        channel: 'WHATSAPP',
        participantKey: input.customer.id,
        createIfMissing: true,
      },
    );
    expect(runConversation).toHaveBeenCalledWith({
      tenant: { businessId: input.tenant.businessId },
      conversation,
      message: 'Hello',
    });
    expect(sendText).toHaveBeenCalledWith({
      tenant: input.tenant,
      to: '212600000001',
      text: agentResult.reply,
    });
    expect(startProcessing).toHaveBeenCalledWith(
      input.tenant,
      input.inboxMessageId,
    );
    expect(markProcessed).toHaveBeenCalledWith(
      input.tenant,
      input.inboxMessageId,
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marks the inbound transport row failed when agent processing fails', async () => {
    const input = inbound();
    const conversation = {
      id: randomUUID(),
      businessId: input.tenant.businessId,
      channel: 'WHATSAPP' as const,
      participantKey: input.customer.id,
      pendingActions: [],
      messageCount: 0,
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const failure = new Error('Provider unavailable');
    const markFailed = vi.fn().mockResolvedValue({ count: 1 });

    await expect(handleWhatsAppAgentMessage(input, {
      resolveConversation: vi.fn().mockResolvedValue(conversation),
      runConversation: vi.fn().mockRejectedValue(failure),
      startProcessing: vi.fn().mockResolvedValue({ count: 1 }),
      markProcessed: vi.fn(),
      markFailed,
    })).rejects.toBe(failure);

    expect(markFailed).toHaveBeenCalledWith(input.tenant, input.inboxMessageId);
  });
});
