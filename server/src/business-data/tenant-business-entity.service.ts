import type {
  BusinessEntity,
  BusinessEntityStatus,
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
}

export const createTenantBusinessEntityService = (
  tenant: TenantContext,
): TenantBusinessEntityService => {
  const businessId = tenant.businessId;

  return {
    create: async input => {
      const entityType = await prisma.businessEntityType.findFirst({
        where: {
          id: input.entityTypeId,
          businessId,
        },
        include: {
          fieldDefinitions: {
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
        },
      });

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
    },
  };
};
