import { z } from 'zod';
import { env } from '../config/env';
import {
  WhatsAppSendError,
  type WhatsAppSendResult,
  type WhatsAppTransport,
} from './whatsapp-send.types';

const metaTextInputSchema = z.object({
  phoneNumberId: z.string().regex(/^\d+$/),
  to: z.string().regex(/^\d+$/),
  text: z.string().min(1).max(4_096),
}).strict();

const metaSuccessSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
}).passthrough();

const metaTemplateInputSchema = z.object({
  phoneNumberId: z.string().regex(/^\d+$/),
  to: z.string().regex(/^\d+$/),
  template: z.object({
    name: z.string().regex(/^[a-z0-9_]+$/).max(512),
    languageCode: z.string().min(2).max(35),
    bodyParameters: z.array(z.string().min(1).max(1_024)).max(20),
  }).strict(),
}).strict();

const apiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const defaultTimeoutMs = 10_000;

export interface MetaWhatsAppTransportOptions {
  readonly accessToken?: string;
  readonly apiVersion?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const metaErrorSchema = z.object({ error: z.object({ code: z.number().int() }) });

export const providerError = (
  status: number,
  payload: unknown,
  retryAfter: string | null = null,
): WhatsAppSendError => {
  const providerCode = metaErrorSchema.safeParse(payload).data?.error.code;
  const details = { providerStatus: status, providerCode };
  if (status === 401 || status === 403 ||
      (providerCode !== undefined && [0, 10, 190, 200, 131005, 131031, 131042].includes(providerCode))) {
    return new WhatsAppSendError({
      code: 'AUTHENTICATION',
      message: 'Meta rejected the WhatsApp transport credentials.',
      retryable: false,
      ...details,
    });
  }
  if (status === 429 || (providerCode !== undefined && [4, 80007, 130429, 131056].includes(providerCode))) {
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter ?? '') - Date.now();
    return new WhatsAppSendError({
      code: 'RATE_LIMITED',
      message: 'Meta rate-limited the WhatsApp send request.',
      retryable: true,
      ...details,
      retryAfterMs: Number.isFinite(delay) ? Math.max(0, Math.min(delay, 86_400_000)) : undefined,
    });
  }
  // Unknown 5xx may be a gateway failure after acceptance: only retry a
  // recognized provider rejection. HTTP status alone cannot prove non-delivery.
  if (providerCode !== undefined && [1, 2, 131000, 131016].includes(providerCode)) {
    return new WhatsAppSendError({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Meta could not complete the WhatsApp send request.',
      retryable: true,
      ...details,
    });
  }

  return new WhatsAppSendError({
    code: status >= 500 ? 'INVALID_RESPONSE' : 'INVALID_REQUEST',
    message: 'Meta rejected the WhatsApp send request.',
    retryable: false,
    ...details,
  });
};

export const createMetaWhatsAppTransport = (
  options: MetaWhatsAppTransportOptions = {},
): WhatsAppTransport => {
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

  const send = async (input: {
    readonly phoneNumberId: string;
    readonly to: string;
    readonly payload: Record<string, unknown>;
  }): Promise<WhatsAppSendResult> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImplementation(
          `https://graph.facebook.com/${apiVersion}/${input.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: input.to,
              ...input.payload,
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          throw providerError(response.status, payload, response.headers.get('retry-after'));
        }

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
            retryable: false,
            cause: error,
          });
        }
        throw new WhatsAppSendError({
          code: 'NETWORK',
          message: 'The WhatsApp transport could not reach Meta.',
          retryable: false,
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }
  };

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
      return send({
        phoneNumberId: parsedInput.data.phoneNumberId,
        to: parsedInput.data.to,
        payload: { type: 'text', text: { body: parsedInput.data.text } },
      });
    },
    sendTemplate: async input => {
      const parsedInput = metaTemplateInputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new WhatsAppSendError({
          code: 'INVALID_REQUEST',
          message: 'The WhatsApp template message is invalid.',
          retryable: false,
        });
      }
      const parameters = parsedInput.data.template.bodyParameters;
      return send({
        phoneNumberId: parsedInput.data.phoneNumberId,
        to: parsedInput.data.to,
        payload: {
          type: 'template',
          template: {
            name: parsedInput.data.template.name,
            language: { code: parsedInput.data.template.languageCode },
            ...(parameters.length === 0 ? {} : {
              components: [{
                type: 'body',
                parameters: parameters.map(text => ({ type: 'text', text })),
              }],
            }),
          },
        },
      });
    },
  };
};
