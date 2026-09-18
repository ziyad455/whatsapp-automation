import { timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { env } from '../config/env';
import { processInboundWhatsAppWebhook } from '../whatsapp/process-inbound-webhook';
import { applicationLogger } from './logger';
import { getOrCreateRequestId } from './request-context';

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
  registerApiRoute('/webhooks/whatsapp', {
    method: 'POST',
    requiresAuth: false,
    handler: async context => {
      const requestId = getOrCreateRequestId(context.get('requestContext'));
      const result = await processInboundWhatsAppWebhook(context.req.raw, {
        appSecret: env.META_WHATSAPP_APP_SECRET,
      });

      if (!result.accepted) {
        applicationLogger.warn('WhatsApp webhook rejected', {
          requestId,
          reason: result.status === 401 ? 'invalid-signature' : 'invalid-payload',
        });
        return context.text(result.body, result.status);
      }

      for (const resolved of result.messages) {
        if (resolved.tenant) {
          applicationLogger.info('WhatsApp inbound tenant resolved', {
            requestId,
            externalMessageId: resolved.message.externalMessageId,
            phoneNumberId: resolved.message.phoneNumberId,
            businessId: resolved.tenant.businessId,
            whatsappConnectionId: resolved.tenant.whatsappConnectionId,
            customerId: resolved.customer?.id,
          });
        } else {
          applicationLogger.warn('WhatsApp inbound tenant unresolved', {
            requestId,
            externalMessageId: resolved.message.externalMessageId,
            phoneNumberId: resolved.message.phoneNumberId,
          });
        }
      }

      return context.text(result.body, result.status);
    },
  }),
];
