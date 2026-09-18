import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { WhatsAppTenantContext } from '../whatsapp/whatsapp-tenant-context';

const whatsappPhoneSchema = z.string().regex(/^\d+$/);

export interface WhatsAppCustomerIdentity {
  readonly id: string;
  readonly businessId: string;
  readonly whatsappPhone: string;
}

const customerSelection = {
  id: true,
  businessId: true,
  whatsappPhone: true,
} as const;

const freezeCustomer = (
  customer: WhatsAppCustomerIdentity,
): WhatsAppCustomerIdentity => Object.freeze(customer);

export const resolveOrCreateWhatsAppCustomer = async (
  tenant: WhatsAppTenantContext,
  customerPhone: string,
): Promise<WhatsAppCustomerIdentity> => {
  const whatsappPhone = whatsappPhoneSchema.parse(customerPhone);
  const identity = {
    businessId_whatsappPhone: {
      businessId: tenant.businessId,
      whatsappPhone,
    },
  };

  try {
    const customer = await prisma.customer.upsert({
      where: identity,
      update: {},
      create: {
        businessId: tenant.businessId,
        whatsappPhone,
      },
      select: customerSelection,
    });

    return freezeCustomer(customer);
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error;
    }

    const customer = await prisma.customer.findUnique({
      where: identity,
      select: customerSelection,
    });
    if (!customer) throw error;

    return freezeCustomer(customer);
  }
};
