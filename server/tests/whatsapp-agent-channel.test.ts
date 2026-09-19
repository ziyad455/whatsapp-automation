import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { agentResultSchema } from '../src/ai/agent-result';
import { handleWhatsAppAgentMessage } from '../src/channels/whatsapp-agent-channel';
import type { TenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import type { Conversation, ConversationMessage } from '../src/generated/prisma/client';
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
    tenant: { businessId, whatsappConnectionId: randomUUID() },
    customer: {
      id: randomUUID(),
      businessId,
      whatsappPhone: '212600000001',
    },
    inboxMessageId: randomUUID(),
  };
};

const conversationFor = (
  input: ResolvedInboundMessage,
  mode: Conversation['mode'] = 'AI',
): Conversation => ({
  id: randomUUID(),
  businessId: input.tenant.businessId,
  customerId: input.customer.id,
  whatsappConnectionId: input.tenant.whatsappConnectionId,
  channel: 'WHATSAPP',
  participantKey: input.customer.id,
  mode,
  status: 'OPEN',
  assignedBusinessUserId: null,
  handoffReason: null,
  controlVersion: 0,
  pendingActions: [],
  messageCount: 0,
  lastActivityAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
});

const messageFor = (
  conversation: Conversation,
  senderType: ConversationMessage['senderType'],
): ConversationMessage => ({
  id: randomUUID(),
  businessId: conversation.businessId,
  conversationId: conversation.id,
  sequence: senderType === 'CUSTOMER' ? 1 : 2,
  direction: senderType === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND',
  senderType,
  sentByBusinessUserId: null,
  content: senderType === 'CUSTOMER' ? 'Hello' : agentResult.reply,
  createdAt: new Date(),
});

const agentResult = agentResultSchema.parse({
  reply: 'Hello! How can I help with Atlas Cars?',
  needsHuman: false,
  detectedIntent: 'GENERAL_QUESTION',
  reasonCode: 'NONE',
  detectedLanguage: 'en',
});

const ignoredLeadCapture = () => ({
  captureLead: vi.fn().mockResolvedValue({
    qualification: {
      qualifies: false,
      intent: 'INFORMATION',
      reasonCode: 'INFORMATION_ONLY',
      evidenceTypes: [],
    },
    leadId: null,
    created: false,
    evidenceAdded: false,
    summaryRequired: false,
  }),
});

const repositoryFor = (conversation: Conversation) => {
  const customerMessage = messageFor(conversation, 'CUSTOMER');
  const aiMessage = messageFor(conversation, 'AI');
  return {
    appendMessage: vi.fn().mockResolvedValue(customerMessage),
    findById: vi.fn().mockResolvedValue(conversation),
    commitAutomatedReply: vi.fn().mockResolvedValue({
      message: aiMessage,
      transportMessageId: randomUUID(),
      controlVersion: conversation.controlVersion + 1,
    }),
    escalateFailedAiRun: vi.fn().mockResolvedValue({ count: 1 }),
  };
};

