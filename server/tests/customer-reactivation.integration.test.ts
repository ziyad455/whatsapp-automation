import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import {
  CampaignOperationError,
  createTenantCampaignService,
} from '../src/reactivation/campaign.service';
import {
  processCampaignRecipient,
  processDueCampaignRecipients,
  syncCampaignRecipientTransportStatus,
} from '../src/reactivation/campaign-worker';
import {
  CustomerLifecycleError,
  attributeCampaignConversion,
  attributeCampaignReply,
  createCustomerLifecycleEvent,
  listCustomerLifecycleHistory,
  listTenantCustomers,
  recordMarketingPreference,
} from '../src/reactivation/customer-lifecycle.service';
import { previewReactivationSegment } from '../src/reactivation/reactivation-segment';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { sendWhatsAppTemplate } from '../src/whatsapp/whatsapp-send.service';
import { WhatsAppSendError } from '../src/whatsapp/whatsapp-send.types';
import { applyWhatsAppMessageStatusEvent } from '../src/whatsapp/whatsapp-message.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const cleanup: Array<{ businessId: string; userId: string }> = [];
const approvedTemplate = vi.fn().mockResolvedValue({
  approved: true,
  category: 'MARKETING',
  reason: 'APPROVED',
});

const fixture = async (name: string) => {
  const user = await prisma.user.create({
    data: {
      name: `${name} owner`,
      email: `s13-${randomUUID()}@example.test`,
      emailVerified: true,
    },
  });
  const business = await createBusiness({
    name,
    category: 'CAR_RENTAL',
    timezone: 'UTC',
    currency: 'MAD',
    defaultLanguage: 'en',
    lifecycleStatus: 'ACTIVE',
  });
  cleanup.push({ businessId: business.id, userId: user.id });
  const membership = await createMembership({
    userId: user.id,
    businessId: business.id,
    role: 'OWNER',
  });
  const tenant = {
    businessId: business.id,
    userId: user.id,
    membershipId: membership.id,
    role: membership.role,
  };
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId: `97${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
    whatsappBusinessAccountId: `96${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 13)}`,
  });
  const whatsappTenant = { businessId: business.id, whatsappConnectionId: connection.id };
  const customer = await resolveOrCreateWhatsAppCustomer(
    whatsappTenant,
    `2126${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, '0')}`,
  );
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'WHATSAPP',
    participantKey: customer.id,
    customerId: customer.id,
    whatsappConnectionId: connection.id,
    createIfMissing: true,
  });
  if (!conversation) throw new Error('Expected WhatsApp conversation.');
  return { business, tenant, connection, whatsappTenant, customer, conversation };
};

describe('Sprint 13 customer reactivation', () => {
  beforeAll(() => assertIsolatedTestDatabase());
  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: cleanup.map(item => item.businessId) } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.map(item => item.userId) } } });
    await closeDatabaseConnection();
  });

  it('persists factual lifecycle history in chronological tenant scope', async () => {
    const first = await fixture('Lifecycle A');
    const second = await fixture('Lifecycle B');
    const older = await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'BOOKING_COMPLETED',
      occurredAt: '2026-01-01T10:00:00Z',
      metadata: { itemLabel: 'Clio' },
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'PURCHASE_COMPLETED',
      occurredAt: '2026-02-01T10:00:00Z',
      metadata: { itemLabel: 'Insurance' },
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'MEMBERSHIP_STARTED',
      occurredAt: '2026-03-01T10:00:00Z',
      metadata: { expiresAt: '2026-10-15T10:00:00Z' },
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'MEMBERSHIP_EXPIRED',
      occurredAt: '2026-04-01T10:00:00Z',
      metadata: {},
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'SERVICE_COMPLETED',
      occurredAt: '2026-08-01T10:00:00Z',
      metadata: { itemLabel: 'Oil service' },
    });
    const history = await listCustomerLifecycleHistory(first.tenant, first.customer.id);
    expect(history.lifecycleEvents).toHaveLength(5);
    expect(history.lifecycleEvents[0]!.type).toBe('SERVICE_COMPLETED');
    await expect(listCustomerLifecycleHistory(second.tenant, first.customer.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createCustomerLifecycleEvent(second.tenant, second.customer.id, {
      type: 'BOOKING_COMPLETED',
      occurredAt: '2026-05-01T10:00:00Z',
      relatedConversationId: first.conversation.id,
      metadata: {},
    })).rejects.toBeInstanceOf(CustomerLifecycleError);
    expect(await prisma.customerLifecycleEvent.findUnique({ where: { id: older.id } }))
      .toMatchObject({ businessId: first.business.id, customerId: first.customer.id });
  });

  it('replays only an explicit request key and rejects changed or foreign outcomes', async () => {
    const first = await fixture('Idempotent outcomes A');
    const second = await fixture('Idempotent outcomes B');
    const input = {
      requestKey: randomUUID(),
      type: 'PURCHASE_COMPLETED' as const,
      occurredAt: '2026-09-30T10:00:00Z',
      metadata: { itemLabel: 'Service', quantity: 1 },
    };
    const [one, two] = await Promise.all([1, 2].map(() =>
      createCustomerLifecycleEvent(first.tenant, first.customer.id, input)));
    expect(two.id).toBe(one.id);
    await expect(createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      ...input, metadata: { itemLabel: 'Different service' },
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(createCustomerLifecycleEvent(second.tenant, first.customer.id, input))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(recordMarketingPreference(second.tenant, first.customer.id, {
      consent: true, source: 'STAFF',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listTenantCustomers(second.tenant)).map(customer => customer.id))
      .not.toContain(first.customer.id);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: first.customer.id } }))
      .toMatchObject({ marketingConsentAt: null });
    expect(await prisma.customerLifecycleEvent.count({
      where: { businessId: first.business.id, customerId: first.customer.id },
    })).toBe(1);
    const { requestKey: _requestKey, ...withoutKey } = input;
    const distinct = await createCustomerLifecycleEvent(first.tenant, first.customer.id, withoutKey);
    expect(distinct.id).not.toBe(one.id);
    const otherBusinessEvent = await createCustomerLifecycleEvent(second.tenant, second.customer.id, input);
    expect(otherBusinessEvent.id).not.toBe(one.id);
  });

  it('keeps repeated attribution on the latest campaign instead of consuming older recipients', async () => {
    const context = await fixture('Attribution retries');
    const foreign = await fixture('Attribution foreign');
    const now = new Date('2026-09-30T10:00:00Z');
    const recipients = [];
    for (const [name, sentAt] of [
      ['Older', new Date('2026-09-25T10:00:00Z')],
      ['Latest', new Date('2026-09-29T10:00:00Z')],
    ] as const) {
      const campaign = await createTenantCampaignService(context.tenant).create({
        name, segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['PURCHASE_COMPLETED'] },
        templateName: 'return_offer', templateLanguage: 'en',
        templateBody: 'Welcome back.', templateParameters: [],
      });
      recipients.push(await prisma.campaignRecipient.create({
        data: {
          businessId: context.business.id, campaignId: campaign.id, customerId: context.customer.id,
          status: 'SENT', sentAt, matchedReasons: [], renderedMessage: 'Welcome back.',
        },
      }));
    }
    expect(await attributeCampaignReply(context.tenant, context.customer.id, now)).toBe(true);
    expect(await attributeCampaignReply(context.tenant, context.customer.id, now)).toBe(false);
    const outcome = await createCustomerLifecycleEvent(context.tenant, context.customer.id, {
      requestKey: randomUUID(), type: 'PURCHASE_COMPLETED', occurredAt: now,
    });
    expect(await attributeCampaignConversion(context.tenant, context.customer.id, outcome.id, now)).toBe(false);
    expect(await attributeCampaignConversion(foreign.tenant, context.customer.id, outcome.id, now)).toBe(false);
    expect(await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipients[0]!.id } }))
      .toMatchObject({ repliedAt: null, convertedAt: null, conversionLifecycleEventId: null });
    expect(await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipients[1]!.id } }))
      .toMatchObject({ repliedAt: now, convertedAt: now, conversionLifecycleEventId: outcome.id });
    const foreignService = createTenantCampaignService(foreign.tenant);
    await expect(foreignService.get(recipients[1]!.campaignId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(foreignService.cancel(recipients[1]!.campaignId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.campaign.findUniqueOrThrow({ where: { id: recipients[1]!.campaignId } }))
      .toMatchObject({ status: 'DRAFT' });
  });

  it('evaluates deterministic segments and never includes another tenant', async () => {
    const first = await fixture('Segments A');
    const second = await fixture('Segments B');
    const now = new Date('2026-09-30T12:00:00Z');
    await prisma.customer.update({
      where: { id: first.customer.id },
      data: { createdAt: new Date('2026-01-01T10:00:00Z') },
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'BOOKING_COMPLETED', occurredAt: '2026-05-01T10:00:00Z', metadata: {},
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'MEMBERSHIP_STARTED', occurredAt: '2026-05-01T10:00:00Z',
      metadata: { expiresAt: '2026-10-10T10:00:00Z' },
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'MEMBERSHIP_EXPIRED', occurredAt: '2026-08-01T10:00:00Z', metadata: {},
    });
    await createCustomerLifecycleEvent(first.tenant, first.customer.id, {
      type: 'SERVICE_COMPLETED', occurredAt: '2026-08-20T10:00:00Z', metadata: {},
    });
    await createCustomerLifecycleEvent(second.tenant, second.customer.id, {
      type: 'BOOKING_COMPLETED', occurredAt: '2026-05-01T10:00:00Z', metadata: {},
    });
    const segments = [
      { kind: 'PRIOR_LIFECYCLE' as const, eventTypes: ['BOOKING_COMPLETED' as const] },
      { kind: 'INACTIVE' as const, minimumInactiveDays: 60, eventTypes: ['BOOKING_COMPLETED' as const] },
      { kind: 'MEMBERSHIP_EXPIRING' as const, withinDays: 30 },
      { kind: 'MEMBERSHIP_EXPIRED' as const },
      { kind: 'SERVICE_DUE' as const, minimumDays: 30, maximumDays: 60 },
    ];
    for (const segment of segments) {
      const firstRun = await previewReactivationSegment(first.tenant, segment, now);
      const secondRun = await previewReactivationSegment(first.tenant, segment, now);
      expect(firstRun).toEqual(secondRun);
      expect(firstRun.map(item => item.customerId)).toContain(first.customer.id);
      expect(firstRun.map(item => item.customerId)).not.toContain(second.customer.id);
    }
  });

  it('previews exclusions, snapshots recipients, rechecks opt-out, and sends once', async () => {
    const context = await fixture('Campaign sending');
    await createCustomerLifecycleEvent(context.tenant, context.customer.id, {
      type: 'BOOKING_COMPLETED', occurredAt: '2026-01-01T10:00:00Z', metadata: {},
    });
    await recordMarketingPreference(context.tenant, context.customer.id, {
      consent: true, source: 'STAFF', evidence: 'Signed rental agreement checkbox.',
    });
    const service = createTenantCampaignService(context.tenant, {
      verifyTemplate: approvedTemplate,
    });
    const campaign = await service.create({
      name: 'Previous renters',
      segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['BOOKING_COMPLETED'] },
      templateName: 'previous_renter_offer',
      templateLanguage: 'en',
      templateBody: 'Hello, we have a new rental offer.',
      templateParameters: [],
    });
    const preview = await service.preview(campaign.id, new Date('2026-09-30T12:00:00Z'));
    expect(preview).toMatchObject({ matchedCount: 1, eligibleCount: 1 });
    expect(await prisma.whatsAppMessage.count({ where: { businessId: context.business.id } }))
      .toBe(0);
    const preparations = await Promise.allSettled([1, 2].map(() =>
      service.prepare(campaign.id, new Date('2026-09-30T12:00:00Z'))));
    expect(preparations.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(preparations.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.campaignRecipient.count({
      where: { businessId: context.business.id, campaignId: campaign.id },
    })).toBe(1);
    await service.launch(campaign.id, new Date('2026-09-30T12:01:00Z'));
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { businessId: context.business.id, campaignId: campaign.id },
    });
    await recordMarketingPreference(context.tenant, context.customer.id, {
      consent: false, source: 'STAFF',
    });
    const blockedSend = vi.fn();
    expect(await processCampaignRecipient(recipient.id, {
      verifyTemplate: approvedTemplate,
      sendTemplate: blockedSend,
    })).toBe('SKIPPED');
    expect(blockedSend).not.toHaveBeenCalled();
    expect(await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }))
      .toMatchObject({ status: 'SKIPPED', exclusionReasonCode: 'OPTED_OUT' });
  });

  it('prevents concurrent duplicate sends and tracks delivery, reply, and conversion', async () => {
    const context = await fixture('Campaign outcomes');
    await createCustomerLifecycleEvent(context.tenant, context.customer.id, {
      type: 'BOOKING_COMPLETED', occurredAt: '2026-01-01T10:00:00Z', metadata: {},
    });
    await recordMarketingPreference(context.tenant, context.customer.id, {
      consent: true, source: 'STAFF', evidence: 'Customer requested relevant offers.',
    });
    const service = createTenantCampaignService(context.tenant, {
      verifyTemplate: approvedTemplate,
    });
    const campaign = await service.create({
      name: 'Outcome tracking',
      segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['BOOKING_COMPLETED'] },
      templateName: 'customer_return_offer', templateLanguage: 'en',
      templateBody: 'Welcome back.', templateParameters: [],
    });
    await service.prepare(campaign.id, new Date('2026-09-30T12:00:00Z'));
    await service.launch(campaign.id, new Date('2026-09-30T12:01:00Z'));
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const externalMessageId = `wamid.s13-${randomUUID()}`;
    const provider = vi.fn().mockResolvedValue({
      provider: 'WHATSAPP', accepted: true, externalMessageId,
    });
    const sendTemplate = (input: Parameters<typeof sendWhatsAppTemplate>[0]) =>
      sendWhatsAppTemplate(input, { transport: { sendTemplate: provider } });
    const results = await Promise.all([1, 2].map(() => processCampaignRecipient(recipient.id, {
      verifyTemplate: approvedTemplate,
      sendTemplate,
    })));
    expect(results).toContain('SENT');
    expect(results).toContain('SKIPPED');
    expect(provider).toHaveBeenCalledTimes(1);
    await processDueCampaignRecipients({ verifyTemplate: approvedTemplate, sendTemplate });
    expect(await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } }))
      .toMatchObject({ status: 'COMPLETED' });
    const saved = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
      include: { conversationMessage: { include: { whatsappMessage: true } } },
    });
    expect(saved).toMatchObject({ status: 'SENT' });
    expect(saved.conversationMessage?.whatsappMessage).toMatchObject({
      deliveryStatus: 'SENT', externalMessageId,
    });

    const deliveredAt = new Date();
    const transportEvent = {
      provider: 'WHATSAPP' as const, externalMessageId,
      phoneNumberId: context.connection.phoneNumberId,
      recipientPhone: context.customer.whatsappPhone, timestamp: deliveredAt,
    };
    const transportTenant = { businessId: context.business.id, whatsappConnectionId: context.connection.id };
    await applyWhatsAppMessageStatusEvent(transportTenant, { ...transportEvent, status: 'DELIVERED' });
    await syncCampaignRecipientTransportStatus(context.tenant, externalMessageId, 'DELIVERED', deliveredAt);
    await applyWhatsAppMessageStatusEvent(transportTenant, { ...transportEvent, status: 'READ' });
    await syncCampaignRecipientTransportStatus(context.tenant, externalMessageId, 'READ', deliveredAt);
    await syncCampaignRecipientTransportStatus(context.tenant, externalMessageId, 'FAILED', deliveredAt);
    expect(await attributeCampaignReply(context.tenant, context.customer.id, deliveredAt)).toBe(true);
    const conversion = await createCustomerLifecycleEvent(context.tenant, context.customer.id, {
      type: 'PURCHASE_COMPLETED',
      occurredAt: deliveredAt.toISOString(),
      metadata: { itemLabel: 'Additional day' },
    });
    expect(await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }))
      .toMatchObject({
        deliveredAt,
        readAt: deliveredAt,
        repliedAt: deliveredAt,
        conversionLifecycleEventId: conversion.id,
        convertedAt: deliveredAt,
      });
    await expect(createTenantCampaignService((await fixture('Campaign foreign')).tenant)
      .get(campaign.id)).rejects.toBeInstanceOf(CampaignOperationError);
  });

  it('persists campaign retry backoff and stops after three definite failures', async () => {
    const context = await fixture('Campaign retry');
    await createCustomerLifecycleEvent(context.tenant, context.customer.id, {
      type: 'BOOKING_COMPLETED', occurredAt: '2026-01-01T10:00:00Z', metadata: {},
    });
    await recordMarketingPreference(context.tenant, context.customer.id, {
      consent: true, source: 'STAFF', evidence: 'Synthetic consent.',
    });
    const service = createTenantCampaignService(context.tenant, { verifyTemplate: approvedTemplate });
    const campaign = await service.create({
      name: 'Retry', segmentDefinition: { kind: 'PRIOR_LIFECYCLE', eventTypes: ['BOOKING_COMPLETED'] },
      templateName: 'customer_return_offer', templateLanguage: 'en',
      templateBody: 'Welcome back.', templateParameters: [],
    });
    await service.prepare(campaign.id);
    await service.launch(campaign.id);
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const provider = vi.fn().mockRejectedValue(new WhatsAppSendError({
      code: 'RATE_LIMITED', message: 'Synthetic rate limit.', retryable: true,
    }));
    const sendTemplate = (input: Parameters<typeof sendWhatsAppTemplate>[0]) =>
      sendWhatsAppTemplate(input, { transport: { sendTemplate: provider } });
    let now = new Date(Date.now() + 1_000);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await processCampaignRecipient(recipient.id, { verifyTemplate: approvedTemplate, sendTemplate, now: () => now }))
        .toBe(attempt < 3 ? 'DEFERRED' : 'FAILED');
      const current = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
      expect(current.attemptCount).toBe(attempt);
      if (attempt < 3) {
        expect(current.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
        expect(await processCampaignRecipient(recipient.id, { verifyTemplate: approvedTemplate, sendTemplate, now: () => now })).toBe('SKIPPED');
        expect(provider).toHaveBeenCalledTimes(attempt);
        now = new Date(current.nextAttemptAt.getTime() + 1);
      }
    }
    expect(provider).toHaveBeenCalledTimes(3);
    expect(await prisma.whatsAppMessage.count({ where: { businessId: context.business.id, direction: 'OUTBOUND' } })).toBe(1);
  });

  it('records exact inbound STOP as an absolute promotional opt-out', async () => {
    const context = await fixture('Inbound opt-out');
    await recordMarketingPreference(context.tenant, context.customer.id, {
      consent: true, source: 'STAFF', evidence: 'Customer consented in person.',
    });
    const repository = createTenantConversationRepository(context.tenant);
    await repository.appendMessage(context.conversation.id, {
      senderType: 'CUSTOMER', content: 'STOP!',
    });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: context.customer.id } }))
      .toMatchObject({ marketingOptOutSource: 'CUSTOMER' });
  });
});
