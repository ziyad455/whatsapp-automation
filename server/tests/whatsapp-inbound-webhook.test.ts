import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { normalizeWhatsAppWebhook } from '../src/whatsapp/normalize-inbound-message';
import { processInboundWhatsAppWebhook } from '../src/whatsapp/process-inbound-webhook';
import { whatsappWebhookRoutes } from '../src/http/whatsapp-webhook-routes';

const appSecret = 'fake-meta-app-secret-for-tests-only';
const endpoint = 'http://localhost:4111/webhooks/whatsapp';

const textChange = (
  phoneNumberId: string,
  customerPhone: string,
  externalMessageId: string,
  text = 'When do you open?',
) => ({
  field: 'messages',
  value: {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: '15550000000',
      phone_number_id: phoneNumberId,
    },
    contacts: [{ profile: { name: 'Test Customer' }, wa_id: customerPhone }],
    messages: [{
      from: customerPhone,
      id: externalMessageId,
      timestamp: '1789632000',
      text: { body: text },
      type: 'text',
    }],
  },
});

const payloadWith = (...changes: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '100000000000001', changes }],
});

const signedRequest = (body: string, signatureBody = body): Request => {
  const signature = createHmac('sha256', appSecret).update(signatureBody).digest('hex');
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  });
};

describe('WhatsApp inbound webhook boundary', () => {
  it('registers POST as a public Mastra route alongside GET verification', () => {
    expect(whatsappWebhookRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/webhooks/whatsapp',
        method: 'GET',
        requiresAuth: false,
      }),
      expect.objectContaining({
        path: '/webhooks/whatsapp',
        method: 'POST',
        requiresAuth: false,
      }),
    ]));
  });

  it('accepts a valid signature and resolves the receiving number', async () => {
    const body = JSON.stringify(payloadWith(
      textChange('111111111111111', '212600000001', 'wamid.test-1'),
    ));
    const tenant = {
      businessId: randomUUID(),
      whatsappConnectionId: randomUUID(),
    };
    const resolveTenant = vi.fn().mockResolvedValue(tenant);

    const result = await processInboundWhatsAppWebhook(signedRequest(body), {
      appSecret,
      resolveTenant,
    });

    expect(result).toMatchObject({
      accepted: true,
      status: 200,
      messages: [{
        message: {
          externalMessageId: 'wamid.test-1',
          phoneNumberId: '111111111111111',
          customerPhone: '212600000001',
        },
        tenant,
      }],
    });
    expect(resolveTenant).toHaveBeenCalledWith('111111111111111');
  });

  it('acknowledges an authentic message for an unmapped receiving number without fallback', async () => {
    const body = JSON.stringify(payloadWith(
      textChange('444444444444444', '212600000001', 'wamid.unmapped'),
    ));
    const resolveTenant = vi.fn().mockResolvedValue(null);

    const result = await processInboundWhatsAppWebhook(signedRequest(body), {
      appSecret,
      resolveTenant,
    });

    expect(result).toMatchObject({
      accepted: true,
      status: 200,
      messages: [{ tenant: null }],
    });
    expect(resolveTenant).toHaveBeenCalledExactlyOnceWith('444444444444444');
  });

  it.each([
    ['wrong signature', 'sha256='.concat('0'.repeat(64))],
    ['missing signature', undefined],
    ['malformed signature', 'sha256=not-hex'],
    ['wrong prefix', 'sha1='.concat('0'.repeat(64))],
  ])('rejects %s before tenant resolution', async (_case, signature) => {
    const body = JSON.stringify(payloadWith(
      textChange('111111111111111', '212600000001', 'wamid.rejected'),
    ));
    const request = new Request(endpoint, {
      method: 'POST',
      headers: signature ? { 'x-hub-signature-256': signature } : {},
      body,
    });
    const resolveTenant = vi.fn();

    await expect(processInboundWhatsAppWebhook(request, {
      appSecret,
      resolveTenant,
    })).resolves.toEqual({ accepted: false, status: 401, body: 'Unauthorized' });
    expect(resolveTenant).not.toHaveBeenCalled();
  });

  it('rejects a payload modified after signature generation', async () => {
    const original = JSON.stringify(payloadWith(
      textChange('111111111111111', '212600000001', 'wamid.original'),
    ));
    const modified = original.replace('When do you open?', 'Changed after signing');
    const resolveTenant = vi.fn();

    const result = await processInboundWhatsAppWebhook(
      signedRequest(modified, original),
      { appSecret, resolveTenant },
    );

    expect(result).toEqual({ accepted: false, status: 401, body: 'Unauthorized' });
    expect(resolveTenant).not.toHaveBeenCalled();
  });

  it('rejects signed malformed JSON without resolving a tenant', async () => {
    const resolveTenant = vi.fn();

    const result = await processInboundWhatsAppWebhook(
      signedRequest('{"object":'),
      { appSecret, resolveTenant },
    );

    expect(result).toEqual({ accepted: false, status: 400, body: 'Bad Request' });
    expect(resolveTenant).not.toHaveBeenCalled();
  });

  it('normalizes application-owned text messages and provider timestamps', () => {
    const [message] = normalizeWhatsAppWebhook(payloadWith(
      textChange('111111111111111', '212600000001', 'wamid.normalized', 'Hello'),
    ));

    expect(message).toEqual({
      provider: 'WHATSAPP',
      externalMessageId: 'wamid.normalized',
      phoneNumberId: '111111111111111',
      customerPhone: '212600000001',
      type: 'TEXT',
      content: { text: 'Hello' },
      timestamp: new Date('2026-09-17T08:00:00.000Z'),
    });
    expect(message).not.toHaveProperty('entry');
    expect(message).not.toHaveProperty('changes');
    expect(message).not.toHaveProperty('metadata');
  });

  it.each([
    ['status-only event', payloadWith({
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '111111111111111' },
        statuses: [{ id: 'wamid.outbound', status: 'delivered' }],
      },
    })],
    ['missing messages array', payloadWith({
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '111111111111111' },
      },
    })],
    ['unsupported image message', payloadWith({
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '111111111111111' },
        messages: [{
          from: '212600000001',
          id: 'wamid.image',
          timestamp: '1789632000',
          type: 'image',
          image: { id: 'media-id' },
        }],
      },
    })],
  ])('safely ignores %s', (_case, payload) => {
    expect(normalizeWhatsAppWebhook(payload)).toEqual([]);
  });

  it('normalizes multiple messages across nested events', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        { id: 'waba-a', changes: [
          textChange('111111111111111', '212600000001', 'wamid.a'),
        ] },
        { id: 'waba-b', changes: [
          textChange('222222222222222', '212600000002', 'wamid.b'),
        ] },
      ],
    };

    expect(normalizeWhatsAppWebhook(payload).map(message => message.externalMessageId))
      .toEqual(['wamid.a', 'wamid.b']);
  });

  it('rejects malformed provider payloads', () => {
    expect(() => normalizeWhatsAppWebhook({ object: 'wrong', entry: [] })).toThrow(
      'The WhatsApp webhook payload is invalid.',
    );
    expect(() => normalizeWhatsAppWebhook(payloadWith({
      field: 'messages',
      value: { messaging_product: 'whatsapp', messages: [] },
    }))).toThrow('The WhatsApp webhook payload is invalid.');
  });
});
