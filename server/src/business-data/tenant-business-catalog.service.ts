import type {
  BusinessEntityType,
  BusinessFieldDefinition,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';

export type BusinessEntityTypeSummary = BusinessEntityType & {
  fieldCount: number;
};

export type BusinessEntityTypeSchema = BusinessEntityType & {
  fieldDefinitions: BusinessFieldDefinition[];
};

export interface CreateBusinessEntityTypeCatalogInput {
  key: string;
  name: string;
  description?: string | null;
  businessId?: never;
}

export interface TenantBusinessCatalogService {
  list(): Promise<BusinessEntityTypeSummary[]>;
  listSchemas(): Promise<BusinessEntityTypeSchema[]>;
  getByKey(key: string): Promise<BusinessEntityTypeSchema | null>;
  create(input: CreateBusinessEntityTypeCatalogInput): Promise<BusinessEntityTypeSchema>;
}

export const createTenantBusinessCatalogService = (
  tenant: TenantContext,
): TenantBusinessCatalogService => ({
  list: async () => {
    const entityTypes = await prisma.businessEntityType.findMany({
      where: { businessId: tenant.businessId },
      include: { _count: { select: { fieldDefinitions: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return entityTypes.map(({ _count, ...entityType }) => ({
      ...entityType,
      fieldCount: _count.fieldDefinitions,
    }));
  },
  listSchemas: () =>
    prisma.businessEntityType.findMany({
      where: { businessId: tenant.businessId },
      include: {
        fieldDefinitions: {
          where: { enabled: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  getByKey: key =>
    prisma.businessEntityType.findUnique({
      where: {
        businessId_key: {
          businessId: tenant.businessId,
          key: key.trim().toLowerCase(),
        },
      },
      include: {
        fieldDefinitions: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        },
      },
    }),
  create: async input => {
    requireBusinessPermission(tenant, 'BUSINESS_SCHEMA_WRITE');
    return prisma.$transaction(async transaction => {
      const entityType = await transaction.businessEntityType.create({
        data: {
          businessId: tenant.businessId,
          key: input.key.trim().toLowerCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          schemaVersion: 1,
        },
        include: { fieldDefinitions: true },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_ENTITY_TYPE',
        targetId: entityType.id,
        action: 'CREATE',
        before: null,
        after: entityType,
      });

      return entityType;
    });
  },
});
