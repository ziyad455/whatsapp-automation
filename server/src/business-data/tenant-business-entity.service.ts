import type {
  BusinessEntity,
  BusinessEntityStatus,
  Prisma,
} from '../generated/prisma/client';
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
}

const isRecord = (value: unknown): value is Record<string, Prisma.JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

    return prisma.businessEntity.create({
      data: {
        businessId,
        entityTypeId: entityType.id,
        name: input.name.trim(),
        data: validation.data,
        status: input.status ?? 'ACTIVE',
      },
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
      const entity = await prisma.businessEntity.findFirst({
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

      const validation = validateEntityData(entity.entityType.fieldDefinitions, input.data);

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

      const result = await prisma.businessEntity.updateMany({
        where: { id: entity.id, businessId, entityTypeId: entity.entityTypeId },
        data: {
          name: input.name.trim(),
          data: { ...validation.data, ...historicalValues },
        },
      });

      return result.count === 0
        ? null
        : prisma.businessEntity.findFirst({ where: { id: entity.id, businessId } });
    },
    archive: async (entityTypeKey, entityId) => {
      const result = await prisma.businessEntity.updateMany({
        where: {
          id: entityId,
          businessId,
          entityType: { key: entityTypeKey.trim().toLowerCase() },
        },
        data: { status: 'ARCHIVED' },
      });

      return result.count === 0
        ? null
        : prisma.businessEntity.findFirst({ where: { id: entityId, businessId } });
    },
  };
};
