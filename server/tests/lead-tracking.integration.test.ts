import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import {
  captureLeadFromCustomerMessage,
  createTenantLeadDashboardService,
  refreshLeadSummary,
} from '../src/leads/tenant-lead.service';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import type { WhatsAppTenantContext } from '../src/whatsapp/whatsapp-tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

interface Fixture {
  readonly businessId: string;
  readonly userId: string;
  readonly tenant: TenantContext;
  readonly whatsappTenant: WhatsAppTenantContext;
}

let fixtureA: Fixture;
let fixtureB: Fixture;
let phoneSequence = 0;

const createFixture = async (label: string): Promise<Fixture> => {
  const user = await prisma.user.create({
    data: {
      name: `${label} Lead Operator`,
      email: `s11-${label.toLowerCase()}-${randomUUID()}@example.test`,
      emailVerified: true,
    },
  });
  const business = await createBusiness({
    name: `${label} Lead Business`,
    category: label === 'Atlas' ? 'CAR_RENTAL' : 'SALON',
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'en',
    lifecycleStatus: 'ACTIVE',
  });
  const membership = await createMembership({
    userId: user.id,
    businessId: business.id,
    role: 'OWNER',
  });
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId: `993${Math.floor(Math.random() * 1_000_000_000)}`,
    whatsappBusinessAccountId: `994${Math.floor(Math.random() * 1_000_000_000)}`,
    displayPhoneNumber: '+15552036630',
  });
  return {
    businessId: business.id,
    userId: user.id,
    tenant: {
      businessId: business.id,
      membershipId: membership.id,
      userId: user.id,
      role: membership.role,
    },
    whatsappTenant: {
      businessId: business.id,
      whatsappConnectionId: connection.id,
    },
  };
};

const createConversation = async (fixture: Fixture) => {
  phoneSequence += 1;
  const customer = await resolveOrCreateWhatsAppCustomer(
    fixture.whatsappTenant,
    `212633${String(phoneSequence).padStart(6, '0')}`,
  );
  const conversation = await resolveChannelConversation(
    { businessId: fixture.businessId },
    {
      channel: 'WHATSAPP',
      participantKey: customer.id,
      customerId: customer.id,
      whatsappConnectionId: fixture.whatsappTenant.whatsappConnectionId,
      createIfMissing: true,
    },
  );
  if (!conversation) throw new Error('Expected a test conversation.');
  return {
    customer,
    conversation,
    repository: createTenantConversationRepository({ businessId: fixture.businessId }),
  };
};

const appendCustomerMessage = async (
  fixture: Fixture,
  content: string,
  existing?: Awaited<ReturnType<typeof createConversation>>,
) => {
  const context = existing ?? await createConversation(fixture);
  const message = await context.repository.appendMessage(context.conversation.id, {
    senderType: 'CUSTOMER',
    content,
  });
  return { ...context, message };
};

