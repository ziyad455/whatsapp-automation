import { z } from 'zod';
import type {
  BusinessFieldDefinition,
  Prisma,
} from '../generated/prisma/client';

export type DynamicEntityValidationErrorCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_SELECT_OPTION'
  | 'INVALID_MULTI_SELECT_OPTION'
  | 'DUPLICATE_MULTI_SELECT_OPTION'
  | 'UNKNOWN_FIELD'
  | 'DISABLED_FIELD'
  | 'INVALID_DATE'
  | 'INVALID_DATETIME';

export interface DynamicEntityValidationIssue {
  field: string | null;
  code: DynamicEntityValidationErrorCode;
  message: string;
}

export type DynamicEntityValidationResult =
  | {
      success: true;
      data: Prisma.InputJsonObject;
    }
  | {
      success: false;
      errors: DynamicEntityValidationIssue[];
    };

export type ValidatableField = Pick<
  BusinessFieldDefinition,
  'key' | 'type' | 'required' | 'enabled' | 'options'
>;

export type ParsedFieldOptions =
  | { valid: true; values: string[] }
  | { valid: false; values: [] };

const dateSchema = z.iso.date();
const dateTimeSchema = z.iso.datetime({ offset: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseFieldOptions = (options: unknown): ParsedFieldOptions => {
  if (options === null || options === undefined) {
    return { valid: true, values: [] };
  }

  if (!Array.isArray(options)) {
    return { valid: false, values: [] };
  }

  const values: string[] = [];

  for (const option of options) {
    if (typeof option === 'string' && option.length > 0) {
      values.push(option);
      continue;
    }

    if (
      isRecord(option) &&
      typeof option.value === 'string' &&
      option.value.length > 0 &&
      (option.label === undefined || typeof option.label === 'string')
    ) {
      values.push(option.value);
      continue;
    }

    return { valid: false, values: [] };
  }

  if (new Set(values).size !== values.length) {
    return { valid: false, values: [] };
  }

  return { valid: true, values };
};

const invalidType = (field: ValidatableField, expected: string) => ({
  field: field.key,
  code: 'INVALID_TYPE' as const,
  message: `Expected ${expected}`,
});

export const validateFieldValue = (
  field: ValidatableField,
  value: unknown,
): DynamicEntityValidationIssue | null => {
  switch (field.type) {
    case 'TEXT':
    case 'LONG_TEXT':
      return typeof value === 'string' ? null : invalidType(field, 'string');
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : invalidType(field, 'finite number');
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : invalidType(field, 'boolean');
    case 'DATE':
      if (typeof value !== 'string') {
        return invalidType(field, 'date in YYYY-MM-DD format');
      }

      return dateSchema.safeParse(value).success
        ? null
        : {
            field: field.key,
            code: 'INVALID_DATE',
            message: 'Expected a valid date in YYYY-MM-DD format',
          };
    case 'DATETIME':
      if (typeof value !== 'string') {
        return invalidType(field, 'offset-aware ISO-8601 datetime');
      }

      return dateTimeSchema.safeParse(value).success
        ? null
        : {
            field: field.key,
            code: 'INVALID_DATETIME',
            message: 'Expected a valid offset-aware ISO-8601 datetime',
          };
    case 'SELECT': {
      if (typeof value !== 'string') {
        return invalidType(field, 'string option');
      }

      const options = parseFieldOptions(field.options);

      return options.valid && options.values.includes(value)
        ? null
        : {
            field: field.key,
            code: 'INVALID_SELECT_OPTION',
            message: 'Expected one configured option',
          };
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        return invalidType(field, 'array of string options');
      }

      if (new Set(value).size !== value.length) {
        return {
          field: field.key,
          code: 'DUPLICATE_MULTI_SELECT_OPTION',
          message: 'Multi-select values must not contain duplicates',
        };
      }

      const options = parseFieldOptions(field.options);

      return options.valid && value.every(item => options.values.includes(item))
        ? null
        : {
            field: field.key,
            code: 'INVALID_MULTI_SELECT_OPTION',
            message: 'Expected only configured options',
          };
    }
  }
};

export const validateEntityData = (
  fields: readonly ValidatableField[],
  data: unknown,
): DynamicEntityValidationResult => {
  if (!isRecord(data)) {
    return {
      success: false,
      errors: [
        {
          field: null,
          code: 'INVALID_TYPE',
          message: 'Expected entity data to be an object',
        },
      ],
    };
  }

  const errors: DynamicEntityValidationIssue[] = [];
  const fieldsByKey = new Map(fields.map(field => [field.key, field]));

  for (const key of Object.keys(data)) {
    const field = fieldsByKey.get(key);

    if (!field) {
      errors.push({
        field: key,
        code: 'UNKNOWN_FIELD',
        message: 'Field is not defined by this entity type',
      });
    } else if (!field.enabled) {
      errors.push({
        field: key,
        code: 'DISABLED_FIELD',
        message: 'Field is disabled for new entity data',
      });
    }
  }

  for (const field of fields) {
    if (!field.enabled) {
      continue;
    }

    const exists = Object.hasOwn(data, field.key);
    const value = data[field.key];

    if (!exists) {
      if (field.required) {
        errors.push({
          field: field.key,
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Required field is missing',
        });
      }

      continue;
    }

    if (
      field.required &&
      (value === null ||
        ((field.type === 'TEXT' || field.type === 'LONG_TEXT') && value === ''))
    ) {
      errors.push({
        field: field.key,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Required field must contain a value',
      });
      continue;
    }

    const fieldError = validateFieldValue(field, value);

    if (fieldError) {
      errors.push(fieldError);
    }
  }

  return errors.length === 0
    ? { success: true, data: data as Prisma.InputJsonObject }
    : { success: false, errors };
};

export class DynamicEntityValidationError extends Error {
  readonly errors: DynamicEntityValidationIssue[];

  constructor(errors: DynamicEntityValidationIssue[]) {
    super('Dynamic entity data failed schema validation.');
    this.name = 'DynamicEntityValidationError';
    this.errors = errors;
  }
}
