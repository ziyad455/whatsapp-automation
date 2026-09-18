import { InvalidWhatsAppWebhookPayloadError, normalizeWhatsAppWebhook, type InboundMessage } from './normalize-inbound-message';
import {
  resolveOrCreateWhatsAppCustomer,
  type WhatsAppCustomerIdentity,
} from '../customers/whatsapp-customer.service';
import { resolveWhatsAppTenant, type WhatsAppTenantContext } from './whatsapp-tenant-context';
import { verifyMetaWebhookSignature } from './webhook-signature';

export type WhatsAppWebhookRejection = {
  readonly accepted: false;
  readonly status: 400 | 401;
  readonly body: 'Bad Request' | 'Unauthorized';
};

export type ResolvedInboundMessage = {
  readonly message: InboundMessage;
  readonly tenant: WhatsAppTenantContext | null;
  readonly customer: WhatsAppCustomerIdentity | null;
};

export type AcceptedWhatsAppWebhook = {
  readonly accepted: true;
  readonly status: 200;
  readonly body: 'OK';
  readonly messages: readonly ResolvedInboundMessage[];
};

export type WhatsAppWebhookProcessingResult =
  | WhatsAppWebhookRejection
  | AcceptedWhatsAppWebhook;

export interface WhatsAppWebhookProcessorDependencies {
  readonly appSecret: string;
  readonly resolveTenant?: (
    phoneNumberId: string,
  ) => Promise<WhatsAppTenantContext | null>;
  readonly resolveCustomer?: (
    tenant: WhatsAppTenantContext,
    customerPhone: string,
  ) => Promise<WhatsAppCustomerIdentity>;
}

const parseJson = (rawBody: Uint8Array): unknown => {
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    return JSON.parse(body) as unknown;
  } catch {
    throw new InvalidWhatsAppWebhookPayloadError();
  }
};

export const processInboundWhatsAppWebhook = async (
  request: Request,
  dependencies: WhatsAppWebhookProcessorDependencies,
): Promise<WhatsAppWebhookProcessingResult> => {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get('x-hub-signature-256') ?? undefined;

  if (!verifyMetaWebhookSignature(rawBody, signature, dependencies.appSecret)) {
    return { accepted: false, status: 401, body: 'Unauthorized' };
  }

  let messages: InboundMessage[];
  try {
    messages = normalizeWhatsAppWebhook(parseJson(rawBody));
  } catch (error) {
    if (error instanceof InvalidWhatsAppWebhookPayloadError) {
      return { accepted: false, status: 400, body: 'Bad Request' };
    }
    throw error;
  }

  const resolveTenant = dependencies.resolveTenant ?? resolveWhatsAppTenant;
  const resolveCustomer = dependencies.resolveCustomer ??
    resolveOrCreateWhatsAppCustomer;
  const resolvedByPhoneNumberId = new Map<string, WhatsAppTenantContext | null>();
  const customersByTenantAndPhone = new Map<string, WhatsAppCustomerIdentity>();
  const resolvedMessages: ResolvedInboundMessage[] = [];

  for (const message of messages) {
    let tenant = resolvedByPhoneNumberId.get(message.phoneNumberId);
    if (tenant === undefined) {
      tenant = await resolveTenant(message.phoneNumberId);
      resolvedByPhoneNumberId.set(message.phoneNumberId, tenant);
    }
    if (!tenant) {
      resolvedMessages.push({ message, tenant: null, customer: null });
      continue;
    }

    const customerKey = `${tenant.businessId}:${message.customerPhone}`;
    let customer = customersByTenantAndPhone.get(customerKey);
    if (!customer) {
      customer = await resolveCustomer(tenant, message.customerPhone);
      customersByTenantAndPhone.set(customerKey, customer);
    }
    resolvedMessages.push({ message, tenant, customer });
  }

  return {
    accepted: true,
    status: 200,
    body: 'OK',
    messages: resolvedMessages,
  };
};
