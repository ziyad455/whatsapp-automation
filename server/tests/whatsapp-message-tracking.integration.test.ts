import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { processInboundWhatsAppWebhook } from '../src/whatsapp/process-inbound-webhook';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import {
  applyWhatsAppMessageStatusEvent,
  claimInboundWhatsAppMessage,
  createPendingOutgoingWhatsAppMessage,
  findTenantWhatsAppMessageByExternalId,
  markInboundWhatsAppMessageFailed,
  markInboundWhatsAppMessageProcessed,
  markOutgoingWhatsAppMessageSent,
  startInboundWhatsAppMessageProcessing,
} from '../src/whatsapp/whatsapp-message.repository';
import { sendWhatsAppText } from '../src/whatsapp/whatsapp-send.service';
import { WhatsAppSendError } from '../src/whatsapp/whatsapp-send.types';
import { resolveWhatsAppTenant } from '../src/whatsapp/whatsapp-tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const appSecret = 'fake-message-tracking-secret';
const endpoint = 'http://localhost:4111/webhooks/whatsapp';

const createTestBusiness = (name: string) => createBusiness({
  name,
  category: 'CAR_RENTAL',
  timezone: 'Africa/Casablanca',
  currency: 'MAD',
  defaultLanguage: 'en',
  lifecycleStatus: 'ACTIVE',
});

const createTenant = async (name: string, phoneNumberId: string) => {
  const business = await createTestBusiness(name);
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId,
    whatsappBusinessAccountId: `8${phoneNumberId.slice(1)}`,
  });
  const tenant = await resolveWhatsAppTenant(phoneNumberId);
  if (!tenant) throw new Error('Expected WhatsApp tenant fixture to resolve.');
  return { business, connection, tenant };
};

const inboundPayload = (
  phoneNumberId: string,
  externalMessageId: string,
  text = 'When do you open?',
) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: '800000000000001',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: phoneNumberId },
        messages: [{
          from: '212600000001',
          id: externalMessageId,
          timestamp: '1789632000',
          type: 'text',
          text: { body: text },
        }],
      },
    }],
  }],
});

