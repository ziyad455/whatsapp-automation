import { describe, expect, it } from 'vitest';
import {
  verifyWhatsAppWebhookRequest,
  whatsappWebhookRoutes,
} from '../src/http/whatsapp-webhook-routes';

const verifyToken = 'test-only-whatsapp-verify-token';
const endpoint = 'http://localhost:4111/webhooks/whatsapp';

const requestWith = (parameters: Record<string, string | undefined>): Request => {
  const url = new URL(endpoint);

  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  return new Request(url);
};

describe('Meta WhatsApp webhook verification', () => {
  it('returns the exact raw challenge for a valid subscription request', async () => {
    const result = verifyWhatsAppWebhookRequest(requestWith({
      'hub.mode': 'subscribe',
      'hub.verify_token': verifyToken,
      'hub.challenge': '123456',
    }), verifyToken);

    expect(result).toEqual({ status: 200, body: '123456' });
  });

  it.each([
    ['wrong token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '123456' }],
    ['missing token', { 'hub.mode': 'subscribe', 'hub.verify_token': undefined, 'hub.challenge': '123456' }],
    ['wrong mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '123456' }],
    ['missing challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': undefined }],
  ])('returns 403 for %s', (_case, parameters) => {
    expect(verifyWhatsAppWebhookRequest(requestWith(parameters), verifyToken))
      .toEqual({ status: 403, body: 'Forbidden' });
  });

  it('registers the endpoint as an explicitly public GET route', () => {
    const route = whatsappWebhookRoutes.find(candidate => candidate.method === 'GET');

    expect(route).toMatchObject({
      path: '/webhooks/whatsapp',
      method: 'GET',
      requiresAuth: false,
    });
  });
});
