import type {
  BusinessEntity,
  BusinessFieldDefinition,
  DataSource,
  FreshnessClass,
  Prisma,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantScope } from '../tenancy/tenant-context';
import type {
  BusinessDataProvider,
  CurrentBusinessEntity,
  CurrentBusinessEntityField,
  CurrentFactMetadata,
} from './business-data-provider';
import { getFreshnessStatus, isStaleFromStatus } from './freshness';
import { createTenantBusinessEntityQueryService } from './tenant-business-entity-query.service';

export interface DatabaseBusinessDataProviderOptions {
  now?: () => Date;
}

interface MetadataInput {
  source: DataSource;
  externalId: string | null;
  freshnessClass: FreshnessClass;
  lastVerifiedAt: Date | null;
  staleAfterSeconds: number | null;
  updatedAt: Date;
}

const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createDatabaseBusinessDataProvider = (
  tenant: TenantScope,
  options: DatabaseBusinessDataProviderOptions = {},
): BusinessDataProvider => {
  const now = options.now ?? (() => new Date());
  const entityQueryService = createTenantBusinessEntityQueryService(tenant);

  const metadata = (input: MetadataInput): CurrentFactMetadata => {
    const freshnessStatus = getFreshnessStatus(input, now());

    return {
      source: input.source,
      externalId: input.externalId,
      freshnessClass: input.freshnessClass,
      lastVerifiedAt: input.lastVerifiedAt,
      staleAfterSeconds: input.staleAfterSeconds,
      freshnessStatus,
      isStale: isStaleFromStatus(freshnessStatus),
    };
  };

  const toCurrentEntity = (
    entityTypeKey: string,
    fields: readonly BusinessFieldDefinition[],
    entity: BusinessEntity,
  ): CurrentBusinessEntity => {
    const data = isJsonObject(entity.data) ? entity.data : {};
    const currentFields: CurrentBusinessEntityField[] = fields
      .filter(field => field.enabled)
      .map(field => {
        const hasValue = Object.hasOwn(data, field.key);
        const freshnessStatus = hasValue
          ? metadata({
              source: entity.source,
              externalId: entity.externalId,
              freshnessClass: field.freshnessClass,
              lastVerifiedAt: entity.lastVerifiedAt,
              staleAfterSeconds: field.staleAfterSeconds,
              updatedAt: entity.updatedAt,
            })
          : {
              source: entity.source,
              externalId: entity.externalId,
              freshnessClass: field.freshnessClass,
              lastVerifiedAt: entity.lastVerifiedAt,
              staleAfterSeconds: field.staleAfterSeconds,
              freshnessStatus: 'UNKNOWN' as const,
              isStale: null,
            };

        return {
          definitionId: field.id,
          key: field.key,
          label: field.label,
          type: field.type,
          value: hasValue ? (data[field.key] ?? null) : null,
          hasValue,
          metadata: freshnessStatus,
        };
      });

    return {
      id: entity.id,
      entityTypeId: entity.entityTypeId,
      entityTypeKey,
      name: entity.name,
      status: entity.status,
      source: entity.source,
      externalId: entity.externalId,
      lastVerifiedAt: entity.lastVerifiedAt,
      updatedAt: entity.updatedAt,
      fields: currentFields,
    };
  };

  return {
    getBusinessProfile: async () => {
      const profile = await prisma.business.findUnique({
        where: { id: tenant.businessId },
      });

      if (!profile) {
        return null;
      }

      return {
        id: profile.id,
        name: profile.name,
        category: profile.category,
        description: profile.description,
        phone: profile.phone,
        address: profile.address,
        timezone: profile.timezone,
        currency: profile.currency,
        defaultLanguage: profile.defaultLanguage,
        supportedLanguages: profile.supportedLanguages,
        metadata: metadata({
          source: profile.profileSource,
          externalId: profile.profileExternalId,
          freshnessClass: profile.profileFreshnessClass,
          lastVerifiedAt: profile.profileLastVerifiedAt,
          staleAfterSeconds: profile.profileStaleAfterSeconds,
          updatedAt: profile.updatedAt,
        }),
      };
    },
    getOpeningHours: async () => {
      const hours = await prisma.businessOpeningHour.findMany({
        where: { businessId: tenant.businessId },
        orderBy: { dayOfWeek: 'asc' },
      });

      return hours.map(hour => ({
        id: hour.id,
        dayOfWeek: hour.dayOfWeek,
        isOpen: hour.isOpen,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        metadata: metadata({
          source: hour.source,
          externalId: hour.externalId,
          freshnessClass: hour.freshnessClass,
          lastVerifiedAt: hour.lastVerifiedAt,
          staleAfterSeconds: hour.staleAfterSeconds,
          updatedAt: hour.updatedAt,
        }),
      }));
    },
    getBusinessRules: async () => {
      const rules = await prisma.businessRule.findMany({
        where: { businessId: tenant.businessId, active: true },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });

      return rules.map(rule => ({
        id: rule.id,
        category: rule.category,
        name: rule.name,
        content: rule.content,
        metadata: metadata({
          source: rule.source,
          externalId: rule.externalId,
          freshnessClass: rule.freshnessClass,
          lastVerifiedAt: rule.lastVerifiedAt,
          staleAfterSeconds: rule.staleAfterSeconds,
          updatedAt: rule.updatedAt,
        }),
      }));
    },
    listEntityTypes: async () => {
      const entityTypes = await prisma.businessEntityType.findMany({
        where: { businessId: tenant.businessId },
        include: {
          fieldDefinitions: {
            where: { enabled: true },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      return entityTypes.map(entityType => ({
        id: entityType.id,
        key: entityType.key,
        name: entityType.name,
        description: entityType.description,
        schemaVersion: entityType.schemaVersion,
        fieldCount: entityType.fieldDefinitions.length,
        fields: entityType.fieldDefinitions.map(field => ({
          key: field.key,
          label: field.label,
          type: field.type,
        })),
      }));
    },
    searchEntities: async input => {
      const [schema, page] = await Promise.all([
        prisma.businessEntityType.findUnique({
          where: {
            businessId_key: {
              businessId: tenant.businessId,
              key: input.entityType.trim().toLowerCase(),
            },
          },
          include: {
            fieldDefinitions: {
              orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            },
          },
        }),
        entityQueryService.search({ ...input, status: 'ACTIVE' }),
      ]);

      if (!schema) {
        return { items: [], limit: page.limit, offset: page.offset };
      }

      return {
        items: page.items.map(entity =>
          toCurrentEntity(schema.key, schema.fieldDefinitions, entity),
        ),
        limit: page.limit,
        offset: page.offset,
      };
    },
    getEntity: async (entityTypeKey, entityId) => {
      const [schema, entity] = await Promise.all([
        prisma.businessEntityType.findUnique({
          where: {
            businessId_key: {
              businessId: tenant.businessId,
              key: entityTypeKey.trim().toLowerCase(),
            },
          },
          include: {
            fieldDefinitions: {
              orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            },
          },
        }),
        prisma.businessEntity.findFirst({
          where: {
            id: entityId,
            businessId: tenant.businessId,
            entityType: { key: entityTypeKey.trim().toLowerCase() },
          },
        }),
      ]);

      if (!schema || !entity || entity.status !== 'ACTIVE') {
        return null;
      }

      return toCurrentEntity(schema.key, schema.fieldDefinitions, entity);
    },
  };
};
