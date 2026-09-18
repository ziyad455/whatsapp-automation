import { z } from 'zod';
import { env } from '../config/env';
import {
  WhatsAppSendError,
  type WhatsAppSendResult,
  type WhatsAppTextTransport,
} from './whatsapp-send.types';

const metaTextInputSchema = z.object({
  phoneNumberId: z.string().regex(/^\d+$/),
  to: z.string().regex(/^\d+$/),
  text: z.string().min(1).max(4_096),
}).strict();

const metaSuccessSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
}).passthrough();

const apiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const defaultTimeoutMs = 10_000;

export interface MetaWhatsAppTransportOptions {
  readonly accessToken?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const providerError = (status: number): WhatsAppSendError => {
  if (status === 401 || status === 403) {
    return new WhatsAppSendError({
      code: 'AUTHENTICATION',
      message: 'Meta rejected the WhatsApp transport credentials.',
      retryable: false,
      providerStatus: status,
    });
  }
  if (status === 429) {
    return new WhatsAppSendError({
      code: 'RATE_LIMITED',
      message: 'Meta rate-limited the WhatsApp send request.',
      retryable: true,
      providerStatus: status,
    });
  }
  if (status >= 500) {
    return new WhatsAppSendError({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Meta could not complete the WhatsApp send request.',
      retryable: true,
      providerStatus: status,
    });
  }

  return new WhatsAppSendError({
    code: 'INVALID_REQUEST',
    message: 'Meta rejected the WhatsApp send request.',
    retryable: false,
    providerStatus: status,
  });
};

export const createMetaWhatsAppTransport = (
  options: MetaWhatsAppTransportOptions = {},
): WhatsAppTextTransport => {
  const accessToken = options.accessToken ?? env.META_WHATSAPP_ACCESS_TOKEN;
  const apiVersion = options.apiVersion ?? env.META_WHATSAPP_API_VERSION;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (!accessToken || !apiVersion || !apiVersionSchema.safeParse(apiVersion).success) {
    throw new WhatsAppSendError({
      code: 'CONFIGURATION',
      message: 'WhatsApp outbound transport is not configured.',
      retryable: false,
    });
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new WhatsAppSendError({
      code: 'CONFIGURATION',
      message: 'WhatsApp outbound timeout is invalid.',
      retryable: false,
    });
  }

  return {
    sendText: async input => {
      const parsedInput = metaTextInputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new WhatsAppSendError({
          code: 'INVALID_REQUEST',
          message: 'The WhatsApp text message is invalid.',
          retryable: false,
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImplementation(
          `https://graph.facebook.com/${apiVersion}/${parsedInput.data.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: parsedInput.data.to,
              type: 'text',
              text: { body: parsedInput.data.text },
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) throw providerError(response.status);

        let rawResponse: unknown;
        try {
          rawResponse = await response.json();
        } catch (error) {
          throw new WhatsAppSendError({
            code: 'INVALID_RESPONSE',
            message: 'Meta returned an invalid WhatsApp send response.',
            retryable: false,
            providerStatus: response.status,
            cause: error,
          });
        }

        const responseBody = metaSuccessSchema.safeParse(rawResponse);
        if (!responseBody.success) {
          throw new WhatsAppSendError({
            code: 'INVALID_RESPONSE',
            message: 'Meta returned an invalid WhatsApp send response.',
            retryable: false,
            providerStatus: response.status,
          });
        }

        const result: WhatsAppSendResult = Object.freeze({
          provider: 'WHATSAPP',
          accepted: true,
          externalMessageId: responseBody.data.messages[0]!.id,
        });
        return result;
      } catch (error) {
        if (error instanceof WhatsAppSendError) throw error;
        if (controller.signal.aborted) {
          throw new WhatsAppSendError({
            code: 'TIMEOUT',
            message: 'The WhatsApp send request timed out.',
            retryable: true,
            cause: error,
          });
        }
        throw new WhatsAppSendError({
          code: 'NETWORK',
          message: 'The WhatsApp transport could not reach Meta.',
          retryable: true,
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
