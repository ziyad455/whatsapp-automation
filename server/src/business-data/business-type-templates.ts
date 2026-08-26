import type { BusinessFieldType, Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

export type SupportedBusinessTemplateCategory = 'CAR_RENTAL' | 'SALON' | 'GYM';

interface BusinessFieldTemplate {
  key: string;
  label: string;
  type: BusinessFieldType;
  required: boolean;
  options?: readonly string[];
}

interface BusinessEntityTypeTemplate {
  key: string;
  name: string;
  description: string;
  fields: readonly BusinessFieldTemplate[];
}

interface BusinessTypeTemplate {
  category: SupportedBusinessTemplateCategory;
  entityTypes: readonly BusinessEntityTypeTemplate[];
}

export const BUSINESS_TYPE_TEMPLATES = {
  CAR_RENTAL: {
    category: 'CAR_RENTAL',
    entityTypes: [
      {
        key: 'vehicle',
        name: 'Vehicles',
        description: 'Vehicles available through this business',
        fields: [
          { key: 'brand', label: 'Brand', type: 'TEXT', required: true },
          { key: 'model', label: 'Model', type: 'TEXT', required: true },
          {
            key: 'transmission',
            label: 'Transmission',
            type: 'SELECT',
            required: false,
            options: ['manual', 'automatic'],
          },
          {
            key: 'pricePerDay',
            label: 'Price per day',
            type: 'NUMBER',
            required: true,
          },
          {
            key: 'available',
            label: 'Available',
            type: 'BOOLEAN',
            required: true,
          },
        ],
      },
    ],
  },
  SALON: {
    category: 'SALON',
    entityTypes: [
      {
        key: 'service',
        name: 'Services',
        description: 'Services offered by this business',
        fields: [
          { key: 'price', label: 'Price', type: 'NUMBER', required: true },
          {
            key: 'durationMinutes',
            label: 'Duration in minutes',
            type: 'NUMBER',
            required: false,
          },
          {
            key: 'gender',
            label: 'Gender',
            type: 'SELECT',
            required: false,
            options: ['men', 'women', 'unisex'],
          },
          {
            key: 'available',
            label: 'Available',
            type: 'BOOLEAN',
            required: false,
          },
        ],
      },
    ],
  },
  GYM: {
    category: 'GYM',
    entityTypes: [
      {
        key: 'membership',
        name: 'Memberships',
        description: 'Membership plans offered by this business',
        fields: [
          { key: 'price', label: 'Price', type: 'NUMBER', required: true },
          {
            key: 'durationMonths',
            label: 'Duration in months',
            type: 'NUMBER',
            required: true,
          },
          {
            key: 'includesCoach',
            label: 'Includes coach',
            type: 'BOOLEAN',
            required: false,
          },
        ],
      },
    ],
  },
} as const satisfies Record<SupportedBusinessTemplateCategory, BusinessTypeTemplate>;

export class UnsupportedBusinessTemplateError extends Error {
  readonly category: string;

  constructor(category: string) {
    super(`No business schema template is defined for category ${category}.`);
    this.name = 'UnsupportedBusinessTemplateError';
    this.category = category;
  }
}

export interface BusinessTemplateApplicationResult {
  category: SupportedBusinessTemplateCategory;
  createdEntityTypeKeys: string[];
  skippedEntityTypeKeys: string[];
}

const isSupportedCategory = (
  category: string,
): category is SupportedBusinessTemplateCategory =>
  Object.hasOwn(BUSINESS_TYPE_TEMPLATES, category);

export const applyBusinessTemplate = async (
  tenant: TenantContext,
): Promise<BusinessTemplateApplicationResult> => {
  const business = await prisma.business.findUnique({
    where: { id: tenant.businessId },
    select: { category: true },
  });

  if (!business) {
    throw new UnsupportedBusinessTemplateError('UNKNOWN');
  }

  const category = business.category.trim().toUpperCase();

  if (!isSupportedCategory(category)) {
    throw new UnsupportedBusinessTemplateError(category);
  }

  const template = BUSINESS_TYPE_TEMPLATES[category];

  return prisma.$transaction(async transaction => {
    const existingEntityTypes = await transaction.businessEntityType.findMany({
      where: {
        businessId: tenant.businessId,
        key: { in: template.entityTypes.map(entityType => entityType.key) },
      },
      select: { key: true },
    });
    const existingKeys = new Set(existingEntityTypes.map(entityType => entityType.key));
    const createdEntityTypeKeys: string[] = [];
    const skippedEntityTypeKeys: string[] = [];

    for (const entityType of template.entityTypes) {
      if (existingKeys.has(entityType.key)) {
        skippedEntityTypeKeys.push(entityType.key);
        continue;
      }

      await transaction.businessEntityType.upsert({
        where: {
          businessId_key: {
            businessId: tenant.businessId,
            key: entityType.key,
          },
        },
        update: {},
        create: {
          businessId: tenant.businessId,
          key: entityType.key,
          name: entityType.name,
          description: entityType.description,
          schemaVersion: 1,
          fieldDefinitions: {
            create: entityType.fields.map((field, displayOrder) => {
              const options = 'options' in field ? field.options : undefined;

              return {
                key: field.key,
                label: field.label,
                type: field.type,
                required: field.required,
                enabled: true,
                options:
                  options === undefined
                    ? undefined
                    : ([...options] as Prisma.InputJsonValue),
                displayOrder,
              };
            }),
          },
        },
      });
      createdEntityTypeKeys.push(entityType.key);
    }

    return {
      category,
      createdEntityTypeKeys,
      skippedEntityTypeKeys,
    };
  });
};
