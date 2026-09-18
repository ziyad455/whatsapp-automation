import {
  Prisma,
  type BusinessEntity,
  type BusinessEntityStatus,
  type BusinessFieldDefinition,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantScope } from '../tenancy/tenant-context';
import { parseFieldOptions, validateFieldValue } from './dynamic-entity-validation';

export const DEFAULT_ENTITY_QUERY_LIMIT = 25;
export const MAX_ENTITY_QUERY_LIMIT = 100;
export const MAX_ENTITY_QUERY_OFFSET = 10_000;

export type DynamicEntityQueryErrorCode =
  | 'INVALID_LIMIT'
  | 'INVALID_OFFSET'
  | 'INVALID_STATUS'
  | 'UNKNOWN_FILTER_FIELD'
  | 'DISABLED_FILTER_FIELD'
  | 'UNSUPPORTED_FILTER_TYPE'
  | 'INVALID_FILTER_VALUE';

export interface DynamicEntityQueryIssue {
  field: string | null;
  code: DynamicEntityQueryErrorCode;
  message: string;
}

export class DynamicEntityQueryError extends Error {
  readonly errors: DynamicEntityQueryIssue[];

  constructor(errors: DynamicEntityQueryIssue[]) {
    super('Dynamic entity query failed validation.');
    this.name = 'DynamicEntityQueryError';
    this.errors = errors;
  }
}

export interface SearchBusinessEntitiesInput {
  entityType: string;
  search?: string;
  status?: BusinessEntityStatus;
  filters?: Readonly<Record<string, unknown>>;
  limit?: number;
  offset?: number;
  businessId?: never;
}

export interface BusinessEntityQueryPage {
  items: BusinessEntity[];
  limit: number;
  offset: number;
}

export interface TenantBusinessEntityQueryService {
  search(input: SearchBusinessEntitiesInput): Promise<BusinessEntityQueryPage>;
}

const validateQueryBounds = (
  limit: number,
  offset: number,
  status: unknown,
): DynamicEntityQueryIssue[] => {
  const errors: DynamicEntityQueryIssue[] = [];

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ENTITY_QUERY_LIMIT) {
    errors.push({
      field: 'limit',
      code: 'INVALID_LIMIT',
      message: `Limit must be an integer from 1 to ${MAX_ENTITY_QUERY_LIMIT}`,
    });
  }

  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_ENTITY_QUERY_OFFSET) {
    errors.push({
      field: 'offset',
      code: 'INVALID_OFFSET',
      message: `Offset must be an integer from 0 to ${MAX_ENTITY_QUERY_OFFSET}`,
    });
  }

  if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
    errors.push({
      field: 'status',
      code: 'INVALID_STATUS',
      message: 'Status must be ACTIVE or ARCHIVED',
    });
  }

  return errors;
};

const validateFilter = (
  field: BusinessFieldDefinition,
  value: unknown,
): DynamicEntityQueryIssue | null => {
  if (!field.enabled) {
    return {
      field: field.key,
      code: 'DISABLED_FILTER_FIELD',
      message: 'Disabled fields cannot be used for new queries',
    };
  }

  if (field.type === 'LONG_TEXT') {
    return {
      field: field.key,
      code: 'UNSUPPORTED_FILTER_TYPE',
      message: 'LONG_TEXT equality filters are not supported',
    };
  }

  if (field.type === 'MULTI_SELECT') {
    const options = parseFieldOptions(field.options);

    return typeof value === 'string' && options.valid && options.values.includes(value)
      ? null
      : {
          field: field.key,
          code: 'INVALID_FILTER_VALUE',
          message: 'Expected one configured multi-select option to contain',
        };
  }

  const validationIssue = validateFieldValue(field, value);

  return validationIssue
    ? {
        field: field.key,
        code: 'INVALID_FILTER_VALUE',
        message: validationIssue.message,
      }
    : null;
};

export const createTenantBusinessEntityQueryService = (
  tenant: TenantScope,
): TenantBusinessEntityQueryService => {
  const businessId = tenant.businessId;

  return {
    search: async input => {
      const limit = input.limit ?? DEFAULT_ENTITY_QUERY_LIMIT;
      const offset = input.offset ?? 0;
      const status = input.status ?? 'ACTIVE';
      const boundsErrors = validateQueryBounds(limit, offset, status);

      if (boundsErrors.length > 0) {
        throw new DynamicEntityQueryError(boundsErrors);
      }

      const entityType = await prisma.businessEntityType.findUnique({
        where: {
          businessId_key: {
            businessId,
            key: input.entityType.trim().toLowerCase(),
          },
        },
        include: {
          fieldDefinitions: true,
        },
      });

      if (!entityType) {
        return { items: [], limit, offset };
      }

      const fieldsByKey = new Map(
        entityType.fieldDefinitions.map(field => [field.key, field]),
      );
      const filterErrors: DynamicEntityQueryIssue[] = [];
      const containment: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;

      for (const [key, value] of Object.entries(input.filters ?? {})) {
        const field = fieldsByKey.get(key);

        if (!field) {
          filterErrors.push({
            field: key,
            code: 'UNKNOWN_FILTER_FIELD',
            message: 'Filter field is not defined by this entity type',
          });
          continue;
        }

        const filterError = validateFilter(field, value);

        if (filterError) {
          filterErrors.push(filterError);
          continue;
        }

        containment[key] = field.type === 'MULTI_SELECT' ? [value] : value;
      }

      if (filterErrors.length > 0) {
        throw new DynamicEntityQueryError(filterErrors);
      }

      const clauses = [
        Prisma.sql`"business_id" = ${businessId}::uuid`,
        Prisma.sql`"entity_type_id" = ${entityType.id}::uuid`,
        Prisma.sql`"status" = ${status}::business_entity_status`,
      ];
      const search = input.search?.trim();

      if (search) {
        clauses.push(Prisma.sql`POSITION(LOWER(${search}) IN LOWER("name")) > 0`);
      }

      if (Object.keys(containment).length > 0) {
        clauses.push(
          Prisma.sql`"data" @> ${JSON.stringify(containment)}::jsonb`,
        );
      }

      const items = await prisma.$queryRaw<BusinessEntity[]>(Prisma.sql`
        SELECT
          "id",
          "business_id" AS "businessId",
          "entity_type_id" AS "entityTypeId",
          "name",
          "data",
          "status",
          "source",
          "external_id" AS "externalId",
          "last_verified_at" AS "lastVerifiedAt",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
        FROM "business_entities"
        WHERE ${Prisma.join(clauses, ' AND ')}
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      return { items, limit, offset };
    },
  };
};
