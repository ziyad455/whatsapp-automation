import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTenantDashboardAnalyticsService } from '../src/analytics/dashboard-analytics.service';
import { getTenantAiUsageMetrics, recordAiUsage } from '../src/analytics/ai-usage.service';
import { getBusinessReportingRange } from '../src/analytics/reporting-range';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationInboxService } from '../src/conversations/tenant-conversation-inbox.service';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const cleanup: Array<{ businessId: string; userId: string }> = [];

const fixture = async (name: string, timezone = 'UTC') => {
  const user = await prisma.user.create({
    data: { name: `${name} owner`, email: `${randomUUID()}@analytics.example.test`, emailVerified: true },
  });
  const business = await createBusiness({
    name, category: 'CAR_RENTAL', timezone, currency: 'MAD',
    defaultLanguage: 'en', lifecycleStatus: 'ACTIVE',
  });
  cleanup.push({ businessId: business.id, userId: user.id });
  const membership = await createMembership({ userId: user.id, businessId: business.id, role: 'OWNER' });
  const tenant = { businessId: business.id, userId: user.id, membershipId: membership.id, role: membership.role };
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId: `8${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
    whatsappBusinessAccountId: `7${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
  });
  const customer = await resolveOrCreateWhatsAppCustomer(
    { businessId: business.id, whatsappConnectionId: connection.id },
    `2126${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
  );
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'WHATSAPP', participantKey: customer.id, customerId: customer.id,
    whatsappConnectionId: connection.id, createIfMissing: true,
  });
  if (!conversation) throw new Error('Expected an analytics conversation fixture.');
  return { business, tenant, connection, customer, conversation };
};

const addConversation = async (
  context: Awaited<ReturnType<typeof fixture>>,
) => {
  const customer = await resolveOrCreateWhatsAppCustomer(
    { businessId: context.business.id, whatsappConnectionId: context.connection.id },
    `2126${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
  );
  const conversation = await resolveChannelConversation(context.tenant, {
    channel: 'WHATSAPP', participantKey: customer.id, customerId: customer.id,
    whatsappConnectionId: context.connection.id, createIfMissing: true,
  });
  if (!conversation) throw new Error('Expected another analytics conversation fixture.');
  return { customer, conversation };
};

