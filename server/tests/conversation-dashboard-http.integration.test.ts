import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';
import { startMastraServer } from './helpers/mastra-server';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const dashboardOrigin = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const fakePassword = 'fake-conversation-http-password-123';
const email = `conversation-http-${randomUUID()}@example.test`;

let server: Awaited<ReturnType<typeof startMastraServer>>;
let cookie: string;
let businessId: string;
let foreignBusinessId: string;
let userId: string;
let conversationId: string;
let foreignConversationId: string;

const request = (path: string, init?: RequestInit) =>
  fetch(`${server.baseUrl}${path}`, {
    ...init,
    headers: { origin: dashboardOrigin, ...init?.headers },
  });

const seedConversation = async (
  targetBusinessId: string,
  phoneNumberId: string,
  customerPhone: string,
) => {
  const connection = await createWhatsAppConnection({
    businessId: targetBusinessId,
    phoneNumberId,
    whatsappBusinessAccountId: `77${phoneNumberId}`,
    displayPhoneNumber: `+${phoneNumberId}`,
  });
  const tenant = {
    businessId: targetBusinessId,
    whatsappConnectionId: connection.id,
  };
  const customer = await resolveOrCreateWhatsAppCustomer(tenant, customerPhone);
  const conversation = await resolveChannelConversation(
    { businessId: targetBusinessId },
    {
      channel: 'WHATSAPP',
      participantKey: customer.id,
      customerId: customer.id,
      whatsappConnectionId: connection.id,
      createIfMissing: true,
    },
  );
  if (!conversation) throw new Error('Expected seeded conversation.');
  await createTenantConversationRepository({ businessId: targetBusinessId })
    .appendMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: 'Hello from the HTTP inbox fixture.',
    });
  return conversation.id;
};

describe('Sprint 10 conversation dashboard HTTP API', () => {
  beforeAll(async () => {
    const user = await setupAuth.api.signUpEmail({
      body: { email, name: 'Conversation HTTP Owner', password: fakePassword },
    });
    userId = user.user.id;
    const business = await createBusiness({
      name: 'Conversation HTTP Atlas',
      category: 'CAR_RENTAL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'en',
      lifecycleStatus: 'ACTIVE',
    });
    const foreignBusiness = await createBusiness({
      name: 'Conversation HTTP Foreign',
      category: 'SALON',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    businessId = business.id;
    foreignBusinessId = foreignBusiness.id;
    await createMembership({ userId, businessId, role: 'OWNER' });
    conversationId = await seedConversation(
      businessId,
      '992000000001',
      '212622000001',
    );
    foreignConversationId = await seedConversation(
      foreignBusinessId,
      '992000000002',
      '212622000002',
    );

    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4216,
    });
    const signIn = await request('/auth/api/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: fakePassword }),
    });
    cookie = signIn.headers.getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ');
  });

  afterAll(async () => {
    await server?.stop();
    if (businessId && foreignBusinessId) {
      await prisma.conversation.updateMany({
        where: { businessId: { in: [businessId, foreignBusinessId] } },
        data: { assignedBusinessUserId: null },
      });
      await prisma.business.deleteMany({
        where: { id: { in: [businessId, foreignBusinessId] } },
      });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await closeDatabaseConnection();
  });

  it('lists and loads only conversations owned by the selected membership tenant', async () => {
    const headers = { cookie, 'x-business-id': businessId };
    const list = await request('/dashboard/conversations', { headers });
    const own = await request(`/dashboard/conversations/${conversationId}`, { headers });
    const foreign = await request(`/dashboard/conversations/${foreignConversationId}`, { headers });

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      conversations: [
        expect.objectContaining({ id: conversationId }),
      ],
    });
    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({
      conversation: {
        id: conversationId,
        messages: [expect.objectContaining({ senderType: 'CUSTOMER' })],
      },
    });
    expect(foreign.status).toBe(404);
  });

  it('authorizes server-side takeover and rejects forged or cross-tenant controls', async () => {
    const headers = {
      cookie,
      'content-type': 'application/json',
      'x-business-id': businessId,
    };
    const forged = await request(`/dashboard/conversations/${conversationId}/mode`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'HUMAN', businessId: foreignBusinessId }),
    });
    const foreign = await request(`/dashboard/conversations/${foreignConversationId}/mode`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'HUMAN' }),
    });
    const takeover = await request(`/dashboard/conversations/${conversationId}/mode`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'HUMAN' }),
    });

    expect(forged.status).toBe(400);
    expect(foreign.status).toBe(404);
    expect(takeover.status).toBe(200);
    await expect(takeover.json()).resolves.toMatchObject({
      conversation: {
        id: conversationId,
        mode: 'HUMAN',
        handoffReason: 'MANUAL',
        assignment: { userId },
      },
    });
  });
});