describe('Sprint 11 tenant-scoped Lead tracking', () => {
  beforeAll(async () => {
    fixtureA = await createFixture('Atlas');
    fixtureB = await createFixture('Nour');
  });

  afterAll(async () => {
    if (fixtureA && fixtureB) {
      await prisma.business.deleteMany({
        where: { id: { in: [fixtureA.businessId, fixtureB.businessId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [fixtureA.userId, fixtureB.userId] } },
      });
    }
    await closeDatabaseConnection();
  });

  it('ignores information-only messages, then creates and enriches one active opportunity', async () => {
    const first = await appendCustomerMessage(fixtureA, 'How much is the Clio?');
    const information = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: first.message.id,
        detectedIntent: 'PRICE_INQUIRY',
      },
    );
    expect(information).toMatchObject({ leadId: null, created: false });

    const qualifying = await appendCustomerMessage(
      fixtureA,
      'I need it for 5 days starting Monday.',
      first,
    );
    const created = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: qualifying.message.id,
        detectedIntent: 'PURCHASE_INTENT',
      },
    );
    expect(created).toMatchObject({ created: true, evidenceAdded: true });

    const budget = await appendCustomerMessage(
      fixtureA,
      'My budget is 1500 MAD.',
      first,
    );
    const updated = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: budget.message.id,
        detectedIntent: 'UNKNOWN',
      },
    );
    const duplicate = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: budget.message.id,
        detectedIntent: 'UNKNOWN',
      },
    );

    expect(updated).toMatchObject({ leadId: created.leadId, created: false, evidenceAdded: true });
    expect(duplicate).toMatchObject({ leadId: created.leadId, evidenceAdded: false });
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: created.leadId! },
      include: { evidence: true },
    });
    expect(lead).toMatchObject({
      businessId: fixtureA.businessId,
      customerId: first.customer.id,
      conversationId: first.conversation.id,
      status: 'NEW',
      statusSource: 'AUTOMATIC',
    });
    expect(lead.evidence).toHaveLength(3);
    expect(lead.evidence.map(item => item.messageId)).toEqual(expect.arrayContaining([
      first.message.id,
      qualifying.message.id,
      budget.message.id,
    ]));
  });

  it('uses a database constraint to collapse concurrent qualifying messages into one active Lead', async () => {
    const first = await appendCustomerMessage(
      fixtureA,
      'I need a car for 4 days starting Tuesday.',
    );
    const second = await appendCustomerMessage(
      fixtureA,
      'I want to reserve it tomorrow.',
      first,
    );
    await Promise.all([
      captureLeadFromCustomerMessage({ businessId: fixtureA.businessId }, {
        conversationId: first.conversation.id,
        messageId: first.message.id,
        detectedIntent: 'PURCHASE_INTENT',
      }),
      captureLeadFromCustomerMessage({ businessId: fixtureA.businessId }, {
        conversationId: first.conversation.id,
        messageId: second.message.id,
        detectedIntent: 'BOOKING_INTENT',
      }),
    ]);

    const leads = await prisma.lead.findMany({
      where: {
        businessId: fixtureA.businessId,
        conversationId: first.conversation.id,
        status: { in: ['NEW', 'INTERESTED', 'QUALIFIED'] },
      },
      include: { evidence: true },
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]?.evidence).toHaveLength(2);
  });

  it('blocks cross-tenant reads, status changes, summaries, and evidence references', async () => {
    const own = await appendCustomerMessage(fixtureA, 'I want to reserve a Clio tomorrow.');
    const capture = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: own.conversation.id,
        messageId: own.message.id,
        detectedIntent: 'BOOKING_INTENT',
      },
    );
    const foreign = await appendCustomerMessage(fixtureB, 'I want a keratin appointment Friday.');

    const serviceB = createTenantLeadDashboardService(fixtureB.tenant);
    await expect(serviceB.getById(capture.leadId!)).resolves.toBeNull();
    await expect(serviceB.setStatus(capture.leadId!, 'QUALIFIED'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(refreshLeadSummary(
      { businessId: fixtureB.businessId },
      capture.leadId!,
      async () => ({
        summary: 'Should never run.', keyFacts: [], constraints: [], missingImportantInfo: [],
      }),
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(prisma.leadEvidence.create({
      data: {
        businessId: fixtureA.businessId,
        leadId: capture.leadId!,
        conversationId: own.conversation.id,
        messageId: foreign.message.id,
        evidenceTypes: ['BOOKING_INTENT'],
      },
    })).rejects.toBeDefined();
  });

  it('audits human lifecycle control and automatic evidence never overwrites it', async () => {
    const first = await appendCustomerMessage(fixtureA, 'I want to buy the Clio tomorrow.');
    const capture = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: first.message.id,
        detectedIntent: 'PURCHASE_INTENT',
      },
    );
    const service = createTenantLeadDashboardService(fixtureA.tenant);
    const qualified = await service.setStatus(capture.leadId!, 'QUALIFIED');
    expect(qualified).toMatchObject({ status: 'QUALIFIED', statusSource: 'MANUAL' });

    const budget = await appendCustomerMessage(fixtureA, 'Budget 1700 MAD.', first);
    await captureLeadFromCustomerMessage({ businessId: fixtureA.businessId }, {
      conversationId: first.conversation.id,
      messageId: budget.message.id,
      detectedIntent: 'UNKNOWN',
    });
    const unchanged = await prisma.lead.findUniqueOrThrow({ where: { id: capture.leadId! } });
    expect(unchanged).toMatchObject({ status: 'QUALIFIED', statusSource: 'MANUAL' });

    const audit = await prisma.auditEvent.findFirst({
      where: {
        businessId: fixtureA.businessId,
        targetType: 'LEAD',
        targetId: capture.leadId!,
        action: 'STATUS_CHANGE',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ actorUserId: fixtureA.userId });

    await expect(service.setStatus(capture.leadId!, 'WON')).resolves.toMatchObject({
      status: 'WON',
      statusSource: 'MANUAL',
    });
  });

  it('persists validated summaries while enrichment failures preserve the previous summary and status', async () => {
    const first = await appendCustomerMessage(
      fixtureA,
      'I need an automatic Clio for 5 days starting Monday.',
    );
    const capture = await captureLeadFromCustomerMessage(
      { businessId: fixtureA.businessId },
      {
        conversationId: first.conversation.id,
        messageId: first.message.id,
        detectedIntent: 'PURCHASE_INTENT',
      },
    );
    await refreshLeadSummary({ businessId: fixtureA.businessId }, capture.leadId!, async () => ({
      summary: 'Customer wants an automatic Clio for 5 days starting Monday.',
      keyFacts: [
        { label: 'Vehicle', value: 'automatic Clio' },
        { label: 'Duration', value: '5 days' },
      ],
      constraints: ['Starting Monday'],
      missingImportantInfo: ['BUDGET'],
    }));
    const beforeFailure = await prisma.lead.findUniqueOrThrow({ where: { id: capture.leadId! } });

    await expect(refreshLeadSummary(
      { businessId: fixtureA.businessId },
      capture.leadId!,
      async () => { throw new Error('Provider unavailable'); },
    )).rejects.toThrow('Provider unavailable');
    const afterFailure = await prisma.lead.findUniqueOrThrow({ where: { id: capture.leadId! } });
    expect(afterFailure.summary).toBe(beforeFailure.summary);
    expect(afterFailure.summaryDetails).toEqual(beforeFailure.summaryDetails);
    expect(afterFailure.status).toBe(beforeFailure.status);
  });
});