describe('tenant dashboard analytics', () => {
  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: cleanup.map(item => item.businessId) } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.map(item => item.userId) } } });
    await closeDatabaseConnection();
  });

  it('counts local-day operations and current queues without leaking another tenant', async () => {
    const now = new Date('2026-09-30T00:30:00.000Z');
    const first = await fixture('Analytics Atlas', 'Africa/Casablanca');
    const second = await fixture('Analytics Other', 'Africa/Casablanca');
    const newerAttention = await addConversation(first);
    const resolved = await addConversation(first);
    await prisma.conversation.update({
      where: { id: first.conversation.id },
      data: { mode: 'HUMAN', handoffReason: 'CUSTOMER_REQUEST', attentionSince: new Date('2026-09-29T23:10:00.000Z') },
    });
    await prisma.conversation.update({
      where: { id: newerAttention.conversation.id },
      data: { mode: 'HUMAN', handoffReason: 'COMPLAINT', attentionSince: new Date('2026-09-29T23:20:00.000Z') },
    });
    await prisma.conversation.update({
      where: { id: resolved.conversation.id },
      data: { mode: 'AI', handoffReason: null, attentionSince: null },
    });
    await prisma.conversationMessage.createMany({ data: [
      { businessId: first.business.id, conversationId: first.conversation.id, sequence: 1, direction: 'INBOUND', senderType: 'CUSTOMER', content: 'Hello', createdAt: new Date('2026-09-29T23:30:00.000Z') },
      { businessId: second.business.id, conversationId: second.conversation.id, sequence: 1, direction: 'INBOUND', senderType: 'CUSTOMER', content: 'Private', createdAt: new Date('2026-09-29T23:30:00.000Z') },
    ] });
    await prisma.customerLifecycleEvent.create({ data: {
      businessId: first.business.id, customerId: first.customer.id,
      relatedConversationId: first.conversation.id, type: 'BOOKING_COMPLETED',
      occurredAt: new Date('2026-09-30T00:10:00.000Z'), metadata: { itemLabel: 'Clio' },
    } });
    const lead = await prisma.lead.create({ data: {
      businessId: first.business.id, customerId: first.customer.id,
      conversationId: first.conversation.id, status: 'QUALIFIED', intent: 'PURCHASE_INTEREST',
      createdAt: new Date('2026-09-29T23:40:00.000Z'),
    } });
    await prisma.lead.createMany({ data: [
      { businessId: first.business.id, customerId: first.customer.id, conversationId: first.conversation.id, status: 'WON', intent: 'PURCHASE_INTEREST', createdAt: new Date('2026-09-28T10:00:00.000Z') },
      { businessId: first.business.id, customerId: first.customer.id, conversationId: first.conversation.id, status: 'LOST', intent: 'INFORMATION', createdAt: new Date('2026-09-28T11:00:00.000Z') },
    ] });
    const commonFollowUp = {
      businessId: first.business.id, leadId: lead.id, customerId: first.customer.id,
      conversationId: first.conversation.id, customerActivityAt: new Date('2026-09-29T23:30:00.000Z'),
    };
    await prisma.followUp.create({ data: {
      ...commonFollowUp, content: 'Due', scheduledAt: new Date('2026-09-30T00:00:00.000Z'),
      status: 'PENDING', attemptCount: 1,
    } });
    const addFollowUpState = async (
      status: 'PENDING' | 'FAILED' | 'SENT' | 'CANCELLED',
      scheduledAt: Date,
      extra: { attemptCount?: number; reasonCode?: string; failedAt?: Date; sentAt?: Date; cancelledAt?: Date } = {},
    ) => {
      const related = await addConversation(first);
      const relatedLead = await prisma.lead.create({ data: {
        businessId: first.business.id, customerId: related.customer.id,
        conversationId: related.conversation.id, intent: 'INFORMATION',
        createdAt: new Date('2026-09-28T12:00:00.000Z'),
      } });
      return prisma.followUp.create({ data: {
        businessId: first.business.id, leadId: relatedLead.id,
        customerId: related.customer.id, conversationId: related.conversation.id,
        customerActivityAt: new Date('2026-09-29T23:30:00.000Z'),
        content: status, scheduledAt, status, ...extra,
      } });
    };
    await addFollowUpState('PENDING', new Date('2026-09-30T01:00:00.000Z'));
    await addFollowUpState('FAILED', new Date('2026-09-29T22:00:00.000Z'), { attemptCount: 3, reasonCode: 'PROVIDER_FAILURE', failedAt: now });
    await addFollowUpState('SENT', new Date('2026-09-29T20:00:00.000Z'), { sentAt: new Date('2026-09-29T20:01:00.000Z') });
    await addFollowUpState('CANCELLED', new Date('2026-09-29T21:00:00.000Z'), { cancelledAt: new Date('2026-09-29T20:30:00.000Z') });

    const service = createTenantDashboardAnalyticsService(first.tenant);
    const result = await service.overview('TODAY', now);
    expect(result.range).toMatchObject({ localStartDate: '2026-09-30', timeZone: 'Africa/Casablanca' });
    expect(result.summary).toMatchObject({ conversations: 1, newLeads: 1, needsAttention: 2, followUpsDue: 1 });
    expect(result.leads.statuses.QUALIFIED).toBe(1);
    expect(result.leads.statuses).toMatchObject({ WON: 1, LOST: 1 });
    expect(result.leads.active).toBe(5);
    expect(result.attention).toHaveLength(2);
    expect(result.attention[0]).toMatchObject({ id: first.conversation.id, waitingSince: '2026-09-29T23:10:00.000Z' });
    expect(result.attention.map(item => item.id)).not.toContain(resolved.conversation.id);
    expect(result.attention.some(item => item.id === second.conversation.id)).toBe(false);
    expect(result).not.toHaveProperty('aiUsage');
    expect(result.outcomes[0]).toMatchObject({ type: 'BOOKING_COMPLETED' });
    const detail = await createTenantConversationInboxService(first.tenant)
      .getById(first.conversation.id);
    expect(detail?.recentOutcomes[0]).toMatchObject({ type: 'BOOKING_COMPLETED' });
    expect(await createTenantConversationInboxService(second.tenant)
      .getById(first.conversation.id)).toBeNull();
    expect(await service.followUps('DUE', now)).toHaveLength(1);
    expect(await service.followUps('PENDING', now)).toHaveLength(1);
    expect((await service.followUps('FAILED', now))[0]).toMatchObject({ status: 'FAILED', attemptCount: 3, reasonCode: 'PROVIDER_FAILURE' });
    expect((await service.followUps('RECENT', now)).map(item => item.status).sort()).toEqual(['CANCELLED', 'SENT']);
  });

  it('calculates response, handoff, and campaign rates from attributable records', async () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    const context = await fixture('Analytics Rates');
    const automatedOutbound = await addConversation(context);
    await prisma.conversationMessage.createMany({ data: [
      { businessId: context.business.id, conversationId: context.conversation.id, sequence: 1, direction: 'INBOUND', senderType: 'CUSTOMER', content: 'Price?', createdAt: new Date('2026-09-30T09:00:00.000Z') },
      { businessId: context.business.id, conversationId: context.conversation.id, sequence: 2, direction: 'OUTBOUND', senderType: 'AI', content: 'Current price', createdAt: new Date('2026-09-30T09:00:30.000Z') },
      { businessId: context.business.id, conversationId: context.conversation.id, sequence: 3, direction: 'INBOUND', senderType: 'CUSTOMER', content: 'A person please', createdAt: new Date('2026-09-30T09:02:00.000Z') },
      { businessId: context.business.id, conversationId: context.conversation.id, sequence: 4, direction: 'OUTBOUND', senderType: 'HUMAN', sentByBusinessUserId: context.tenant.membershipId, content: 'I can help', createdAt: new Date('2026-09-30T09:04:00.000Z') },
      { businessId: context.business.id, conversationId: automatedOutbound.conversation.id, sequence: 1, direction: 'INBOUND', senderType: 'CUSTOMER', content: 'Still there?', createdAt: new Date('2026-09-30T10:00:00.000Z') },
    ] });
    await prisma.auditEvent.create({ data: {
      businessId: context.business.id, actorKind: 'SYSTEM', targetType: 'CONVERSATION',
      targetId: context.conversation.id, action: 'MODE_CHANGE', after: { mode: 'HUMAN' },
      createdAt: new Date('2026-09-30T09:01:00.000Z'),
    } });
    const campaign = await prisma.campaign.create({ data: {
      businessId: context.business.id, name: 'Return renters',
      segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['BOOKING_COMPLETED'] },
      templateName: 'return_renters', templateLanguage: 'en', templateBody: 'Welcome back',
      status: 'COMPLETED',
    } });
    await prisma.campaignRecipient.create({ data: {
      businessId: context.business.id, campaignId: campaign.id, customerId: context.customer.id,
      renderedMessage: 'Welcome back', status: 'SENT',
      sentAt: new Date('2026-09-30T08:00:00.000Z'),
      deliveredAt: new Date('2026-09-30T08:00:05.000Z'),
      readAt: new Date('2026-09-30T08:00:10.000Z'),
      repliedAt: new Date('2026-09-30T08:10:00.000Z'),
      convertedAt: new Date('2026-09-30T10:00:00.000Z'),
    } });
    await prisma.campaignRecipient.create({ data: {
      businessId: context.business.id, campaignId: campaign.id,
      customerId: automatedOutbound.customer.id, renderedMessage: 'Welcome back',
      status: 'FAILED', failedAt: new Date('2026-09-30T08:00:05.000Z'),
      failureReasonCode: 'PROVIDER_FAILURE',
    } });
    const automatedLead = await prisma.lead.create({ data: {
      businessId: context.business.id, customerId: automatedOutbound.customer.id,
      conversationId: automatedOutbound.conversation.id, intent: 'PURCHASE_INTEREST',
    } });
    const followUp = await prisma.followUp.create({ data: {
      businessId: context.business.id, customerId: automatedOutbound.customer.id,
      conversationId: automatedOutbound.conversation.id, leadId: automatedLead.id,
      content: 'Automated reminder', scheduledAt: new Date('2026-09-30T10:01:00.000Z'),
      customerActivityAt: new Date('2026-09-30T10:00:00.000Z'), status: 'SENT',
    } });
    const automatedMessage = await prisma.conversationMessage.create({ data: {
      businessId: context.business.id, conversationId: automatedOutbound.conversation.id,
      sequence: 2, direction: 'OUTBOUND', senderType: 'AI', content: 'Automated reminder',
      createdAt: new Date('2026-09-30T10:01:00.000Z'),
    } });
    await prisma.followUp.update({
      where: { id: followUp.id }, data: { conversationMessageId: automatedMessage.id },
    });
    await prisma.campaign.create({ data: {
      businessId: context.business.id, name: 'Empty campaign',
      segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['BOOKING_COMPLETED'] },
      templateName: 'empty', templateLanguage: 'en', templateBody: 'Hello',
    } });

    const service = createTenantDashboardAnalyticsService(context.tenant);
    const conversations = await service.conversations('TODAY', now);
    expect(conversations).toMatchObject({
      conversationsWithCustomerMessages: 2,
      conversationsWithAiResponses: 1,
      conversationsWithHumanResponses: 1,
      conversationsRequiringHandoff: 1,
      fullyAiHandled: 0,
      handoffRate: 50,
      firstResponseTimeSeconds: { median: 75, average: 75, sampleSize: 2 },
      humanResponseTimeSeconds: { median: 120, average: 120, sampleSize: 1 },
    });
    const campaigns = await service.campaigns();
    expect(campaigns.find(item => item.id === campaign.id)).toMatchObject({
      metrics: { recipients: 2, sent: 1, delivered: 1, read: 1, replied: 1, failed: 1, converted: 1 },
      rates: { delivery: 100, reply: 100, conversion: 100 },
    });
    expect(campaigns.find(item => item.name === 'Empty campaign')?.rates).toEqual({ delivery: null, reply: null, conversion: null });
  });

  it('keeps internal AI usage tenant-scoped and leaves unknown pricing empty', async () => {
    const first = await fixture('Usage First');
    const second = await fixture('Usage Second');
    const emptyOverview = await createTenantDashboardAnalyticsService(first.tenant)
      .overview('TODAY', new Date('2026-09-30T12:00:00.000Z'));
    expect(emptyOverview.summary).toEqual({
      conversations: 0, newLeads: 0, needsAttention: 0,
      followUpsDue: 0, campaignConversions: 0,
    });
    const occurredAt = new Date('2026-09-30T10:00:00.000Z');
    await recordAiUsage({
      tenant: first.tenant, conversationId: first.conversation.id,
      operation: 'CUSTOMER_SERVICE', provider: 'openrouter', model: 'openrouter/free',
      status: 'SUCCESS', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      durationMs: 450, occurredAt,
    });
    await recordAiUsage({
      tenant: second.tenant, operation: 'LEAD_SUMMARY', provider: 'openrouter', model: 'private-model',
      status: 'SUCCESS', usage: { totalTokens: 9_999 }, durationMs: 900, occurredAt,
    });
    const range = getBusinessReportingRange('UTC', 'TODAY', new Date('2026-09-30T12:00:00.000Z'));
    const metrics = await getTenantAiUsageMetrics(first.tenant, range);
    expect(metrics).toMatchObject({
      requests: 1, failures: 0, inputTokens: 120, outputTokens: 30,
      totalTokens: 150, estimatedCostUsd: null, averageLatencyMs: 450,
    });
    expect(metrics.breakdown).toEqual([
      expect.objectContaining({ provider: 'openrouter', model: 'openrouter/free', requests: 1 }),
    ]);
  });
});
