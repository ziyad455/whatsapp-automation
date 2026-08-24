import type { Business, BusinessLifecycleStatus } from '../generated/prisma/client';
import { prisma } from '../db/prisma';

export interface CreateBusinessInput {
  name: string;
  category: string;
  timezone: string;
  currency: string;
  defaultLanguage: string;
  lifecycleStatus: BusinessLifecycleStatus;
}

export const createBusiness = async (input: CreateBusinessInput): Promise<Business> =>
  prisma.business.create({
    data: {
      name: input.name.trim(),
      category: input.category.trim().toUpperCase(),
      timezone: input.timezone.trim(),
      currency: input.currency.trim().toUpperCase(),
      defaultLanguage: input.defaultLanguage.trim().toLowerCase(),
      lifecycleStatus: input.lifecycleStatus,
    },
  });

export const findBusinessById = async (id: string): Promise<Business | null> =>
  prisma.business.findUnique({ where: { id } });