const signedRequest = (payload: unknown, valid = true): Request => {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', valid ? appSecret : 'wrong-secret')
    .update(body)
    .digest('hex');
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${signature}` },
    body,
  });
};

const statusEvent = (
  externalMessageId: string,
  phoneNumberId: string,
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  timestamp: Date,
) => ({
  provider: 'WHATSAPP' as const,
  externalMessageId,
  phoneNumberId,
  recipientPhone: '212600000001',
  status,
  timestamp,
});

describe('WhatsApp inbound idempotency and outbound status persistence', () => {
  beforeEach(async () => {
    await prisma.whatsAppMessage.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.whatsAppConnection.deleteMany();
    await prisma.conversationMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.business.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('atomically claims a reserved outbound attempt and rejects tenant substitution', async () => {
    const { tenant } = await createTenant('Outbound claim A', '898111111111111');
    const foreign = await createTenant('Outbound claim B', '898222222222222');
    const customer = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const reserved = await prisma.whatsAppMessage.create({ data: {
      businessId: tenant.businessId, whatsappConnectionId: tenant.whatsappConnectionId,
      customerId: customer.id, direction: 'OUTBOUND', recipientPhone: '212600000001',
      deliveryStatus: 'PENDING',
    } });
    const sendText = vi.fn().mockResolvedValue({
      provider: 'WHATSAPP', accepted: true, externalMessageId: 'wamid.atomic-send',
    });
    const input = { tenant, to: '212600000001', text: 'Hello', reservedTransportMessageId: reserved.id };
    await expect(sendWhatsAppText({ ...input, tenant: foreign.tenant }, { transport: { sendText } }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(sendText).not.toHaveBeenCalled();
    const outcomes = await Promise.allSettled([1, 2].map(() => sendWhatsAppText(input, { transport: { sendText } })));
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(sendText).toHaveBeenCalledOnce();
    await expect(prisma.whatsAppMessage.findUnique({ where: { id: reserved.id } }))
      .resolves.toMatchObject({ deliveryStatus: 'SENT', sendStartedAt: expect.any(Date) });
  });

  it('persists an auth circuit without disabling inbound tenant resolution', async () => {
    const { tenant } = await createTenant('Auth circuit', '898333333333333');
    const sendText = vi.fn().mockRejectedValue(new WhatsAppSendError({
      code: 'AUTHENTICATION', message: 'Credentials rejected.', retryable: false,
    }));
    const input = { tenant, to: '212600000001', text: 'Hello' };
    await expect(sendWhatsAppText(input, { transport: { sendText } })).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    await expect(sendWhatsAppText(input, { transport: { sendText } })).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' });
    expect(sendText).toHaveBeenCalledOnce();
    await expect(resolveWhatsAppTenant('898333333333333')).resolves.toMatchObject(tenant);
    await expect(prisma.whatsAppMessage.findFirst({ where: { businessId: tenant.businessId } }))
      .resolves.toMatchObject({ deliveryStatus: 'FAILED', failureCode: 'AUTHENTICATION' });
  });

  it('reclaims a stale pre-conversation inbound claim only on a real signed replay', async () => {
    const { tenant } = await createTenant('Stale claim', '898444444444444');
    const payload = inboundPayload('898444444444444', 'wamid.stale-claim');
    const first = await processInboundWhatsAppWebhook(signedRequest(payload), { appSecret });
    if (!first.accepted) throw new Error('Expected accepted fixture');
    const id = first.messages[0]!.inboxMessageId;
    await prisma.whatsAppMessage.update({ where: { id }, data: {
      updatedAt: new Date(Date.now() - 16 * 60_000),
    } });
    const replay = await processInboundWhatsAppWebhook(signedRequest(payload), { appSecret });
    expect(replay).toMatchObject({ accepted: true, messages: [{ inboxMessageId: id }] });
    const starts = await Promise.all([1, 2].map(() => startInboundWhatsAppMessageProcessing(tenant, id)));
    expect(starts.reduce((sum, item) => sum + item.count, 0)).toBe(1);
  });

  it('acknowledges an exact duplicate but exposes one downstream-eligible message', async () => {
    const { tenant } = await createTenant('Inbound Duplicate Tenant', '811111111111111');
    const payload = inboundPayload('811111111111111', 'wamid.inbound-duplicate');

    const first = await processInboundWhatsAppWebhook(signedRequest(payload), { appSecret });
    const duplicate = await processInboundWhatsAppWebhook(signedRequest(payload), { appSecret });
    const downstream = vi.fn();
    if (first.accepted) first.messages.forEach(downstream);
    if (duplicate.accepted) duplicate.messages.forEach(downstream);

    expect(first).toMatchObject({
      accepted: true,
      messages: [{ message: { externalMessageId: 'wamid.inbound-duplicate' } }],
      duplicates: [],
    });
    expect(duplicate).toMatchObject({
      accepted: true,
      messages: [],
      duplicates: [{ message: { externalMessageId: 'wamid.inbound-duplicate' } }],
    });
    expect(downstream).toHaveBeenCalledOnce();
    await expect(prisma.whatsAppMessage.count({
      where: { externalMessageId: 'wamid.inbound-duplicate' },
    })).resolves.toBe(1);
    await expect(prisma.customer.count({
      where: { businessId: tenant.businessId, whatsappPhone: '212600000001' },
    })).resolves.toBe(1);
    await expect(prisma.conversation.count()).resolves.toBe(0);
    await expect(prisma.conversationMessage.count()).resolves.toBe(0);
  });

  it('atomically allows one concurrent claim and rejects the other', async () => {
    await createTenant('Concurrent Inbound Claim', '822222222222222');
    const payload = inboundPayload('822222222222222', 'wamid.concurrent-claim');

    const results = await Promise.all([
      processInboundWhatsAppWebhook(signedRequest(payload), { appSecret }),
      processInboundWhatsAppWebhook(signedRequest(payload), { appSecret }),
    ]);

    expect(results.every(result => result.accepted)).toBe(true);
    expect(results.reduce(
      (total, result) => total + (result.accepted ? result.messages.length : 0),
      0,
    )).toBe(1);
    expect(results.reduce(
      (total, result) => total + (result.accepted ? result.duplicates.length : 0),
      0,
    )).toBe(1);
  });

  it('treats different Meta IDs as distinct even when sender and text match', async () => {
    await createTenant('Distinct Inbound IDs', '833333333333333');
    const first = await processInboundWhatsAppWebhook(signedRequest(
      inboundPayload('833333333333333', 'wamid.distinct-a', 'Same text'),
    ), { appSecret });
    const second = await processInboundWhatsAppWebhook(signedRequest(
      inboundPayload('833333333333333', 'wamid.distinct-b', 'Same text'),
    ), { appSecret });

    expect(first.accepted && first.messages).toHaveLength(1);
    expect(second.accepted && second.messages).toHaveLength(1);
    await expect(prisma.whatsAppMessage.count({
      where: { direction: 'INBOUND' },
    })).resolves.toBe(2);
  });

  it('does not claim a message with an invalid signature', async () => {
    await createTenant('Invalid Signature Claim', '844444444444444');

    await expect(processInboundWhatsAppWebhook(signedRequest(
      inboundPayload('844444444444444', 'wamid.invalid-signature'),
      false,
    ), { appSecret })).resolves.toEqual({
      accepted: false,
      status: 401,
      body: 'Unauthorized',
    });
    await expect(prisma.whatsAppMessage.count()).resolves.toBe(0);
  });

  it('keeps failed and incomplete inbound work recoverable through explicit state', async () => {
    const { tenant } = await createTenant('Inbound Recovery State', '855555555555555');
    const customer = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const inboundMessage = {
      provider: 'WHATSAPP',
      externalMessageId: 'wamid.recoverable-inbound',
      phoneNumberId: '855555555555555',
      customerPhone: '212600000001',
      type: 'TEXT',
      content: { text: 'Test' },
      timestamp: new Date('2026-09-18T09:00:00.000Z'),
    } as const;
    const claim = await claimInboundWhatsAppMessage(
      tenant,
      customer.id,
      inboundMessage,
    );
    if (claim.outcome !== 'CLAIMED') throw new Error('Expected initial claim.');

    await startInboundWhatsAppMessageProcessing(tenant, claim.messageId);
    await markInboundWhatsAppMessageFailed(tenant, claim.messageId);
    const reclaimed = await claimInboundWhatsAppMessage(
      tenant,
      customer.id,
      inboundMessage,
    );
    expect(reclaimed).toEqual({ outcome: 'CLAIMED', messageId: claim.messageId });
    if (reclaimed.outcome !== 'CLAIMED') throw new Error('Expected failed claim retry.');
    await startInboundWhatsAppMessageProcessing(tenant, reclaimed.messageId);
    await markInboundWhatsAppMessageProcessed(tenant, reclaimed.messageId);

    await expect(prisma.whatsAppMessage.findUnique({
      where: { id: claim.messageId },
      select: { processingStatus: true, processedAt: true },
    })).resolves.toMatchObject({
      processingStatus: 'PROCESSED',
      processedAt: expect.any(Date),
    });
  });

  it('enforces external message ID uniqueness in PostgreSQL', async () => {
    const { tenant } = await createTenant('Inbound Unique Constraint', '866666666666666');
    const customer = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const data = {
      businessId: tenant.businessId,
      whatsappConnectionId: tenant.whatsappConnectionId,
      customerId: customer.id,
      direction: 'INBOUND' as const,
      externalMessageId: 'wamid.database-unique',
      processingStatus: 'RECEIVED' as const,
    };

    await prisma.whatsAppMessage.create({ data });
    await expect(prisma.whatsAppMessage.create({ data })).rejects.toThrow();
  });

  it('persists the outbound Meta ID and SENT state after API acceptance', async () => {
    const { tenant } = await createTenant('Outbound Persistence', '877777777777777');

    await expect(sendWhatsAppText({
      tenant,
      to: '212600000001',
      text: 'WhatsApp integration test',
    }, {
      transport: {
        sendText: vi.fn().mockResolvedValue({
          provider: 'WHATSAPP',
          accepted: true,
          externalMessageId: 'wamid.persisted-outbound',
        }),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    })).resolves.toMatchObject({ externalMessageId: 'wamid.persisted-outbound' });

    await expect(findTenantWhatsAppMessageByExternalId(
      tenant,
      'wamid.persisted-outbound',
    )).resolves.toMatchObject({
      direction: 'OUTBOUND',
      deliveryStatus: 'SENT',
      recipientPhone: '212600000001',
      sentAt: expect.any(Date),
    });
  });

  it('applies SENT, DELIVERED, and READ monotonically and ignores duplicates/regression', async () => {
    const { tenant } = await createTenant('Status Progression', '888888888888888');
    const customer = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const pending = await createPendingOutgoingWhatsAppMessage({
      tenant,
      customerId: customer.id,
      recipientPhone: '212600000001',
    });
    await prisma.whatsAppMessage.update({
      where: { id: pending.id },
      data: { externalMessageId: 'wamid.status-progression' },
    });
    const sent = statusEvent(
      'wamid.status-progression',
      '888888888888888',
      'SENT',
      new Date('2026-09-18T09:00:01.000Z'),
    );
    const delivered = statusEvent(
      'wamid.status-progression',
      '888888888888888',
      'DELIVERED',
      new Date('2026-09-18T09:00:02.000Z'),
    );
    const read = statusEvent(
      'wamid.status-progression',
      '888888888888888',
      'READ',
      new Date('2026-09-18T09:00:03.000Z'),
    );

    await expect(applyWhatsAppMessageStatusEvent(tenant, sent)).resolves.toMatchObject({
      outcome: 'APPLIED',
      status: 'SENT',
    });
    await expect(applyWhatsAppMessageStatusEvent(tenant, delivered)).resolves.toMatchObject({
      outcome: 'APPLIED',
      status: 'DELIVERED',
    });
    await expect(applyWhatsAppMessageStatusEvent(tenant, delivered)).resolves.toMatchObject({
      outcome: 'IGNORED',
      status: 'DELIVERED',
    });
    await expect(applyWhatsAppMessageStatusEvent(tenant, read)).resolves.toMatchObject({
      outcome: 'APPLIED',
      status: 'READ',
    });
    await expect(applyWhatsAppMessageStatusEvent(tenant, read)).resolves.toMatchObject({
      outcome: 'IGNORED',
      status: 'READ',
    });
    await expect(applyWhatsAppMessageStatusEvent(tenant, delivered)).resolves.toMatchObject({
      outcome: 'IGNORED',
      status: 'READ',
    });
    await expect(findTenantWhatsAppMessageByExternalId(
      tenant,
      'wamid.status-progression',
    )).resolves.toMatchObject({
      deliveryStatus: 'READ',
      deliveredAt: new Date('2026-09-18T09:00:02.000Z'),
      readAt: new Date('2026-09-18T09:00:03.000Z'),
    });
  });

  it('persists safe failed-status metadata', async () => {
    const { tenant } = await createTenant('Failed Status', '899999999999999');
    const customer = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const pending = await createPendingOutgoingWhatsAppMessage({
      tenant,
      customerId: customer.id,
      recipientPhone: '212600000001',
    });
    await markOutgoingWhatsAppMessageSent(tenant, pending.id, 'wamid.failed-status');

    await applyWhatsAppMessageStatusEvent(tenant, {
      ...statusEvent(
        'wamid.failed-status',
        '899999999999999',
        'FAILED',
        new Date('2026-09-18T09:10:00.000Z'),
      ),
      failureCode: '131000',
      failureTitle: 'Provider delivery failed',
      failureDetails: 'Safe diagnostic details',
    });

    await expect(findTenantWhatsAppMessageByExternalId(
      tenant,
      'wamid.failed-status',
    )).resolves.toMatchObject({
      deliveryStatus: 'FAILED',
      failedAt: new Date('2026-09-18T09:10:00.000Z'),
      failureCode: '131000',
      failureTitle: 'Provider delivery failed',
      failureDetails: 'Safe diagnostic details',
    });
  });

  it('does not mutate another tenant for unknown or cross-tenant status IDs', async () => {
    const [atlas, barber] = await Promise.all([
      createTenant('Status Isolation Atlas', '811111111111112'),
      createTenant('Status Isolation Barber', '811111111111113'),
    ]);
    const customer = await resolveOrCreateWhatsAppCustomer(
      atlas.tenant,
      '212600000001',
    );
    const pending = await createPendingOutgoingWhatsAppMessage({
      tenant: atlas.tenant,
      customerId: customer.id,
      recipientPhone: '212600000001',
    });
    await markOutgoingWhatsAppMessageSent(
      atlas.tenant,
      pending.id,
      'wamid.tenant-a-only',
    );

    await expect(applyWhatsAppMessageStatusEvent(
      barber.tenant,
      statusEvent(
        'wamid.tenant-a-only',
        '811111111111113',
        'READ',
        new Date(),
      ),
    )).resolves.toEqual({ outcome: 'UNKNOWN' });
    await expect(applyWhatsAppMessageStatusEvent(
      atlas.tenant,
      statusEvent(
        'wamid.unknown',
        '811111111111112',
        'READ',
        new Date(),
      ),
    )).resolves.toEqual({ outcome: 'UNKNOWN' });
    await expect(findTenantWhatsAppMessageByExternalId(
      atlas.tenant,
      'wamid.tenant-a-only',
    )).resolves.toMatchObject({ deliveryStatus: 'SENT', readAt: null });
  });
});
