import { z } from 'zod';
import type { BusinessDataProvider, CurrentFactMetadata } from '../business-data/business-data-provider';
import { createDatabaseBusinessDataProvider } from '../business-data/database-business-data-provider';
import type { TenantScope } from '../tenancy/tenant-context';

export type BusinessDataProviderFactory = (tenant: TenantScope) => BusinessDataProvider;

export const factMetadataSchema = z.object({
  source: z.enum(['MANUAL', 'IMPORT', 'API', 'SYNC', 'SYSTEM']),
  freshnessClass: z.enum(['STABLE', 'CHANGING', 'REAL_TIME']),
  freshnessStatus: z.enum(['FRESH', 'STALE', 'UNKNOWN']),
  lastVerifiedAt: z.string().nullable(),
});

export const publicFactMetadata = (metadata: CurrentFactMetadata) => ({
  source: metadata.source,
  freshnessClass: metadata.freshnessClass,
  freshnessStatus: metadata.freshnessStatus,
  lastVerifiedAt: metadata.lastVerifiedAt?.toISOString() ?? null,
});

export const businessContextSchema = z.object({
  name: z.string().max(200),
  category: z.string().max(100),
  timezone: z.string().max(100),
  currency: z.string().max(10),
  defaultLanguage: z.string().max(50),
  supportedLanguages: z.array(z.string().max(50)).max(20),
});

export type BusinessContext = z.infer<typeof businessContextSchema>;

// Instructions contain only identity/routing configuration. Current business facts use tools.
export const buildBusinessContext = async (
  tenant: TenantScope,
  createProvider: BusinessDataProviderFactory = createDatabaseBusinessDataProvider,
): Promise<BusinessContext> => {
  const provider = createProvider(tenant);
  const profile = await provider.getBusinessProfile();
  if (!profile || profile.id !== tenant.businessId) {
    throw new Error('Authorized business profile is unavailable.');
  }
  return businessContextSchema.parse({
    name: profile.name,
    category: profile.category,
    timezone: profile.timezone,
    currency: profile.currency,
    defaultLanguage: profile.defaultLanguage,
    supportedLanguages: profile.supportedLanguages,
  });
};
