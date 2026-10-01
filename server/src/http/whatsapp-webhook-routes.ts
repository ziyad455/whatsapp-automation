import { timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { env } from '../config/env';
import { handleWhatsAppAgentMessage } from '../channels/whatsapp-agent-channel';
import { processInboundWhatsAppWebhook } from '../whatsapp/process-inbound-webhook';
import { applicationLogger } from './logger';
import { getOrCreateRequestId } from './request-context';
import { signalOperationalFailure } from '../observability/operational-alerts';
import { withCorrelation } from '../observability/correlation';

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
    !expectedToken || mode !== 'subscribe' ||
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
        if (result.status === 401) signalOperationalFailure('WEBHOOK_SIGNATURE');
        applicationLogger.warn('WhatsApp webhook rejected', {
          requestId,
          reason: result.status === 401 ? 'invalid-signature' : 'invalid-payload',
        });
        return context.text(result.body, result.status);
      }

      let downstreamFailed = false;
      for (const resolved of result.messages) {
        applicationLogger.info('WhatsApp inbound message claimed', {
          requestId,
          externalMessageId: resolved.message.externalMessageId,
          phoneNumberId: resolved.message.phoneNumberId,
          businessId: resolved.tenant.businessId,
          whatsappConnectionId: resolved.tenant.whatsappConnectionId,
          customerId: resolved.customer.id,
          inboxMessageId: resolved.inboxMessageId,
          duplicate: false,
        });

        try {
          const response = await withCorrelation({
            businessId: resolved.tenant.businessId, messageId: resolved.inboxMessageId,
          }, () => handleWhatsAppAgentMessage(resolved));
          applicationLogger.info('WhatsApp inbound message processed', {
            requestId,
            externalMessageId: resolved.message.externalMessageId,
            businessId: resolved.tenant.businessId,
            whatsappConnectionId: resolved.tenant.whatsappConnectionId,
            customerId: resolved.customer.id,
            inboxMessageId: resolved.inboxMessageId,
            conversationId: response.conversationId,
            outcome: response.outcome,
            mode: response.mode,
            ...(response.outbound
              ? { outboundExternalMessageId: response.outbound.externalMessageId }
              : {}),
          });
        } catch (error) {
          downstreamFailed = true;
          signalOperationalFailure('WEBHOOK_PROCESSING', {
            businessId: resolved.tenant.businessId, messageId: resolved.inboxMessageId,
          });
          applicationLogger.error('WhatsApp inbound message processing failed', {
            requestId,
            externalMessageId: resolved.message.externalMessageId,
            businessId: resolved.tenant.businessId,
            whatsappConnectionId: resolved.tenant.whatsappConnectionId,
            customerId: resolved.customer.id,
            inboxMessageId: resolved.inboxMessageId,
            errorKind: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }

      for (const duplicate of result.duplicates) {
        applicationLogger.info('WhatsApp inbound duplicate acknowledged', {
          requestId,
          externalMessageId: duplicate.message.externalMessageId,
          phoneNumberId: duplicate.message.phoneNumberId,
          businessId: duplicate.tenant.businessId,
          whatsappConnectionId: duplicate.tenant.whatsappConnectionId,
          duplicate: true,
        });
      }

      for (const message of result.unresolvedMessages) {
        applicationLogger.warn('WhatsApp inbound tenant unresolved', {
          requestId,
          externalMessageId: message.externalMessageId,
          phoneNumberId: message.phoneNumberId,
        });
      }

      for (const status of result.statusEvents) {
        const outcome = typeof status.outcome === 'string'
          ? status.outcome
          : status.outcome.outcome;
        const attributes = {
          requestId,
          externalMessageId: status.event.externalMessageId,
          phoneNumberId: status.event.phoneNumberId,
          status: status.event.status,
          outcome,
          ...(status.tenant
            ? {
                businessId: status.tenant.businessId,
                whatsappConnectionId: status.tenant.whatsappConnectionId,
              }
            : {}),
          ...(status.event.failureCode
            ? { providerFailureCode: status.event.failureCode }
            : {}),
        };
        if (outcome === 'UNKNOWN' || outcome === 'UNRESOLVED_TENANT') {
          applicationLogger.warn('WhatsApp status event not matched', attributes);
        } else {
          applicationLogger.info('WhatsApp status event handled', attributes);
        }
      }

      if (downstreamFailed) {
        return context.text('Internal Server Error', 500);
      }

      return context.text(result.body, result.status);
    },
  }),
];
