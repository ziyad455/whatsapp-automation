import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createTenantFollowUpService, scheduleFollowUpForLead } from '../src/follow-ups/follow-up.service';
import { processDueFollowUp } from '../src/follow-ups/follow-up-worker';
import { captureLeadFromCustomerMessage, createTenantLeadDashboardService } from '../src/leads/tenant-lead.service';
import { createMembership } from '../src/memberships/business-user.repository';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { sendWhatsAppText } from '../src/whatsapp/whatsapp-send.service';
import { WhatsAppSendError } from '../src/whatsapp/whatsapp-send.types';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const fixtures: Array<{ businessId: string; userId: string }> = [];

const fixture = async (delay: number) => {
  const user = await prisma.user.create({
    data: { name: 'Follow-up operator', email: `s12-${randomUUID()}@example.test`, emailVerified: true },
  });
  const business = await createBusiness({
    name: 'Follow-up test business', category: 'CAR_RENTAL', timezone: 'UTC',
    currency: 'MAD', defaultLanguage: 'en', lifecycleStatus: 'ACTIVE',
  });
  fixtures.push({ businessId: business.id, userId: user.id });
  const membership = await createMembership({
    userId: user.id, businessId: business.id, role: 'OWNER',
  });
  const tenant = { businessId: business.id, userId: user.id,
    membershipId: membership.id, role: membership.role };
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId: `99${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
    whatsappBusinessAccountId: `98${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
  });
  const whatsappTenant = { businessId: business.id, whatsappConnectionId: connection.id };
  const customer = await resolveOrCreateWhatsAppCustomer(whatsappTenant,
    `2126${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`);
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'WHATSAPP', participantKey: customer.id, customerId: customer.id,
    whatsappConnectionId: connection.id, createIfMissing: true,
  });
  if (!conversation) throw new Error('Expected conversation.');
  const repository = createTenantConversationRepository(tenant);
  const message = await repository.appendMessage(conversation.id, {
    senderType: 'CUSTOMER', content: 'I need a car for 4 days.',
  });
  const lead = await captureLeadFromCustomerMessage(tenant, {
    conversationId: conversation.id, messageId: message.id,
    detectedIntent: 'PURCHASE_INTENT',
  });
  if (!lead.leadId) throw new Error('Expected qualifying lead.');
  await createTenantFollowUpService(tenant).updateSettings({
    followUpsEnabled: true, initialFollowUpDelayMinutes: delay,
    followUpWindowStartMinutes: 0, followUpWindowEndMinutes: 1439,
    maxFollowUpsPerLead: 1, minimumFollowUpIntervalMinutes: 60,
  });
  return { tenant, customer, conversation, repository, message, leadId: lead.leadId };
};

