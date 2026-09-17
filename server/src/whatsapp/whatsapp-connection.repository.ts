import type {
  Prisma,
  WhatsAppConnection,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';

export interface CreateWhatsAppConnectionInput {
  readonly businessId: string;
  readonly phoneNumberId: string;
  readonly whatsappBusinessAccountId: string;
  readonly displayPhoneNumber?: string;
}

export const createWhatsAppConnection = (
  input: CreateWhatsAppConnectionInput,
): Promise<WhatsAppConnection> =>
  prisma.whatsAppConnection.create({
    data: {
      businessId: input.businessId,
      phoneNumberId: input.phoneNumberId.trim(),
      whatsappBusinessAccountId: input.whatsappBusinessAccountId.trim(),
      ...(input.displayPhoneNumber?.trim()
        ? { displayPhoneNumber: input.displayPhoneNumber.trim() }
        : {}),
    },
  });

export type WhatsAppConnectionTenantRecord = Prisma.WhatsAppConnectionGetPayload<{
  select: { id: true; businessId: true };
}>;

export const findActiveWhatsAppConnectionByPhoneNumberId = (
  phoneNumberId: string,
): Promise<WhatsAppConnectionTenantRecord | null> =>
  prisma.whatsAppConnection.findFirst({
    where: { phoneNumberId, status: 'ACTIVE' },
    select: { id: true, businessId: true },
  });
