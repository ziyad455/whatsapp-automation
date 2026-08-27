import type { Business } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

export interface UpdateBusinessProfileInput {
  name: string;
  description?: string | null;
  phone?: string | null;
  address?: string | null;
  currency: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  timezone: string;
  businessId?: never;
}

export interface TenantBusinessProfileService {
  get(): Promise<Business | null>;
  update(input: UpdateBusinessProfileInput): Promise<Business>;
}

const nullableText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const createTenantBusinessProfileService = (
  tenant: TenantContext,
): TenantBusinessProfileService => ({
  get: () => prisma.business.findUnique({ where: { id: tenant.businessId } }),
  update: input =>
    prisma.business.update({
      where: { id: tenant.businessId },
      data: {
        name: input.name.trim(),
        description: nullableText(input.description),
        phone: nullableText(input.phone),
        address: nullableText(input.address),
        currency: input.currency.trim().toUpperCase(),
        defaultLanguage: input.defaultLanguage.trim().toLowerCase(),
        supportedLanguages: [
          ...new Set(
            input.supportedLanguages.map(language => language.trim().toLowerCase()),
          ),
        ],
        timezone: input.timezone.trim(),
      },
    }),
});