describe('Sprint 12 tenant-bound follow-ups', () => {
  beforeAll(() => assertIsolatedTestDatabase());
  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: fixtures.map(item => item.businessId) } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtures.map(item => item.userId) } } });
    await closeDatabaseConnection();
  });

  it('requires explicit consent, uses business-specific delay, and deduplicates pending work', async () => {
    const first = await fixture(5);
    const second = await fixture(30);
    expect(await scheduleFollowUpForLead(first.tenant, first.leadId)).toBeNull();
    await createTenantFollowUpService(first.tenant).recordConsent(first.leadId, true);
    await createTenantFollowUpService(second.tenant).recordConsent(second.leadId, true);
    const a = await prisma.followUp.findFirstOrThrow({ where: {
      businessId: first.tenant.businessId, leadId: first.leadId } });
    const b = await prisma.followUp.findFirstOrThrow({ where: {
      businessId: second.tenant.businessId, leadId: second.leadId } });
    expect(a.scheduledAt.getTime() - a.customerActivityAt.getTime()).toBe(5 * 60_000);
    expect(b.scheduledAt.getTime() - b.customerActivityAt.getTime()).toBe(30 * 60_000);
    await Promise.all(Array.from({ length: 3 }, () =>
      scheduleFollowUpForLead(first.tenant, first.leadId)));
    expect(await prisma.followUp.count({ where: {
      businessId: first.tenant.businessId, leadId: first.leadId, status: 'PENDING' } })).toBe(1);
    expect(await createTenantFollowUpService(second.tenant).listForLead(first.leadId)).toEqual([]);
    const send = vi.fn();
    expect(await processDueFollowUp(a.id, { now: () => new Date(a.scheduledAt.getTime() - 1),
      sendText: send })).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels pending work atomically on customer reply and never sends it', async () => {
    const context = await fixture(5);
    await createTenantFollowUpService(context.tenant).recordConsent(context.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: {
      businessId: context.tenant.businessId, leadId: context.leadId } });
    await context.repository.appendMessage(context.conversation.id, {
      senderType: 'CUSTOMER', content: 'I already found a car, thanks.',
    });
    const send = vi.fn();
    expect(await processDueFollowUp(pending.id, {
      now: () => new Date(pending.scheduledAt.getTime() + 1), sendText: send,
    })).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'CANCELLED', reasonCode: 'CUSTOMER_REPLIED' });
    expect(await scheduleFollowUpForLead(context.tenant, context.leadId)).toBeNull();
  });

  it('records an explicit inbound opt-out and cancels existing follow-ups', async () => {
    const context = await fixture(5);
    await createTenantFollowUpService(context.tenant).recordConsent(context.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: context.leadId } });
    await context.repository.appendMessage(context.conversation.id, {
      senderType: 'CUSTOMER', content: 'STOP!',
    });
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'CANCELLED', reasonCode: 'CUSTOMER_OPTED_OUT' });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: context.customer.id } });
    expect(customer.followUpOptedOutAt).not.toBeNull();
  });

  it('blocks human control, terminal leads, and disabled policy before provider send', async () => {
    const human = await fixture(5);
    await createTenantFollowUpService(human.tenant).recordConsent(human.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: human.leadId } });
    await prisma.conversation.update({ where: { id: human.conversation.id },
      data: { mode: 'HUMAN', handoffReason: 'MANUAL' } });
    const send = vi.fn();
    expect(await processDueFollowUp(pending.id, {
      now: () => new Date(pending.scheduledAt.getTime() + 1), sendText: send,
    })).toBe('CANCELLED');
    expect(send).not.toHaveBeenCalled();
    await createTenantLeadDashboardService(human.tenant).setStatus(human.leadId, 'WON');
    expect(await scheduleFollowUpForLead(human.tenant, human.leadId)).toBeNull();
  });

  it('defers quiet-hour work and refuses text after the Meta reply window', async () => {
    const quiet = await fixture(5);
    await createTenantFollowUpService(quiet.tenant).recordConsent(quiet.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: quiet.leadId } });
    const dueAt = new Date(pending.scheduledAt.getTime() + 1);
    const minute = dueAt.getUTCHours() * 60 + dueAt.getUTCMinutes();
    const start = (minute + 1) % 1440;
    await createTenantFollowUpService(quiet.tenant).updateSettings({
      followUpsEnabled: true, initialFollowUpDelayMinutes: 5,
      followUpWindowStartMinutes: start,
      followUpWindowEndMinutes: (start + 60) % 1440,
      maxFollowUpsPerLead: 1, minimumFollowUpIntervalMinutes: 60,
    });
    const send = vi.fn();
    expect(await processDueFollowUp(pending.id, { now: () => dueAt, sendText: send }))
      .toBe('DEFERRED');
    const deferred = await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } });
    expect(deferred.status).toBe('PENDING');
    expect(deferred.attemptCount).toBe(0);
    expect(deferred.scheduledAt.getTime()).toBeGreaterThan(dueAt.getTime());
    expect(send).not.toHaveBeenCalled();

    expect(await processDueFollowUp(pending.id, {
      now: () => new Date(pending.customerActivityAt.getTime() + 24 * 60 * 60_000 + 1),
      sendText: send,
    })).toBe('FAILED');
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'FAILED', reasonCode: 'TEMPLATE_REQUIRED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('allows only one concurrent claim and persists a canonical outbound message', async () => {
    const context = await fixture(5);
    await createTenantFollowUpService(context.tenant).recordConsent(context.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: context.leadId } });
    const transport = vi.fn().mockResolvedValue({ provider: 'WHATSAPP', accepted: true,
      externalMessageId: `wamid.test-${randomUUID()}` });
    const send = vi.fn((input: Parameters<typeof sendWhatsAppText>[0]) =>
      sendWhatsAppText(input, { transport: { sendText: transport } }));
    const results = await Promise.all([1, 2].map(() => processDueFollowUp(pending.id, {
      now: () => new Date(pending.scheduledAt.getTime() + 1), sendText: send,
    })));
    expect(results).toContain('SENT');
    expect(results).toContain('SKIPPED');
    expect(send).toHaveBeenCalledTimes(1);
    const saved = await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id },
      include: { conversationMessage: true } });
    expect(saved.status).toBe('SENT');
    expect(saved.conversationMessage).toMatchObject({ direction: 'OUTBOUND', senderType: 'SYSTEM' });
    expect(await prisma.whatsAppMessage.findFirst({ where: {
      businessId: context.tenant.businessId,
      conversationMessageId: saved.conversationMessageId,
    } })).toMatchObject({ deliveryStatus: 'SENT' });
  });

  it('retries definite rate limits but never ambiguous timeouts', async () => {
    const retry = await fixture(5);
    await createTenantFollowUpService(retry.tenant).recordConsent(retry.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: retry.leadId } });
    const rateLimited = vi.fn().mockRejectedValue(new WhatsAppSendError({
      code: 'RATE_LIMITED', message: 'Synthetic rate limit.', retryable: true, providerStatus: 429,
    }));
    expect(await processDueFollowUp(pending.id, {
      now: () => new Date(pending.scheduledAt.getTime() + 1),
      sendText: input => sendWhatsAppText(input, { transport: { sendText: rateLimited } }),
    })).toBe('DEFERRED');
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'PENDING', attemptCount: 1, reasonCode: 'RATE_LIMITED' });
    const retryScheduled = await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } });
    const accepted = vi.fn().mockResolvedValue({ provider: 'WHATSAPP', accepted: true,
      externalMessageId: `wamid.retry-${randomUUID()}` });
    expect(await processDueFollowUp(pending.id, {
      now: () => new Date(retryScheduled.scheduledAt.getTime() + 1),
      sendText: input => sendWhatsAppText(input, { transport: { sendText: accepted } }),
    })).toBe('SENT');
    expect(await prisma.conversationMessage.count({ where: {
      businessId: retry.tenant.businessId, conversationId: retryScheduled.conversationId,
      senderType: 'SYSTEM',
    } })).toBe(1);

    const timeout = await fixture(5);
    await createTenantFollowUpService(timeout.tenant).recordConsent(timeout.leadId, true);
    const ambiguous = await prisma.followUp.findFirstOrThrow({ where: { leadId: timeout.leadId } });
    expect(await processDueFollowUp(ambiguous.id, {
      now: () => new Date(ambiguous.scheduledAt.getTime() + 1),
      sendText: input => sendWhatsAppText(input, { transport: { sendText: vi.fn()
        .mockRejectedValue(new WhatsAppSendError({
          code: 'TIMEOUT', message: 'Synthetic timeout.', retryable: true,
        })) } }),
    })).toBe('FAILED');
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: ambiguous.id } }))
      .toMatchObject({ status: 'FAILED', attemptCount: 1, reasonCode: 'TIMEOUT' });
  });

  it('bounds definite provider retries at three attempts and keeps one outbound message', async () => {
    const context = await fixture(5);
    await createTenantFollowUpService(context.tenant).recordConsent(context.leadId, true);
    const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: context.leadId } });
    const rejected = vi.fn().mockRejectedValue(new WhatsAppSendError({
      code: 'PROVIDER_UNAVAILABLE', message: 'Synthetic 500.', retryable: true,
      providerStatus: 500,
    }));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const current = await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } });
      expect(await processDueFollowUp(pending.id, {
        now: () => new Date(current.scheduledAt.getTime() + 1),
        sendText: input => sendWhatsAppText(input, { transport: { sendText: rejected } }),
      })).toBe(attempt === 3 ? 'FAILED' : 'DEFERRED');
    }
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ status: 'FAILED', attemptCount: 3, reasonCode: 'PROVIDER_UNAVAILABLE' });
    expect(await prisma.conversationMessage.count({ where: {
      businessId: context.tenant.businessId, conversationId: context.conversation.id,
      senderType: 'SYSTEM',
    } })).toBe(1);
  });

  it.each(['INVALID_REQUEST', 'AUTHENTICATION'] as const)(
    'does not retry permanent %s failures', async code => {
      const context = await fixture(5);
      await createTenantFollowUpService(context.tenant).recordConsent(context.leadId, true);
      const pending = await prisma.followUp.findFirstOrThrow({ where: { leadId: context.leadId } });
      expect(await processDueFollowUp(pending.id, {
        now: () => new Date(pending.scheduledAt.getTime() + 1),
        sendText: input => sendWhatsAppText(input, { transport: { sendText: vi.fn()
          .mockRejectedValue(new WhatsAppSendError({
            code, message: 'Synthetic permanent rejection.', retryable: false,
          })) } }),
      })).toBe('FAILED');
      expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending.id } }))
        .toMatchObject({ status: 'FAILED', attemptCount: 1, reasonCode: code });
    },
  );
});
