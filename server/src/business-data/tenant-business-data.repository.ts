import type {
  BusinessEntity,
  BusinessEntityStatus,
  BusinessEntityType,
  BusinessFieldDefinition,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

export interface CreateBusinessEntityTypeInput {
  key: string;
  name: string;
  description?: string;
  businessId?: never;
}

export interface ListBusinessEntitiesInput {
  entityTypeId?: string;
  status?: BusinessEntityStatus;
  businessId?: never;
}

export interface TenantBusinessDataRepository {
  createEntityType(input: CreateBusinessEntityTypeInput): Promise<BusinessEntityType>;
  findEntityTypeById(entityTypeId: string): Promise<BusinessEntityType | null>;
  findEntityTypeByKey(key: string): Promise<BusinessEntityType | null>;
  listEntityTypes(): Promise<BusinessEntityType[]>;
  listFieldDefinitions(entityTypeId: string): Promise<BusinessFieldDefinition[]>;
  findEntityById(entityId: string): Promise<BusinessEntity | null>;
  listEntities(input?: ListBusinessEntitiesInput): Promise<BusinessEntity[]>;
}

const normalizeEntityTypeKey = (key: string) => key.trim().toLowerCase();

export const createTenantBusinessDataRepository = (
  tenant: TenantContext,
): TenantBusinessDataRepository => {
  const businessId = tenant.businessId;

  const findOwnedEntityType = (entityTypeId: string) =>
    prisma.businessEntityType.findFirst({
      where: {
        id: entityTypeId,
        businessId,
      },
    });

  return {
    createEntityType: input =>
      prisma.$transaction(async transaction => {
        const entityType = await transaction.businessEntityType.create({
          data: {
            businessId,
            key: normalizeEntityTypeKey(input.key),
            name: input.name.trim(),
            description: input.description?.trim() || null,
            schemaVersion: 1,
          },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_ENTITY_TYPE',
          targetId: entityType.id,
          action: 'CREATE',
          before: null,
          after: entityType,
        });

        return entityType;
      }),
    findEntityTypeById: findOwnedEntityType,
    findEntityTypeByKey: key =>
      prisma.businessEntityType.findUnique({
        where: {
          businessId_key: {
            businessId,
            key: normalizeEntityTypeKey(key),
          },
        },
      }),
    listEntityTypes: () =>
      prisma.businessEntityType.findMany({
        where: { businessId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    listFieldDefinitions: entityTypeId =>
      prisma.businessFieldDefinition.findMany({
        where: {
          entityTypeId,
          entityType: { businessId },
        },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
    findEntityById: entityId =>
      prisma.businessEntity.findFirst({
        where: {
          id: entityId,
          businessId,
        },
      }),
    listEntities: input =>
      prisma.businessEntity.findMany({
        where: {
          businessId,
          ...(input?.entityTypeId === undefined
            ? {}
            : { entityTypeId: input.entityTypeId }),
          status: input?.status ?? 'ACTIVE',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
  };
};
