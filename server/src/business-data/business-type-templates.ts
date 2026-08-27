import type {
  BusinessFieldType,
  FreshnessClass,
  Prisma,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

export type SupportedBusinessTemplateCategory = 'CAR_RENTAL' | 'SALON' | 'GYM';

interface BusinessFieldTemplate {
  key: string;
  label: string;
  type: BusinessFieldType;
  required: boolean;
  freshnessClass: FreshnessClass;
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
          {
            key: 'brand',
            label: 'Brand',
            type: 'TEXT',
            required: true,
            freshnessClass: 'STABLE',
          },
          {
            key: 'model',
            label: 'Model',
            type: 'TEXT',
            required: true,
            freshnessClass: 'STABLE',
          },
          {
            key: 'transmission',
            label: 'Transmission',
            type: 'SELECT',
            required: false,
            freshnessClass: 'STABLE',
            options: ['manual', 'automatic'],
          },
          {
            key: 'pricePerDay',
            label: 'Price per day',
            type: 'NUMBER',
            required: true,
            freshnessClass: 'CHANGING',
          },
          {
            key: 'available',
            label: 'Available',
            type: 'BOOLEAN',
            required: true,
            freshnessClass: 'REAL_TIME',
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
          {
            key: 'price',
            label: 'Price',
            type: 'NUMBER',
            required: true,
            freshnessClass: 'CHANGING',
          },
          {
            key: 'durationMinutes',
            label: 'Duration in minutes',
            type: 'NUMBER',
            required: false,
            freshnessClass: 'STABLE',
          },
          {
            key: 'gender',
            label: 'Gender',
            type: 'SELECT',
            required: false,
            freshnessClass: 'STABLE',
            options: ['men', 'women', 'unisex'],
          },
          {
            key: 'available',
            label: 'Available',
            type: 'BOOLEAN',
            required: false,
            freshnessClass: 'REAL_TIME',
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
          {
            key: 'price',
            label: 'Price',
            type: 'NUMBER',
            required: true,
            freshnessClass: 'CHANGING',
          },
          {
            key: 'durationMonths',
            label: 'Duration in months',
            type: 'NUMBER',
            required: true,
            freshnessClass: 'STABLE',
          },
          {
            key: 'includesCoach',
            label: 'Includes coach',
            type: 'BOOLEAN',
            required: false,
            freshnessClass: 'STABLE',
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

      const createdEntityType = await transaction.businessEntityType.upsert({
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
                freshnessClass: field.freshnessClass,
                options:
                  options === undefined
                    ? undefined
                    : ([...options] as Prisma.InputJsonValue),
                displayOrder,
              };
            }),
          },
        },
        include: {
          fieldDefinitions: {
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
        },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_ENTITY_TYPE',
        targetId: createdEntityType.id,
        action: 'SCHEMA_CHANGE',
        before: null,
        after: createdEntityType,
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
