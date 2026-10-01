import {
  InvalidWhatsAppWebhookPayloadError,
  normalizeWhatsAppStatusEvents,
  normalizeWhatsAppWebhook,
  type InboundMessage,
  type WhatsAppMessageStatusEvent,
} from './normalize-inbound-message';
import {
  resolveOrCreateWhatsAppCustomer,
  type WhatsAppCustomerIdentity,
} from '../customers/whatsapp-customer.service';
import {
  applyWhatsAppMessageStatusEvent,
  claimInboundWhatsAppMessage,
  type InboundMessageClaim,
  type WhatsAppStatusUpdateOutcome,
} from './whatsapp-message.repository';
import { resolveWhatsAppTenant, type WhatsAppTenantContext } from './whatsapp-tenant-context';
import { verifyMetaWebhookSignature } from './webhook-signature';
import { syncCampaignRecipientTransportStatus } from '../reactivation/campaign-worker';
import { readBoundedBody, RequestBodyTooLargeError } from '../http/bounded-body';

export type WhatsAppWebhookRejection = {
  readonly accepted: false;
  readonly status: 400 | 401 | 413;
  readonly body: 'Bad Request' | 'Unauthorized' | 'Payload Too Large';
};

export type ResolvedInboundMessage = {
  readonly message: InboundMessage;
  readonly tenant: WhatsAppTenantContext;
  readonly customer: WhatsAppCustomerIdentity;
  readonly inboxMessageId: string;
};

export type DuplicateInboundMessage = {
  readonly message: InboundMessage;
  readonly tenant: WhatsAppTenantContext;
};

export type ResolvedWhatsAppStatusEvent = {
  readonly event: WhatsAppMessageStatusEvent;
  readonly tenant: WhatsAppTenantContext | null;
  readonly outcome: WhatsAppStatusUpdateOutcome | 'UNRESOLVED_TENANT';
};

export type AcceptedWhatsAppWebhook = {
  readonly accepted: true;
  readonly status: 200;
  readonly body: 'OK';
  readonly messages: readonly ResolvedInboundMessage[];
  readonly duplicates: readonly DuplicateInboundMessage[];
  readonly unresolvedMessages: readonly InboundMessage[];
  readonly statusEvents: readonly ResolvedWhatsAppStatusEvent[];
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
  readonly claimMessage?: (
    tenant: WhatsAppTenantContext,
    customerId: string,
    message: InboundMessage,
  ) => Promise<InboundMessageClaim>;
  readonly applyStatusEvent?: (
    tenant: WhatsAppTenantContext,
    event: WhatsAppMessageStatusEvent,
  ) => Promise<WhatsAppStatusUpdateOutcome>;
  readonly syncCampaignStatus?: typeof syncCampaignRecipientTransportStatus;
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
  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { accepted: false, status: 413, body: 'Payload Too Large' };
    }
    throw error;
  }
  const signature = request.headers.get('x-hub-signature-256') ?? undefined;

  if (!verifyMetaWebhookSignature(rawBody, signature, dependencies.appSecret)) {
    return { accepted: false, status: 401, body: 'Unauthorized' };
  }

  let messages: InboundMessage[];
  let statusEvents: WhatsAppMessageStatusEvent[];
  try {
    const payload = parseJson(rawBody);
    messages = normalizeWhatsAppWebhook(payload);
    statusEvents = normalizeWhatsAppStatusEvents(payload);
  } catch (error) {
    if (error instanceof InvalidWhatsAppWebhookPayloadError) {
      return { accepted: false, status: 400, body: 'Bad Request' };
    }
    throw error;
  }

  const resolveTenant = dependencies.resolveTenant ?? resolveWhatsAppTenant;
  const resolveCustomer = dependencies.resolveCustomer ??
    resolveOrCreateWhatsAppCustomer;
  const claimMessage = dependencies.claimMessage ?? claimInboundWhatsAppMessage;
  const applyStatusEvent = dependencies.applyStatusEvent ??
    applyWhatsAppMessageStatusEvent;
  const resolvedByPhoneNumberId = new Map<string, WhatsAppTenantContext | null>();
  const customersByTenantAndPhone = new Map<string, WhatsAppCustomerIdentity>();
  const resolvedMessages: ResolvedInboundMessage[] = [];
  const duplicateMessages: DuplicateInboundMessage[] = [];
  const unresolvedMessages: InboundMessage[] = [];
  const resolvedStatusEvents: ResolvedWhatsAppStatusEvent[] = [];

  const tenantFor = async (
    phoneNumberId: string,
  ): Promise<WhatsAppTenantContext | null> => {
    const cached = resolvedByPhoneNumberId.get(phoneNumberId);
    if (cached !== undefined) return cached;
    const tenant = await resolveTenant(phoneNumberId);
    resolvedByPhoneNumberId.set(phoneNumberId, tenant);
    return tenant;
  };

  for (const message of messages) {
    const tenant = await tenantFor(message.phoneNumberId);
    if (!tenant) {
      unresolvedMessages.push(message);
      continue;
    }

    const customerKey = `${tenant.businessId}:${message.customerPhone}`;
    let customer = customersByTenantAndPhone.get(customerKey);
    if (!customer) {
      customer = await resolveCustomer(tenant, message.customerPhone);
      customersByTenantAndPhone.set(customerKey, customer);
    }
    const claim = await claimMessage(tenant, customer.id, message);
    if (claim.outcome === 'DUPLICATE') {
      duplicateMessages.push({ message, tenant });
      continue;
    }
    resolvedMessages.push({
      message,
      tenant,
      customer,
      inboxMessageId: claim.messageId,
    });
  }

  for (const event of statusEvents) {
    const tenant = await tenantFor(event.phoneNumberId);
    if (!tenant) {
      resolvedStatusEvents.push({
        event,
        tenant: null,
        outcome: 'UNRESOLVED_TENANT',
      });
      continue;
    }
    const outcome = await applyStatusEvent(tenant, event);
    const syncCampaignStatus = dependencies.syncCampaignStatus ??
      (dependencies.applyStatusEvent ? null : syncCampaignRecipientTransportStatus);
    if (outcome.outcome !== 'UNKNOWN' && syncCampaignStatus) {
      await syncCampaignStatus(
        tenant,
        event.externalMessageId,
        event.status,
        event.timestamp,
      );
    }
    resolvedStatusEvents.push({
      event,
      tenant,
      outcome,
    });
  }

  return {
    accepted: true,
    status: 200,
    body: 'OK',
    messages: resolvedMessages,
    duplicates: duplicateMessages,
    unresolvedMessages,
    statusEvents: resolvedStatusEvents,
  };
};
