import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { captureLeadFromCustomerMessage } from '../src/leads/tenant-lead.service';
import { createMembership } from '../src/memberships/business-user.repository';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';
import { startMastraServer } from './helpers/mastra-server';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const dashboardOrigin = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const fakePassword = 'fake-lead-http-password-123';
const email = `lead-http-${randomUUID()}@example.test`;

let server: Awaited<ReturnType<typeof startMastraServer>>;
let cookie: string;
let businessId: string;
let foreignBusinessId: string;
let userId: string;
let leadId: string;
let foreignLeadId: string;

const request = (path: string, init?: RequestInit) =>
  fetch(`${server.baseUrl}${path}`, {
    ...init,
    headers: { origin: dashboardOrigin, ...init?.headers },
  });

const seedLead = async (
  targetBusinessId: string,
  phoneNumberId: string,
  customerPhone: string,
) => {
  const connection = await createWhatsAppConnection({
    businessId: targetBusinessId,
    phoneNumberId,
    whatsappBusinessAccountId: `66${phoneNumberId}`,
    displayPhoneNumber: `+${phoneNumberId}`,
  });
  const whatsappTenant = { businessId: targetBusinessId, whatsappConnectionId: connection.id };
  const customer = await resolveOrCreateWhatsAppCustomer(whatsappTenant, customerPhone);
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
  if (!conversation) throw new Error('Expected seeded Lead conversation.');
  const message = await createTenantConversationRepository({ businessId: targetBusinessId })
    .appendMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: 'I want to reserve a service tomorrow.',
    });
  const capture = await captureLeadFromCustomerMessage({ businessId: targetBusinessId }, {
    conversationId: conversation.id,
    messageId: message.id,
    detectedIntent: 'BOOKING_INTENT',
  });
  if (!capture.leadId) throw new Error('Expected a seeded Lead.');
  return capture.leadId;
};

describe('Sprint 11 Lead dashboard HTTP API', () => {
  beforeAll(async () => {
    const user = await setupAuth.api.signUpEmail({
      body: { email, name: 'Lead HTTP Owner', password: fakePassword },
    });
    userId = user.user.id;
    const business = await createBusiness({
      name: 'Lead HTTP Atlas',
      category: 'CAR_RENTAL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'en',
      lifecycleStatus: 'ACTIVE',
    });
    const foreignBusiness = await createBusiness({
      name: 'Lead HTTP Foreign',
      category: 'SALON',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    businessId = business.id;
    foreignBusinessId = foreignBusiness.id;
    await createMembership({ userId, businessId, role: 'OWNER' });
    leadId = await seedLead(businessId, '995000000001', '212644000001');
    foreignLeadId = await seedLead(foreignBusinessId, '995000000002', '212644000002');

    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4217,
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
      await prisma.business.deleteMany({
        where: { id: { in: [businessId, foreignBusinessId] } },
      });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await closeDatabaseConnection();
  });

  it('lists only tenant-owned Leads and enforces status filters', async () => {
    const headers = { cookie, 'x-business-id': businessId };
    const all = await request('/dashboard/leads', { headers });
    const won = await request('/dashboard/leads?status=WON', { headers });

    expect(all.status).toBe(200);
    const allBody = await all.json() as { leads: Array<{ id: string }> };
    expect(allBody.leads.map(lead => lead.id)).toContain(leadId);
    expect(allBody.leads.map(lead => lead.id)).not.toContain(foreignLeadId);
    expect(won.status).toBe(200);
    await expect(won.json()).resolves.toMatchObject({ leads: [] });
  });

  it('authorizes staff status changes and hides foreign Lead IDs as not found', async () => {
    const headers = {
      cookie,
      'content-type': 'application/json',
      'x-business-id': businessId,
    };
    const foreign = await request(`/dashboard/leads/${foreignLeadId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'QUALIFIED' }),
    });
    const forged = await request(`/dashboard/leads/${leadId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'QUALIFIED', businessId: foreignBusinessId }),
    });
    const own = await request(`/dashboard/leads/${leadId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'QUALIFIED' }),
    });

    expect(foreign.status).toBe(404);
    expect(forged.status).toBe(400);
    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({
      lead: { id: leadId, status: 'QUALIFIED', statusSource: 'MANUAL' },
    });
  });

  it('validates tenant policy and requires an explicit consent attestation', async () => {
    const headers = {
      cookie, 'content-type': 'application/json', 'x-business-id': businessId,
    };
    const settings = {
      followUpsEnabled: true,
      initialFollowUpDelayMinutes: 30,
      followUpWindowStartMinutes: 540,
      followUpWindowEndMinutes: 1200,
      maxFollowUpsPerLead: 1,
      minimumFollowUpIntervalMinutes: 1440,
    };
    const invalid = await request('/dashboard/follow-up-settings', {
      method: 'PUT', headers, body: JSON.stringify({ ...settings, initialFollowUpDelayMinutes: 0 }),
    });
    expect(invalid.status).toBe(400);
    const updated = await request('/dashboard/follow-up-settings', {
      method: 'PUT', headers, body: JSON.stringify(settings),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ settings });
    const foreign = await request(`/dashboard/leads/${foreignLeadId}/follow-up-consent`, {
      method: 'POST', headers, body: JSON.stringify({ consent: true, staffAttestation: true }),
    });
    expect(foreign.status).toBe(404);
    const unattested = await request(`/dashboard/leads/${leadId}/follow-up-consent`, {
      method: 'POST', headers, body: JSON.stringify({ consent: true }),
    });
    expect(unattested.status).toBe(400);
    const own = await request(`/dashboard/leads/${leadId}/follow-up-consent`, {
      method: 'POST', headers, body: JSON.stringify({ consent: true, staffAttestation: true }),
    });
    expect(own.status).toBe(200);
    const pending = await prisma.followUp.findFirst({ where: { businessId, leadId } });
    expect(pending?.status).toBe('PENDING');
    const withdrawn = await request(`/dashboard/leads/${leadId}/follow-up-consent`, {
      method: 'POST', headers, body: JSON.stringify({ consent: false, staffAttestation: true }),
    });
    expect(withdrawn.status).toBe(200);
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: pending!.id } }))
      .toMatchObject({ status: 'CANCELLED', reasonCode: 'CUSTOMER_OPTED_OUT' });
  });
});
