import type { Business } from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';

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
  update: async input => {
    requireBusinessPermission(tenant, 'BUSINESS_CONFIGURATION_WRITE');
    return prisma.$transaction(async transaction => {
      const before = await transaction.business.findUniqueOrThrow({
        where: { id: tenant.businessId },
      });
      const after = await transaction.business.update({
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
          profileSource: 'MANUAL',
          profileExternalId: null,
          profileLastVerifiedAt: new Date(),
        },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_PROFILE',
        targetId: tenant.businessId,
        action: 'UPDATE',
        before,
        after,
      });

      return after;
    });
  },
});
