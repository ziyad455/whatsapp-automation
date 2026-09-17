import { z } from 'zod';
import {
  findActiveWhatsAppConnectionByPhoneNumberId,
  type WhatsAppConnectionTenantRecord,
} from './whatsapp-connection.repository';

const phoneNumberIdSchema = z.string().regex(/^\d+$/);

export interface WhatsAppTenantContext {
  readonly businessId: string;
  readonly whatsappConnectionId: string;
}

export interface WhatsAppTenantResolverDependencies {
  readonly findConnection?: (
    phoneNumberId: string,
  ) => Promise<WhatsAppConnectionTenantRecord | null>;
}

export const resolveWhatsAppTenant = async (
  phoneNumberId: string,
  dependencies: WhatsAppTenantResolverDependencies = {},
): Promise<WhatsAppTenantContext | null> => {
  const parsedPhoneNumberId = phoneNumberIdSchema.safeParse(phoneNumberId);
  if (!parsedPhoneNumberId.success) return null;

  const findConnection = dependencies.findConnection ??
    findActiveWhatsAppConnectionByPhoneNumberId;
  const connection = await findConnection(parsedPhoneNumberId.data);
  if (!connection) return null;

  return Object.freeze({
    businessId: connection.businessId,
    whatsappConnectionId: connection.id,
  });
};
