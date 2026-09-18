import { z } from 'zod';

const metaMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().regex(/^\d+$/),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string().min(1),
  text: z.object({ body: z.string().min(1).max(4_096) }).optional(),
}).passthrough();

const metaStatusErrorSchema = z.object({
  code: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  message: z.string().optional(),
  error_data: z.object({
    details: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const metaStatusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().regex(/^\d+$/),
  recipient_id: z.string().regex(/^\d+$/),
  errors: z.array(metaStatusErrorSchema).optional(),
}).passthrough();

const metaMessageValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    phone_number_id: z.string().regex(/^\d+$/),
  }).passthrough(),
  messages: z.array(metaMessageSchema).optional(),
  statuses: z.array(metaStatusSchema).optional(),
}).passthrough();

const metaWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    changes: z.array(z.object({
      field: z.string(),
      value: z.unknown(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

export const inboundMessageSchema = z.object({
  provider: z.literal('WHATSAPP'),
  externalMessageId: z.string().min(1),
  phoneNumberId: z.string().regex(/^\d+$/),
  customerPhone: z.string().regex(/^\d+$/),
  type: z.literal('TEXT'),
  content: z.object({ text: z.string().min(1).max(4_096) }).strict(),
  timestamp: z.date(),
}).strict().readonly();

export type InboundMessage = z.output<typeof inboundMessageSchema>;

export const whatsappMessageStatusEventSchema = z.object({
  provider: z.literal('WHATSAPP'),
  externalMessageId: z.string().min(1),
  phoneNumberId: z.string().regex(/^\d+$/),
  recipientPhone: z.string().regex(/^\d+$/),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  timestamp: z.date(),
  failureCode: z.string().min(1).max(100).optional(),
  failureTitle: z.string().min(1).max(500).optional(),
  failureDetails: z.string().min(1).max(1_000).optional(),
}).strict().readonly();

export type WhatsAppMessageStatusEvent = z.output<
  typeof whatsappMessageStatusEventSchema
>;

export class InvalidWhatsAppWebhookPayloadError extends Error {
  constructor() {
    super('The WhatsApp webhook payload is invalid.');
    this.name = 'InvalidWhatsAppWebhookPayloadError';
  }
}

const providerTimestamp = (value: string): Date => {
  const seconds = Number(value);
  const timestamp = new Date(seconds * 1_000);

  if (!Number.isSafeInteger(seconds) || Number.isNaN(timestamp.getTime())) {
    throw new InvalidWhatsAppWebhookPayloadError();
  }

  return timestamp;
};

export const normalizeWhatsAppWebhook = (payload: unknown): InboundMessage[] => {
  const webhook = metaWebhookSchema.safeParse(payload);
  if (!webhook.success) throw new InvalidWhatsAppWebhookPayloadError();

  const normalized: InboundMessage[] = [];

  for (const entry of webhook.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const value = metaMessageValueSchema.safeParse(change.value);
      if (!value.success) throw new InvalidWhatsAppWebhookPayloadError();

      for (const message of value.data.messages ?? []) {
        if (message.type !== 'text') continue;
        if (!message.text) throw new InvalidWhatsAppWebhookPayloadError();

        normalized.push(inboundMessageSchema.parse({
          provider: 'WHATSAPP',
          externalMessageId: message.id,
          phoneNumberId: value.data.metadata.phone_number_id,
          customerPhone: message.from,
          type: 'TEXT',
          content: { text: message.text.body },
          timestamp: providerTimestamp(message.timestamp),
        }));
      }
    }
  }

  return normalized;
};

const supportedStatuses = new Set(['sent', 'delivered', 'read', 'failed']);

const limited = (value: string | undefined, maximum: number): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maximum) : undefined;
};

export const normalizeWhatsAppStatusEvents = (
  payload: unknown,
): WhatsAppMessageStatusEvent[] => {
  const webhook = metaWebhookSchema.safeParse(payload);
  if (!webhook.success) throw new InvalidWhatsAppWebhookPayloadError();

  const normalized: WhatsAppMessageStatusEvent[] = [];

  for (const entry of webhook.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const value = metaMessageValueSchema.safeParse(change.value);
      if (!value.success) throw new InvalidWhatsAppWebhookPayloadError();

      for (const status of value.data.statuses ?? []) {
        if (!supportedStatuses.has(status.status)) continue;
        const failure = status.status === 'failed' ? status.errors?.[0] : undefined;

        normalized.push(whatsappMessageStatusEventSchema.parse({
          provider: 'WHATSAPP',
          externalMessageId: status.id,
          phoneNumberId: value.data.metadata.phone_number_id,
          recipientPhone: status.recipient_id,
          status: status.status.toUpperCase(),
          timestamp: providerTimestamp(status.timestamp),
          ...(failure
            ? {
                failureCode: limited(String(failure.code), 100),
                failureTitle: limited(failure.title ?? failure.message, 500),
                failureDetails: limited(failure.error_data?.details, 1_000),
              }
            : {}),
        }));
      }
    }
  }

  return normalized;
};
