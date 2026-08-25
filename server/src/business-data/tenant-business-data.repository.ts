import type {
  BusinessEntity,
  BusinessEntityStatus,
  BusinessEntityType,
  BusinessFieldDefinition,
  BusinessFieldType,
  Prisma,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

export interface CreateBusinessEntityTypeInput {
  key: string;
  name: string;
  description?: string;
  schemaVersion?: number;
  businessId?: never;
}

export interface CreateBusinessFieldDefinitionInput {
  entityTypeId: string;
  key: string;
  label: string;
  type: BusinessFieldType;
  required?: boolean;
  options?: Prisma.InputJsonValue;
  displayOrder: number;
  businessId?: never;
}

export interface CreateBusinessEntityInput {
  entityTypeId: string;
  name: string;
  data: Prisma.InputJsonValue;
  status?: BusinessEntityStatus;
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
  listEntityTypes(): Promise<BusinessEntityType[]>;
  createFieldDefinition(
    input: CreateBusinessFieldDefinitionInput,
  ): Promise<BusinessFieldDefinition | null>;
  listFieldDefinitions(entityTypeId: string): Promise<BusinessFieldDefinition[]>;
  createEntity(input: CreateBusinessEntityInput): Promise<BusinessEntity | null>;
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
      prisma.businessEntityType.create({
        data: {
          businessId,
          key: normalizeEntityTypeKey(input.key),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          schemaVersion: input.schemaVersion ?? 1,
        },
      }),
    findEntityTypeById: findOwnedEntityType,
    listEntityTypes: () =>
      prisma.businessEntityType.findMany({
        where: { businessId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    createFieldDefinition: async input => {
      const entityType = await findOwnedEntityType(input.entityTypeId);

      if (!entityType) {
        return null;
      }

      return prisma.businessFieldDefinition.create({
        data: {
          entityTypeId: entityType.id,
          key: input.key.trim(),
          label: input.label.trim(),
          type: input.type,
          required: input.required ?? false,
          ...(input.options === undefined ? {} : { options: input.options }),
          displayOrder: input.displayOrder,
        },
      });
    },
    listFieldDefinitions: entityTypeId =>
      prisma.businessFieldDefinition.findMany({
        where: {
          entityTypeId,
          entityType: { businessId },
        },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
    createEntity: async input => {
      const entityType = await findOwnedEntityType(input.entityTypeId);

      if (!entityType) {
        return null;
      }

      return prisma.businessEntity.create({
        data: {
          businessId,
          entityTypeId: entityType.id,
          name: input.name.trim(),
          data: input.data,
          status: input.status ?? 'ACTIVE',
        },
      });
    },
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
          ...(input?.status === undefined ? {} : { status: input.status }),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
  };
};
