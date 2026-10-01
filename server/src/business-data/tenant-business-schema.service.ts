import {
  Prisma,
  type BusinessFieldDefinition,
  type BusinessFieldType,
  type FreshnessClass,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';
import { parseFieldOptions, validateFieldValue } from './dynamic-entity-validation';

export type BusinessSchemaChangeErrorCode =
  | 'FIELD_KEY_IMMUTABLE'
  | 'INVALID_FIELD_OPTIONS'
  | 'INVALID_STALE_AFTER'
  | 'REQUIRED_FIELD_MISSING_IN_EXISTING_DATA'
  | 'IN_USE_SELECT_OPTION_REMOVAL'
  | 'IN_USE_FIELD_TYPE_CHANGE';

export class BusinessSchemaChangeError extends Error {
  readonly code: BusinessSchemaChangeErrorCode;
  readonly field: string;

  constructor(code: BusinessSchemaChangeErrorCode, field: string, message: string) {
    super(message);
    this.name = 'BusinessSchemaChangeError';
    this.code = code;
    this.field = field;
  }
}

export interface AddBusinessFieldDefinitionInput {
  entityTypeId: string;
  key: string;
  label: string;
  type: BusinessFieldType;
  required?: boolean;
  enabled?: boolean;
  options?: Prisma.InputJsonValue | null;
  displayOrder: number;
  freshnessClass?: FreshnessClass;
  staleAfterSeconds?: number | null;
  businessId?: never;
}

export interface UpdateBusinessFieldDefinitionInput {
  label?: string;
  type?: BusinessFieldType;
  required?: boolean;
  enabled?: boolean;
  options?: Prisma.InputJsonValue | null;
  displayOrder?: number;
  freshnessClass?: FreshnessClass;
  staleAfterSeconds?: number | null;
  key?: never;
  businessId?: never;
}

export interface TenantBusinessSchemaService {
  addFieldDefinition(
    input: AddBusinessFieldDefinitionInput,
  ): Promise<BusinessFieldDefinition | null>;
  updateFieldDefinition(
    fieldId: string,
    input: UpdateBusinessFieldDefinitionInput,
  ): Promise<BusinessFieldDefinition | null>;
}

const isSelectableType = (type: BusinessFieldType) =>
  type === 'SELECT' || type === 'MULTI_SELECT';

const assertValidStaleAfter = (fieldKey: string, value: number | null | undefined) => {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new BusinessSchemaChangeError(
      'INVALID_STALE_AFTER',
      fieldKey,
      'Stale-after seconds must be a non-negative integer or null.',
    );
  }
};

