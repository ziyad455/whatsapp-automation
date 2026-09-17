import { timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { env } from '../config/env';

type VerificationResult =
  | { readonly status: 200; readonly body: string }
  | { readonly status: 403; readonly body: 'Forbidden' };

const tokensMatch = (received: string, expected: string): boolean => {
  const receivedBytes = Buffer.from(received, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');

  return receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes);
};

export const verifyWhatsAppWebhookRequest = (
  request: Request,
  expectedToken: string,
): VerificationResult => {
  const query = new URL(request.url).searchParams;
  const mode = query.get('hub.mode');
  const token = query.get('hub.verify_token');
  const challenge = query.get('hub.challenge');

  if (
    mode !== 'subscribe' ||
    token === null ||
    challenge === null ||
    challenge.length === 0 ||
    !tokensMatch(token, expectedToken)
  ) {
    return { status: 403, body: 'Forbidden' };
  }

  return { status: 200, body: challenge };
};

export const whatsappWebhookRoutes = [
  registerApiRoute('/webhooks/whatsapp', {
    method: 'GET',
    requiresAuth: false,
    handler: context => {
      const result = verifyWhatsAppWebhookRequest(
        context.req.raw,
        env.META_WHATSAPP_VERIFY_TOKEN,
      );

      return context.text(result.body, result.status);
    },
  }),
];
