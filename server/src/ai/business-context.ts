import { z } from 'zod';
import type { BusinessDataProvider, CurrentFactMetadata } from '../business-data/business-data-provider';
import { createDatabaseBusinessDataProvider } from '../business-data/database-business-data-provider';
import type { TenantContext } from '../tenancy/tenant-context';

export type BusinessDataProviderFactory = (tenant: TenantContext) => BusinessDataProvider;

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
  description: z.string().max(4000).nullable(),
  timezone: z.string().max(100),
  currency: z.string().max(10),
  defaultLanguage: z.string().max(50),
  supportedLanguages: z.array(z.string().max(50)).max(20),
  profileMetadata: factMetadataSchema,
  normalOpeningHours: z.array(z.object({
    dayOfWeek: z.string(),
    isOpen: z.boolean(),
    opensAt: z.string().nullable(),
    closesAt: z.string().nullable(),
    metadata: factMetadataSchema,
  })).max(7),
  rules: z.array(z.object({
    category: z.string().max(100),
    name: z.string().max(200),
    content: z.string().max(2000),
    metadata: factMetadataSchema,
  })).max(50),
  deferredOpeningHours: z.boolean(),
  deferredRules: z.boolean(),
});

export type BusinessContext = z.infer<typeof businessContextSchema>;

// Only explicit STABLE configuration belongs in instructions. Freshness still travels with it.
export const buildBusinessContext = async (
  tenant: TenantContext,
  createProvider: BusinessDataProviderFactory = createDatabaseBusinessDataProvider,
): Promise<BusinessContext> => {
  const provider = createProvider(tenant);
  const [profile, hours, rules] = await Promise.all([
    provider.getBusinessProfile(), provider.getOpeningHours(), provider.getBusinessRules(),
  ]);
  if (!profile || profile.id !== tenant.businessId) {
    throw new Error('Authorized business profile is unavailable.');
  }
  return businessContextSchema.parse({
    name: profile.name,
    description: profile.metadata.freshnessClass === 'STABLE' ? profile.description : null,
    timezone: profile.timezone,
    currency: profile.currency,
    defaultLanguage: profile.defaultLanguage,
    supportedLanguages: profile.supportedLanguages,
    profileMetadata: publicFactMetadata(profile.metadata),
    normalOpeningHours: hours.filter(hour => hour.metadata.freshnessClass === 'STABLE')
      .map(hour => ({
        dayOfWeek: hour.dayOfWeek, isOpen: hour.isOpen,
        opensAt: hour.opensAt, closesAt: hour.closesAt,
        metadata: publicFactMetadata(hour.metadata),
      })),
    rules: rules.filter(rule => rule.metadata.freshnessClass === 'STABLE')
      .map(rule => ({
        category: rule.category, name: rule.name, content: rule.content,
        metadata: publicFactMetadata(rule.metadata),
      })),
    deferredOpeningHours: hours.some(hour => hour.metadata.freshnessClass !== 'STABLE'),
    deferredRules: rules.some(rule => rule.metadata.freshnessClass !== 'STABLE'),
  });
};
