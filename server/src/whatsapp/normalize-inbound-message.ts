import { z } from 'zod';

const metaMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().regex(/^\d+$/),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string().min(1),
  text: z.object({ body: z.string().min(1).max(4_096) }).optional(),
}).passthrough();

const metaMessageValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    phone_number_id: z.string().regex(/^\d+$/),
  }).passthrough(),
  messages: z.array(metaMessageSchema).optional(),
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