describe('WhatsApp shared customer-service channel', () => {
  it('persists the inbound turn, uses the shared generator, and sends the committed AI reply', async () => {
    const input = inbound();
    const conversation = conversationFor(input);
    const repository = repositoryFor(conversation);
    const resolveConversation = vi.fn().mockResolvedValue(conversation);
    const generateReply = vi.fn().mockResolvedValue({
      result: agentResult,
      offeredActions: [],
    });
    const sendText = vi.fn().mockResolvedValue({
      provider: 'WHATSAPP',
      accepted: true,
      externalMessageId: 'wamid.outbound-channel',
      transportMessageId: randomUUID(),
    });
    const startProcessing = vi.fn().mockResolvedValue({ count: 1 });
    const markProcessed = vi.fn().mockResolvedValue({ count: 1 });
    const markFailed = vi.fn();
    const leadHooks = ignoredLeadCapture();

    await expect(handleWhatsAppAgentMessage(input, {
      ...leadHooks,
      resolveConversation,
      generateReply,
      createRepository: () => repository as unknown as TenantConversationRepository,
      sendText,
      startProcessing,
      markProcessed,
      markFailed,
    })).resolves.toMatchObject({
      conversationId: conversation.id,
      outcome: 'AI_REPLIED',
      mode: 'AI',
      result: agentResult,
      outbound: { externalMessageId: 'wamid.outbound-channel' },
    });

    expect(resolveConversation).toHaveBeenCalledWith(
      { businessId: input.tenant.businessId },
      {
        channel: 'WHATSAPP',
        participantKey: input.customer.id,
        customerId: input.customer.id,
        whatsappConnectionId: input.tenant.whatsappConnectionId,
        createIfMissing: true,
      },
    );
    expect(repository.appendMessage).toHaveBeenCalledWith(conversation.id, {
      senderType: 'CUSTOMER',
      content: 'Hello',
      whatsappMessageId: input.inboxMessageId,
    });
    expect(repository.commitAutomatedReply).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: conversation.id,
      expectedControlVersion: 0,
      content: agentResult.reply,
      handoffReason: null,
    }));
    const committed = await repository.commitAutomatedReply.mock.results[0]!.value;
    expect(sendText).toHaveBeenCalledWith({
      tenant: input.tenant,
      to: '212600000001',
      text: agentResult.reply,
      conversationMessageId: committed.message.id,
      reservedTransportMessageId: committed.transportMessageId,
    });
    expect(markProcessed).toHaveBeenCalledWith(input.tenant, input.inboxMessageId);
    expect(markFailed).not.toHaveBeenCalled();
    expect(leadHooks.captureLead).toHaveBeenCalledWith(
      { businessId: input.tenant.businessId },
      expect.objectContaining({
        conversationId: conversation.id,
        detectedIntent: 'GENERAL_QUESTION',
      }),
    );
  });

  it.each(['HUMAN', 'PAUSED'] as const)(
    'stores inbound messages but blocks automatic replies in %s mode',
    async mode => {
      const input = inbound();
      const conversation = conversationFor(input, mode);
      const repository = repositoryFor(conversation);
      const generateReply = vi.fn();
      const sendText = vi.fn();

      await expect(handleWhatsAppAgentMessage(input, {
        ...ignoredLeadCapture(),
        resolveConversation: vi.fn().mockResolvedValue(conversation),
        createRepository: () => repository as unknown as TenantConversationRepository,
        generateReply,
        sendText,
        startProcessing: vi.fn().mockResolvedValue({ count: 1 }),
        markProcessed: vi.fn().mockResolvedValue({ count: 1 }),
      })).resolves.toMatchObject({
        outcome: 'STORED_WITHOUT_AUTOMATION',
        mode,
      });

      expect(repository.appendMessage).toHaveBeenCalledOnce();
      expect(generateReply).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    },
  );

  it('suppresses an AI reply when a concurrent mode change wins the control-version check', async () => {
    const input = inbound();
    const conversation = conversationFor(input);
    const repository = repositoryFor(conversation);
    repository.commitAutomatedReply.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({ ...conversation, mode: 'HUMAN', controlVersion: 1 });
    const sendText = vi.fn();

    await expect(handleWhatsAppAgentMessage(input, {
      ...ignoredLeadCapture(),
      resolveConversation: vi.fn().mockResolvedValue(conversation),
      createRepository: () => repository as unknown as TenantConversationRepository,
      generateReply: vi.fn().mockResolvedValue({ result: agentResult, offeredActions: [] }),
      sendText,
      startProcessing: vi.fn().mockResolvedValue({ count: 1 }),
      markProcessed: vi.fn().mockResolvedValue({ count: 1 }),
    })).resolves.toMatchObject({
      outcome: 'AI_REPLY_SUPPRESSED',
      mode: 'HUMAN',
    });

    expect(sendText).not.toHaveBeenCalled();
  });

  it('marks the inbound row failed and escalates when generation fails', async () => {
    const input = inbound();
    const conversation = conversationFor(input);
    const repository = repositoryFor(conversation);
    const failure = new Error('Provider unavailable');
    const markFailed = vi.fn().mockResolvedValue({ count: 1 });

    await expect(handleWhatsAppAgentMessage(input, {
      ...ignoredLeadCapture(),
      resolveConversation: vi.fn().mockResolvedValue(conversation),
      createRepository: () => repository as unknown as TenantConversationRepository,
      generateReply: vi.fn().mockRejectedValue(failure),
      startProcessing: vi.fn().mockResolvedValue({ count: 1 }),
      markProcessed: vi.fn(),
      markFailed,
    })).rejects.toBe(failure);

    expect(repository.escalateFailedAiRun).toHaveBeenCalledWith(conversation.id, 0);
    expect(markFailed).toHaveBeenCalledWith(input.tenant, input.inboxMessageId);
  });

  it('uses the reserved reply control version when an outbound send fails', async () => {
    const input = inbound();
    const conversation = conversationFor(input);
    const repository = repositoryFor(conversation);
    const failure = new Error('Meta unavailable');
    const markFailed = vi.fn().mockResolvedValue({ count: 1 });

    await expect(handleWhatsAppAgentMessage(input, {
      ...ignoredLeadCapture(),
      resolveConversation: vi.fn().mockResolvedValue(conversation),
      createRepository: () => repository as unknown as TenantConversationRepository,
      generateReply: vi.fn().mockResolvedValue({ result: agentResult, offeredActions: [] }),
      sendText: vi.fn().mockRejectedValue(failure),
      startProcessing: vi.fn().mockResolvedValue({ count: 1 }),
      markProcessed: vi.fn(),
      markFailed,
    })).rejects.toBe(failure);

    expect(repository.escalateFailedAiRun).toHaveBeenCalledWith(conversation.id, 1);
    expect(markFailed).toHaveBeenCalledWith(input.tenant, input.inboxMessageId);
  });
});
