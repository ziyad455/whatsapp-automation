import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';
import { startMastraServer } from './helpers/mastra-server';

assertIsolatedTestDatabase();

const appSecret = 'test-only-whatsapp-app-secret';
const verifyToken = 'test-only-whatsapp-verify-token';
const phoneNumberId = '999999999999999';

let server: Awaited<ReturnType<typeof startMastraServer>>;
let businessId: string;

const payload = `{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "900000000000009",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "${phoneNumberId}" },
        "statuses": [{
          "recipient_id": "212600000001",
          "id": "wamid.http-test",
          "timestamp": "1789632000",
          "status": "sent"
        }]
      }
    }]
  }]
}`;

const signatureFor = (body: string): string =>
  `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;

describe('WhatsApp webhook HTTP route', () => {
  beforeAll(async () => {
    const business = await createBusiness({
      name: 'WhatsApp HTTP Test Business',
      category: 'CAR_RENTAL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'en',
      lifecycleStatus: 'ACTIVE',
    });
    businessId = business.id;
    await createWhatsAppConnection({
      businessId,
      phoneNumberId,
      whatsappBusinessAccountId: '900000000000009',
    });
    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4220,
      whatsappAppSecret: appSecret,
      whatsappVerifyToken: verifyToken,
    });
  });

  afterAll(async () => {
    await server?.stop();
    if (businessId) await prisma.business.delete({ where: { id: businessId } });
    await closeDatabaseConnection();
  });

  it('accepts a signed POST using the exact raw request body', async () => {
    const response = await fetch(`${server.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signatureFor(payload),
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('OK');
  });

  it('rejects a POST whose body no longer matches its signature', async () => {
    const response = await fetch(`${server.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signatureFor(payload),
      },
      body: payload.replace('"status": "sent"', '"status": "read"'),
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe('Unauthorized');
  });

  it('keeps GET subscription verification independent', async () => {
    const url = new URL('/webhooks/whatsapp', server.baseUrl);
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', verifyToken);
    url.searchParams.set('hub.challenge', '654321');

    const response = await fetch(url);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('654321');
  });
});