const assertValidOptions = (
  fieldKey: string,
  type: BusinessFieldType,
  options: unknown,
): void => {
  if (!isSelectableType(type)) {
    if (options !== undefined && options !== null) {
      throw new BusinessSchemaChangeError(
        'INVALID_FIELD_OPTIONS',
        fieldKey,
        'Only SELECT and MULTI_SELECT fields may define options.',
      );
    }

    return;
  }

  if (!parseFieldOptions(options).valid) {
    throw new BusinessSchemaChangeError(
      'INVALID_FIELD_OPTIONS',
      fieldKey,
      'Field options must be a unique array of strings or value/label objects.',
    );
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasStoredField = (data: unknown, key: string): boolean =>
  isRecord(data) && Object.hasOwn(data, key);

const usesOption = (data: unknown, key: string, options: Set<string>): boolean => {
  if (!isRecord(data) || !Object.hasOwn(data, key)) {
    return false;
  }

  const value = data[key];

  return typeof value === 'string'
    ? options.has(value)
    : Array.isArray(value) &&
        value.some(item => typeof item === 'string' && options.has(item));
};

export const createTenantBusinessSchemaService = (
  tenant: TenantContext,
): TenantBusinessSchemaService => {
  const businessId = tenant.businessId;

  return {
    addFieldDefinition: async input => {
      requireBusinessPermission(tenant, 'BUSINESS_SCHEMA_WRITE');
      return prisma.$transaction(async transaction => {
        const entityType = await transaction.businessEntityType.findFirst({
          where: {
            id: input.entityTypeId,
            businessId,
          },
        });

        if (!entityType) {
          return null;
        }

        const required = input.required ?? false;
        const enabled = input.enabled ?? true;

        assertValidOptions(input.key, input.type, input.options);
        assertValidStaleAfter(input.key, input.staleAfterSeconds);

        if (required && enabled) {
          const existingEntityCount = await transaction.businessEntity.count({
            where: {
              businessId,
              entityTypeId: entityType.id,
            },
          });

          if (existingEntityCount > 0) {
            throw new BusinessSchemaChangeError(
              'REQUIRED_FIELD_MISSING_IN_EXISTING_DATA',
              input.key,
              'A required field cannot be added while existing entities lack it.',
            );
          }
        }

        const field = await transaction.businessFieldDefinition.create({
          data: {
            entityTypeId: entityType.id,
            key: input.key.trim(),
            label: input.label.trim(),
            type: input.type,
            required,
            enabled,
            ...(input.options === undefined
              ? {}
              : { options: input.options === null ? Prisma.DbNull : input.options }),
            displayOrder: input.displayOrder,
            freshnessClass: input.freshnessClass ?? 'CHANGING',
            staleAfterSeconds: input.staleAfterSeconds ?? null,
          },
        });

        await transaction.businessEntityType.update({
          where: { id: entityType.id },
          data: { schemaVersion: { increment: 1 } },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_FIELD_DEFINITION',
          targetId: field.id,
          action: 'SCHEMA_CHANGE',
          before: null,
          after: field,
        });

        return field;
      });
    },
    updateFieldDefinition: async (fieldId, input) => {
      requireBusinessPermission(tenant, 'BUSINESS_SCHEMA_WRITE');
      return prisma.$transaction(async transaction => {
        const field = await transaction.businessFieldDefinition.findFirst({
          where: {
            id: fieldId,
            entityType: { businessId },
          },
        });

        if (!field) {
          return null;
        }

        if (Object.hasOwn(input, 'key')) {
          throw new BusinessSchemaChangeError(
            'FIELD_KEY_IMMUTABLE',
            field.key,
            'Field keys cannot be changed after creation.',
          );
        }

        const hasContractChange = [
          'label',
          'type',
          'required',
          'enabled',
          'options',
          'displayOrder',
          'freshnessClass',
          'staleAfterSeconds',
        ].some(key => Object.hasOwn(input, key));

        if (!hasContractChange) {
          return field;
        }

        const nextType = input.type ?? field.type;
        const nextRequired = input.required ?? field.required;
        const nextEnabled = input.enabled ?? field.enabled;
        const optionsWereProvided = Object.hasOwn(input, 'options');
        assertValidStaleAfter(field.key, input.staleAfterSeconds);
        const nextOptions = isSelectableType(nextType)
          ? optionsWereProvided
            ? input.options
            : field.options
          : null;

        assertValidOptions(field.key, nextType, nextOptions);

        const entities = await transaction.businessEntity.findMany({
          where: {
            businessId,
            entityTypeId: field.entityTypeId,
          },
          select: { data: true },
        });

        if (
          nextType !== field.type &&
          entities.some(entity => hasStoredField(entity.data, field.key))
        ) {
          throw new BusinessSchemaChangeError(
            'IN_USE_FIELD_TYPE_CHANGE',
            field.key,
            'A field type cannot change while existing entities use the field.',
          );
        }

        if (isSelectableType(field.type) && isSelectableType(nextType)) {
          const currentOptions = parseFieldOptions(field.options);
          const parsedNextOptions = parseFieldOptions(nextOptions);
          const nextValues = new Set(parsedNextOptions.valid ? parsedNextOptions.values : []);
          const removedOptions = new Set(
            currentOptions.valid
              ? currentOptions.values.filter(value => !nextValues.has(value))
              : [],
          );

          if (
            removedOptions.size > 0 &&
            entities.some(entity => usesOption(entity.data, field.key, removedOptions))
          ) {
            throw new BusinessSchemaChangeError(
              'IN_USE_SELECT_OPTION_REMOVAL',
              field.key,
              'An option cannot be removed while existing entities use it.',
            );
          }
        }

        const activatesRequiredValidation =
          nextRequired &&
          nextEnabled &&
          (!field.required || !field.enabled || nextType !== field.type);

        if (
          activatesRequiredValidation &&
          entities.some(entity => {
            if (!isRecord(entity.data) || !Object.hasOwn(entity.data, field.key)) {
              return true;
            }

            const value = entity.data[field.key];

            return (
              value === null ||
              ((nextType === 'TEXT' || nextType === 'LONG_TEXT') && value === '') ||
              validateFieldValue(
                {
                  key: field.key,
                  type: nextType,
                  required: nextRequired,
                  enabled: nextEnabled,
                  options: (nextOptions ?? null) as Prisma.JsonValue,
                },
                value,
              ) !== null
            );
          })
        ) {
          throw new BusinessSchemaChangeError(
            'REQUIRED_FIELD_MISSING_IN_EXISTING_DATA',
            field.key,
            'The field cannot become required while existing entities would be invalid.',
          );
        }

        const updatedField = await transaction.businessFieldDefinition.update({
          where: { id: field.id },
          data: {
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
            ...(input.type === undefined ? {} : { type: input.type }),
            ...(input.required === undefined ? {} : { required: input.required }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(optionsWereProvided || !isSelectableType(nextType)
              ? { options: nextOptions === null ? Prisma.DbNull : nextOptions }
              : {}),
            ...(input.displayOrder === undefined
              ? {}
              : { displayOrder: input.displayOrder }),
            ...(input.freshnessClass === undefined
              ? {}
              : { freshnessClass: input.freshnessClass }),
            ...(input.staleAfterSeconds === undefined
              ? {}
              : { staleAfterSeconds: input.staleAfterSeconds }),
          },
        });

        await transaction.businessEntityType.update({
          where: { id: field.entityTypeId },
          data: { schemaVersion: { increment: 1 } },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'BUSINESS_FIELD_DEFINITION',
          targetId: updatedField.id,
          action: 'SCHEMA_CHANGE',
          before: field,
          after: updatedField,
        });

        return updatedField;
      });
    },
  };
};
