import { applicationLogger } from '../http/logger';
import {
  resolveOrCreateWhatsAppCustomer,
  type WhatsAppCustomerIdentity,
} from '../customers/whatsapp-customer.service';
import { createMetaWhatsAppTransport } from './meta-whatsapp-transport';
import {
  findActiveWhatsAppConnectionForTenant,
  type WhatsAppOutboundConnectionRecord,
} from './whatsapp-connection.repository';
import {
  createPendingOutgoingWhatsAppMessage,
  markOutgoingWhatsAppMessageFailed,
  markOutgoingWhatsAppMessageSent,
} from './whatsapp-message.repository';
import {
  WhatsAppSendError,
  type WhatsAppSendResult,
  type WhatsAppTextTransport,
} from './whatsapp-send.types';
import type { WhatsAppTenantContext } from './whatsapp-tenant-context';

interface WhatsAppSendLogger {
  info(message: string, attributes: Record<string, unknown>): void;
  warn(message: string, attributes: Record<string, unknown>): void;
}

export interface SendWhatsAppTextInput {
  readonly tenant: WhatsAppTenantContext;
  readonly to: string;
  readonly text: string;
}

export interface WhatsAppSendServiceDependencies {
  readonly findConnection?: (
    tenant: WhatsAppTenantContext,
  ) => Promise<WhatsAppOutboundConnectionRecord | null>;
  readonly transport?: WhatsAppTextTransport;
  readonly logger?: WhatsAppSendLogger;
  readonly resolveCustomer?: (
    tenant: WhatsAppTenantContext,
    customerPhone: string,
  ) => Promise<WhatsAppCustomerIdentity>;
  readonly createPendingMessage?: typeof createPendingOutgoingWhatsAppMessage;
  readonly markMessageSent?: typeof markOutgoingWhatsAppMessageSent;
  readonly markMessageFailed?: typeof markOutgoingWhatsAppMessageFailed;
}

export const sendWhatsAppText = async (
  input: SendWhatsAppTextInput,
  dependencies: WhatsAppSendServiceDependencies = {},
): Promise<WhatsAppSendResult> => {
  const findConnection = dependencies.findConnection ??
    findActiveWhatsAppConnectionForTenant;
  const logger = dependencies.logger ?? applicationLogger;
  const connection = await findConnection(input.tenant);

  if (!connection) {
    throw new WhatsAppSendError({
      code: 'CONNECTION_UNAVAILABLE',
      message: 'The tenant has no active WhatsApp connection for this request.',
      retryable: false,
    });
  }

  const resolveCustomer = dependencies.resolveCustomer ??
    resolveOrCreateWhatsAppCustomer;
  const customer = await resolveCustomer(input.tenant, input.to);
  const createPendingMessage = dependencies.createPendingMessage ??
    createPendingOutgoingWhatsAppMessage;
  const pendingMessage = await createPendingMessage({
    tenant: input.tenant,
    customerId: customer.id,
    recipientPhone: input.to,
  });

  let result: WhatsAppSendResult;

  try {
    const transport = dependencies.transport ?? createMetaWhatsAppTransport();
    result = await transport.sendText({
      phoneNumberId: connection.phoneNumberId,
      to: input.to,
      text: input.text,
    });
  } catch (error) {
    const markMessageFailed = dependencies.markMessageFailed ??
      markOutgoingWhatsAppMessageFailed;
    const failure = error instanceof WhatsAppSendError
      ? {
          code: error.code,
          title: error.message,
          ...(error.providerStatus === undefined
            ? {}
            : { details: `Meta HTTP status ${error.providerStatus}` }),
        }
      : {
          code: 'UNEXPECTED_TRANSPORT_ERROR',
          title: 'The WhatsApp transport failed unexpectedly.',
        };
    try {
      await markMessageFailed(input.tenant, pendingMessage.id, failure);
    } catch {
      logger.warn('WhatsApp failure state could not be persisted', {
        businessId: connection.businessId,
        connectionId: connection.id,
        messageId: pendingMessage.id,
      });
    }
    if (error instanceof WhatsAppSendError) {
      logger.warn('WhatsApp text send failed', {
        businessId: connection.businessId,
        connectionId: connection.id,
        failureCode: error.code,
        retryable: error.retryable,
        ...(error.providerStatus === undefined
          ? {}
          : { providerStatus: error.providerStatus }),
      });
    }
    throw error;
  }

  const markMessageSent = dependencies.markMessageSent ??
    markOutgoingWhatsAppMessageSent;
  await markMessageSent(
    input.tenant,
    pendingMessage.id,
    result.externalMessageId,
  );
  logger.info('WhatsApp text accepted by provider', {
    businessId: connection.businessId,
    connectionId: connection.id,
    messageId: pendingMessage.id,
    externalMessageId: result.externalMessageId,
  });
  return result;
};
