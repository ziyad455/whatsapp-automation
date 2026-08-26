import { describe, expect, it } from 'vitest';
import {
  validateEntityData,
  type ValidatableField,
} from '../src/business-data/dynamic-entity-validation';
import type { BusinessFieldType } from '../src/generated/prisma/client';

const field = (
  key: string,
  type: BusinessFieldType,
  overrides: Partial<ValidatableField> = {},
): ValidatableField => ({
  key,
  type,
  required: false,
  enabled: true,
  options: null,
  ...overrides,
});

const expectIssue = (
  fields: ValidatableField[],
  data: unknown,
  expected: { field: string | null; code: string },
) => {
  const result = validateEntityData(fields, data);

  expect(result.success).toBe(false);

  if (!result.success) {
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
  }
};

describe('dynamic entity schema validation', () => {
  it('accepts every supported field representation without coercion', () => {
    const fields = [
      field('name', 'TEXT', { required: true }),
      field('description', 'LONG_TEXT'),
      field('price', 'NUMBER'),
      field('available', 'BOOLEAN'),
      field('startDate', 'DATE'),
      field('appointmentTime', 'DATETIME'),
      field('transmission', 'SELECT', { options: ['manual', 'automatic'] }),
      field('features', 'MULTI_SELECT', {
        options: [
          { value: 'wifi', label: 'Wi-Fi' },
          { value: 'air_conditioning', label: 'Air conditioning' },
        ],
      }),
    ];
    const data = {
      name: 'Renault Clio',
      description: 'Compact rental vehicle',
      price: 450,
      available: true,
      startDate: '2026-08-26',
      appointmentTime: '2026-08-26T14:30:00+01:00',
      transmission: 'automatic',
      features: ['wifi', 'air_conditioning'],
    };

    expect(validateEntityData(fields, data)).toEqual({ success: true, data });
  });

  it('rejects missing and empty required text values', () => {
    const fields = [field('brand', 'TEXT', { required: true })];

    expectIssue(fields, {}, { field: 'brand', code: 'MISSING_REQUIRED_FIELD' });
    expectIssue(fields, { brand: '' }, {
      field: 'brand',
      code: 'MISSING_REQUIRED_FIELD',
    });
  });

  it.each([
    ['TEXT', 123],
    ['LONG_TEXT', false],
    ['NUMBER', '450'],
    ['NUMBER', Number.NaN],
    ['NUMBER', Number.POSITIVE_INFINITY],
    ['BOOLEAN', 'true'],
  ] as const)('rejects invalid %s values', (type, value) => {
    expectIssue([field('value', type)], { value }, {
      field: 'value',
      code: 'INVALID_TYPE',
    });
  });

  it('rejects invalid and non-canonical dates', () => {
    const fields = [field('startDate', 'DATE')];

    expectIssue(fields, { startDate: '2026-02-30' }, {
      field: 'startDate',
      code: 'INVALID_DATE',
    });
    expectIssue(fields, { startDate: '26/08/2026' }, {
      field: 'startDate',
      code: 'INVALID_DATE',
    });
  });

  it('rejects invalid, ambiguous, and offset-free datetimes', () => {
    const fields = [field('appointmentTime', 'DATETIME')];

    expectIssue(fields, { appointmentTime: '2026-08-26 14:30' }, {
      field: 'appointmentTime',
      code: 'INVALID_DATETIME',
    });
    expectIssue(fields, { appointmentTime: '2026-08-26T14:30:00' }, {
      field: 'appointmentTime',
      code: 'INVALID_DATETIME',
    });
  });

  it('rejects values outside SELECT and MULTI_SELECT options', () => {
    expectIssue(
      [field('transmission', 'SELECT', { options: ['manual', 'automatic'] })],
      { transmission: 'semi-automatic' },
      { field: 'transmission', code: 'INVALID_SELECT_OPTION' },
    );
    expectIssue(
      [field('features', 'MULTI_SELECT', { options: ['wifi', 'parking'] })],
      { features: ['wifi', 'spa'] },
      { field: 'features', code: 'INVALID_MULTI_SELECT_OPTION' },
    );
  });

  it('rejects duplicate MULTI_SELECT values', () => {
    expectIssue(
      [field('features', 'MULTI_SELECT', { options: ['wifi', 'parking'] })],
      { features: ['wifi', 'wifi'] },
      { field: 'features', code: 'DUPLICATE_MULTI_SELECT_OPTION' },
    );
  });

  it('rejects unknown and disabled fields in new input', () => {
    const fields = [
      field('brand', 'TEXT'),
      field('legacyCode', 'TEXT', { enabled: false }),
    ];
    const result = validateEntityData(fields, {
      brand: 'Dacia',
      typo: 'Duster',
      legacyCode: 'old-value',
    });

    expect(result).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'typo', code: 'UNKNOWN_FIELD' }),
        expect.objectContaining({ field: 'legacyCode', code: 'DISABLED_FIELD' }),
      ]),
    });
  });

  it('rejects non-object entity data', () => {
    expectIssue([], ['not', 'an', 'object'], { field: null, code: 'INVALID_TYPE' });
    expectIssue([], null, { field: null, code: 'INVALID_TYPE' });
  });
});
