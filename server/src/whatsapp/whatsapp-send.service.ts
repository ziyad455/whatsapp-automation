import { applicationLogger } from '../http/logger';
import { createMetaWhatsAppTransport } from './meta-whatsapp-transport';
import {
  findActiveWhatsAppConnectionForTenant,
  type WhatsAppOutboundConnectionRecord,
} from './whatsapp-connection.repository';
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

  const transport = dependencies.transport ?? createMetaWhatsAppTransport();

  try {
    const result = await transport.sendText({
      phoneNumberId: connection.phoneNumberId,
      to: input.to,
      text: input.text,
    });
    logger.info('WhatsApp text accepted by provider', {
      businessId: connection.businessId,
      connectionId: connection.id,
      externalMessageId: result.externalMessageId,
    });
    return result;
  } catch (error) {
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
};
