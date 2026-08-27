import type {
  BusinessEntity,
  BusinessEntityStatus,
  Prisma,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  DynamicEntityValidationError,
  validateEntityData,
} from './dynamic-entity-validation';

export interface CreateBusinessEntityInput {
  entityTypeId: string;
  name: string;
  data: unknown;
  status?: BusinessEntityStatus;
  businessId?: never;
}

export interface TenantBusinessEntityService {
  create(input: CreateBusinessEntityInput): Promise<BusinessEntity | null>;
  createForType(
    entityTypeKey: string,
    input: Omit<CreateBusinessEntityInput, 'entityTypeId'>,
  ): Promise<BusinessEntity | null>;
  getByType(entityTypeKey: string, entityId: string): Promise<BusinessEntity | null>;
  update(
    entityTypeKey: string,
    entityId: string,
    input: Pick<CreateBusinessEntityInput, 'name' | 'data'>,
  ): Promise<BusinessEntity | null>;
  archive(entityTypeKey: string, entityId: string): Promise<BusinessEntity | null>;
  restore(entityTypeKey: string, entityId: string): Promise<BusinessEntity | null>;
  verify(
    entityTypeKey: string,
    entityId: string,
    verifiedAt?: Date,
  ): Promise<BusinessEntity | null>;
}

const isRecord = (value: unknown): value is Record<string, Prisma.JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const entityAuditSnapshot = (entity: BusinessEntity) => ({
  id: entity.id,
  entityTypeId: entity.entityTypeId,
  name: entity.name,
  data: entity.data,
  status: entity.status,
  source: entity.source,
  externalId: entity.externalId,
  lastVerifiedAt: entity.lastVerifiedAt,
});

export const createTenantBusinessEntityService = (
  tenant: TenantContext,
): TenantBusinessEntityService => {
  const businessId = tenant.businessId;

  const findTypeWithFields = (where: { id?: string; key?: string }) =>
    prisma.businessEntityType.findFirst({
      where: {
        businessId,
        ...(where.id === undefined ? {} : { id: where.id }),
        ...(where.key === undefined
          ? {}
          : { key: where.key.trim().toLowerCase() }),
      },
      include: {
        fieldDefinitions: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

  const createWithType = async (
    entityType: Awaited<ReturnType<typeof findTypeWithFields>>,
    input: Omit<CreateBusinessEntityInput, 'entityTypeId'>,
  ): Promise<BusinessEntity | null> => {
    if (!entityType) {
      return null;
    }

    const validation = validateEntityData(entityType.fieldDefinitions, input.data);

    if (!validation.success) {
      throw new DynamicEntityValidationError(validation.errors);
    }

    return prisma.$transaction(async transaction => {
      const entity = await transaction.businessEntity.create({
        data: {
          businessId,
          entityTypeId: entityType.id,
          name: input.name.trim(),
          data: validation.data,
          status: input.status ?? 'ACTIVE',
          source: 'MANUAL',
          externalId: null,
          lastVerifiedAt: new Date(),
        },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_ENTITY',
        targetId: entity.id,
        action: 'CREATE',
        before: null,
        after: entityAuditSnapshot(entity),
      });

      return entity;
    });
  };

  return {
    create: async input =>
      createWithType(await findTypeWithFields({ id: input.entityTypeId }), input),
    createForType: async (entityTypeKey, input) =>
      createWithType(await findTypeWithFields({ key: entityTypeKey }), input),
    getByType: (entityTypeKey, entityId) =>
      prisma.businessEntity.findFirst({
        where: {
          id: entityId,
          businessId,
          entityType: { key: entityTypeKey.trim().toLowerCase() },
        },
      }),
    update: async (entityTypeKey, entityId, input) => {
      return prisma.$transaction(async transaction => {
        const entity = await transaction.businessEntity.findFirst({
          where: {
            id: entityId,
            businessId,
            entityType: { key: entityTypeKey.trim().toLowerCase() },
          },
          include: {
            entityType: {
              include: {
                fieldDefinitions: {
                  orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
                },
              },
            },
          },
        });

        if (!entity) {
          return null;
        }

        const validation = validateEntityData(
          entity.entityType.fieldDefinitions,
          input.data,
        );

        if (!validation.success) {
          throw new DynamicEntityValidationError(validation.errors);
        }

        const historicalValues: Record<string, Prisma.JsonValue> = {};

        if (isRecord(entity.data)) {
          for (const field of entity.entityType.fieldDefinitions) {
            if (!field.enabled && Object.hasOwn(entity.data, field.key)) {
              historicalValues[field.key] = entity.data[field.key]!;
            }
          }
        }

        const after = await transaction.businessEntity.update({
          where: { id: entity.id },
          data: {
            name: input.name.trim(),
            data: { ...validation.data, ...historicalValues },
            source: 'MANUAL',
            externalId: null,
            lastVerifiedAt: new Date(),
          },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_ENTITY',
          targetId: after.id,
          action: 'UPDATE',
          before: entityAuditSnapshot(entity),
          after: entityAuditSnapshot(after),
        });

        return after;
      });
    },
    archive: async (entityTypeKey, entityId) => {
      return prisma.$transaction(async transaction => {
        const before = await transaction.businessEntity.findFirst({
          where: {
            id: entityId,
            businessId,
            entityType: { key: entityTypeKey.trim().toLowerCase() },
          },
        });

        if (!before || before.status === 'ARCHIVED') {
          return before;
        }

        const after = await transaction.businessEntity.update({
          where: { id: before.id },
          data: { status: 'ARCHIVED' },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_ENTITY',
          targetId: after.id,
          action: 'ARCHIVE',
          before: entityAuditSnapshot(before),
          after: entityAuditSnapshot(after),
        });

        return after;
      });
    },
    restore: async (entityTypeKey, entityId) => {
      return prisma.$transaction(async transaction => {
        const before = await transaction.businessEntity.findFirst({
          where: {
            id: entityId,
            businessId,
            entityType: { key: entityTypeKey.trim().toLowerCase() },
          },
        });

        if (!before || before.status === 'ACTIVE') {
          return before;
        }

        const after = await transaction.businessEntity.update({
          where: { id: before.id },
          data: { status: 'ACTIVE' },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_ENTITY',
          targetId: after.id,
          action: 'RESTORE',
          before: entityAuditSnapshot(before),
          after: entityAuditSnapshot(after),
        });

        return after;
      });
    },
    verify: async (entityTypeKey, entityId, verifiedAt = new Date()) => {
      return prisma.$transaction(async transaction => {
        const before = await transaction.businessEntity.findFirst({
          where: {
            id: entityId,
            businessId,
            entityType: { key: entityTypeKey.trim().toLowerCase() },
          },
        });

        if (!before) {
          return null;
        }

        await transaction.$executeRaw`
          UPDATE "business_entities"
          SET "last_verified_at" = ${verifiedAt}
          WHERE "id" = ${before.id}::uuid
            AND "business_id" = ${businessId}::uuid
        `;
        const after = await transaction.businessEntity.findFirstOrThrow({
          where: { id: before.id, businessId },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_ENTITY',
          targetId: after.id,
          action: 'VERIFY',
          before: { data: before.data, lastVerifiedAt: before.lastVerifiedAt },
          after: { data: after.data, lastVerifiedAt: after.lastVerifiedAt },
        });

        return after;
      });
    },
  };
};
