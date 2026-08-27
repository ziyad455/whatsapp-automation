import type { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import {
  DynamicEntityQueryError,
  createTenantBusinessEntityQueryService,
} from '../business-data/tenant-business-entity-query.service';
import { createTenantBusinessCatalogService } from '../business-data/tenant-business-catalog.service';
import {
  DynamicEntityValidationError,
} from '../business-data/dynamic-entity-validation';
import { createTenantBusinessEntityService } from '../business-data/tenant-business-entity.service';
import {
  BusinessSchemaChangeError,
  createTenantBusinessSchemaService,
} from '../business-data/tenant-business-schema.service';
import { createTenantBusinessProfileService } from '../business-configuration/tenant-business-profile.service';
import { createTenantBusinessRuleService } from '../business-configuration/tenant-business-rule.service';
import { createTenantBusinessUnderstandingService } from '../business-configuration/tenant-business-understanding.service';
import {
  OpeningHoursValidationError,
  createTenantOpeningHoursService,
} from '../business-configuration/tenant-opening-hours.service';
import { Prisma } from '../generated/prisma/client';
import { listUserBusinesses } from '../memberships/business-user.repository';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import type { TenantContext } from '../tenancy/tenant-context';
import { ApplicationError } from './errors';
import { requireAuthenticatedUser, requireTenantContext } from './request-context';

const entityTypeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers, and underscores.');
const identifierSchema = z.uuid();
const nonEmptyText = z.string().trim().min(1).max(2_000);
const fieldTypeSchema = z.enum([
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTI_SELECT',
]);
const optionSchema = z.union([
  z.string().trim().min(1),
  z.object({ value: z.string().trim().min(1), label: z.string().trim().min(1) }),
]);

const businessProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    currency: z.string().trim().length(3),
    defaultLanguage: z.string().trim().min(2).max(20),
    supportedLanguages: z.array(z.string().trim().min(2).max(20)).max(12),
    timezone: z.string().trim().min(1).max(120),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      !profile.supportedLanguages
        .map(language => language.toLowerCase())
        .includes(profile.defaultLanguage.toLowerCase())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supportedLanguages'],
        message: 'Supported languages must include the default language.',
      });
    }
  });

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const openingHourSchema = z
  .object({
    dayOfWeek: z.enum([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ]),
    isOpen: z.boolean(),
    opensAt: timeSchema.nullable(),
    closesAt: timeSchema.nullable(),
  })
  .strict();
const openingHoursSchema = z.object({ hours: z.array(openingHourSchema) }).strict();

const createRuleSchema = z
  .object({
    category: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(160),
    content: nonEmptyText,
    active: z.boolean().optional(),
  })
  .strict();
const updateRuleSchema = createRuleSchema.partial().refine(value => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});

const createEntityTypeSchema = z
  .object({
    key: entityTypeKeySchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const fieldOptionsSchema = z.array(optionSchema).nullable();
const createFieldSchema = z
  .object({
    key: entityTypeKeySchema,
    label: z.string().trim().min(1).max(160),
    type: fieldTypeSchema,
    required: z.boolean().optional(),
    enabled: z.boolean().optional(),
    options: fieldOptionsSchema.optional(),
    displayOrder: z.number().int().min(0).max(1_000),
  })
  .strict();
const updateFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(160).optional(),
    type: fieldTypeSchema.optional(),
    required: z.boolean().optional(),
    enabled: z.boolean().optional(),
    options: fieldOptionsSchema.optional(),
    displayOrder: z.number().int().min(0).max(1_000).optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

const entityDataSchema = z.record(z.string(), z.unknown());
const saveEntitySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    data: entityDataSchema,
  })
  .strict();

const badRequest = (message: string, details?: unknown): ApplicationError =>
  new ApplicationError({ code: 'BAD_REQUEST', message, status: 400, details });

const notFound = (message: string): ApplicationError =>
  new ApplicationError({ code: 'NOT_FOUND', message, status: 404 });

const parseBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must contain valid JSON.');
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw badRequest('Request validation failed.', {
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || null,
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  return parsed.data;
};

const parseIdentifier = (value: string, label: string): string => {
  const parsed = identifierSchema.safeParse(value);

  if (!parsed.success) {
    throw badRequest(`${label} must be a valid identifier.`);
  }

  return parsed.data;
};

const resolveTenant = async (
  requestContext: RequestContext,
  selectedBusinessId?: string,
): Promise<TenantContext> => {
  await resolveDashboardTenantContext(requestContext, selectedBusinessId);
  return requireTenantContext(requestContext);
};

const toApplicationError = (error: unknown): Error => {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof DynamicEntityValidationError) {
    return badRequest('Entity data does not match the current schema.', {
      fields: error.errors,
    });
  }

  if (error instanceof DynamicEntityQueryError) {
    return badRequest('Entity query validation failed.', { fields: error.errors });
  }

  if (error instanceof BusinessSchemaChangeError) {
    return badRequest(error.message, {
      fields: [{ field: error.field, code: error.code, message: error.message }],
    });
  }

  if (error instanceof OpeningHoursValidationError) {
    return badRequest(error.message, {
      fields: [
        {
          field: error.dayOfWeek ? `hours.${error.dayOfWeek}` : 'hours',
          code: 'INVALID_OPENING_HOURS',
          message: error.message,
        },
      ],
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return badRequest('A record with that key already exists.');
  }

  return error instanceof Error ? error : new Error('Unknown application error.');
};

const withDomainErrors = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw toApplicationError(error);
  }
};

export const sprintFourRoutes = [
  registerApiRoute('/businesses', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const user = requireAuthenticatedUser(context.get('requestContext'));
      const memberships = await listUserBusinesses(user.id);

      return context.json({
        businesses: memberships.map(membership => ({
          id: membership.business.id,
          name: membership.business.name,
          category: membership.business.category,
          role: membership.role,
        })),
      });
    },
  }),
  registerApiRoute('/dashboard/business-profile', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const profile = await createTenantBusinessProfileService(tenant).get();

      if (!profile) {
        throw notFound('Business profile was not found.');
      }

      return context.json({ profile });
    },
  }),
  registerApiRoute('/dashboard/business-profile', {
    method: 'PATCH',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const input = await parseBody(context.req.raw, businessProfileSchema);
      const profile = await createTenantBusinessProfileService(tenant).update(input);
      return context.json({ profile });
    },
  }),
  registerApiRoute('/dashboard/opening-hours', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const hours = await createTenantOpeningHoursService(tenant).getWeek();
      return context.json({ hours });
    },
  }),
  registerApiRoute('/dashboard/opening-hours', {
    method: 'PUT',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const input = await parseBody(context.req.raw, openingHoursSchema);
        const hours = await createTenantOpeningHoursService(tenant).replaceWeek(
          input.hours,
        );
        return context.json({ hours });
      }),
  }),
  registerApiRoute('/dashboard/business-rules', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const rules = await createTenantBusinessRuleService(tenant).list();
      return context.json({ rules });
    },
  }),
  registerApiRoute('/dashboard/business-rules', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const input = await parseBody(context.req.raw, createRuleSchema);
      const rule = await createTenantBusinessRuleService(tenant).create(input);
      return context.json({ rule }, 201);
    },
  }),
  registerApiRoute('/dashboard/business-rules/:ruleId', {
    method: 'PATCH',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const ruleId = parseIdentifier(context.req.param('ruleId'), 'Rule ID');
      const input = await parseBody(context.req.raw, updateRuleSchema);
      const rule = await createTenantBusinessRuleService(tenant).update(ruleId, input);

      if (!rule) {
        throw notFound('Business rule was not found.');
      }

      return context.json({ rule });
    },
  }),
  registerApiRoute('/dashboard/entity-types', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const entityTypes = await createTenantBusinessCatalogService(tenant).list();
      return context.json({ entityTypes });
    },
  }),
  registerApiRoute('/dashboard/entity-types', {
    method: 'POST',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const input = await parseBody(context.req.raw, createEntityTypeSchema);
        const entityType = await createTenantBusinessCatalogService(tenant).create(input);
        return context.json({ entityType }, 201);
      }),
  }),
  registerApiRoute('/dashboard/entity-types/:entityTypeKey', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const entityType = await createTenantBusinessCatalogService(tenant).getByKey(
        context.req.param('entityTypeKey'),
      );

      if (!entityType) {
        throw notFound('Entity type was not found.');
      }

      return context.json({ entityType });
    },
  }),
  registerApiRoute('/dashboard/entity-types/:entityTypeKey/fields', {
    method: 'POST',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const catalog = createTenantBusinessCatalogService(tenant);
        const entityType = await catalog.getByKey(context.req.param('entityTypeKey'));

        if (!entityType) {
          throw notFound('Entity type was not found.');
        }

        const input = await parseBody(context.req.raw, createFieldSchema);
        const field = await createTenantBusinessSchemaService(tenant).addFieldDefinition({
          ...input,
          entityTypeId: entityType.id,
        });

        if (!field) {
          throw notFound('Entity type was not found.');
        }

        return context.json({ field }, 201);
      }),
  }),
  registerApiRoute('/dashboard/entity-types/:entityTypeKey/fields/:fieldId', {
    method: 'PATCH',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const catalog = createTenantBusinessCatalogService(tenant);
        const entityType = await catalog.getByKey(context.req.param('entityTypeKey'));
        const fieldId = parseIdentifier(context.req.param('fieldId'), 'Field ID');

        if (!entityType?.fieldDefinitions.some(field => field.id === fieldId)) {
          throw notFound('Field definition was not found.');
        }

        const input = await parseBody(context.req.raw, updateFieldSchema);
        const field = await createTenantBusinessSchemaService(tenant).updateFieldDefinition(
          fieldId,
          input,
        );

        if (!field) {
          throw notFound('Field definition was not found.');
        }

        return context.json({ field });
      }),
  }),
  registerApiRoute('/dashboard/entities/:entityTypeKey', {
    method: 'GET',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const status = context.req.query('status') ?? 'ACTIVE';
        const limit = context.req.query('limit');
        const offset = context.req.query('offset');
        const page = await createTenantBusinessEntityQueryService(tenant).search({
          entityType: context.req.param('entityTypeKey'),
          search: context.req.query('search'),
          status: status as 'ACTIVE' | 'ARCHIVED',
          ...(limit === undefined ? {} : { limit: Number(limit) }),
          ...(offset === undefined ? {} : { offset: Number(offset) }),
        });
        return context.json(page);
      }),
  }),
  registerApiRoute('/dashboard/entities/:entityTypeKey', {
    method: 'POST',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const input = await parseBody(context.req.raw, saveEntitySchema);
        const entity = await createTenantBusinessEntityService(tenant).createForType(
          context.req.param('entityTypeKey'),
          input,
        );

        if (!entity) {
          throw notFound('Entity type was not found.');
        }

        return context.json({ entity }, 201);
      }),
  }),
  registerApiRoute('/dashboard/entities/:entityTypeKey/:entityId', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const entityId = parseIdentifier(context.req.param('entityId'), 'Entity ID');
      const entity = await createTenantBusinessEntityService(tenant).getByType(
        context.req.param('entityTypeKey'),
        entityId,
      );

      if (!entity) {
        throw notFound('Entity was not found.');
      }

      return context.json({ entity });
    },
  }),
  registerApiRoute('/dashboard/entities/:entityTypeKey/:entityId', {
    method: 'PATCH',
    requiresAuth: true,
    handler: async context =>
      withDomainErrors(async () => {
        const tenant = await resolveTenant(
          context.get('requestContext'),
          context.req.header(BUSINESS_SELECTOR_HEADER),
        );
        const entityId = parseIdentifier(context.req.param('entityId'), 'Entity ID');
        const input = await parseBody(context.req.raw, saveEntitySchema);
        const entity = await createTenantBusinessEntityService(tenant).update(
          context.req.param('entityTypeKey'),
          entityId,
          input,
        );

        if (!entity) {
          throw notFound('Entity was not found.');
        }

        return context.json({ entity });
      }),
  }),
  registerApiRoute('/dashboard/entities/:entityTypeKey/:entityId/archive', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const entityId = parseIdentifier(context.req.param('entityId'), 'Entity ID');
      const entity = await createTenantBusinessEntityService(tenant).archive(
        context.req.param('entityTypeKey'),
        entityId,
      );

      if (!entity) {
        throw notFound('Entity was not found.');
      }

      return context.json({ entity });
    },
  }),
  registerApiRoute('/dashboard/business-understanding', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const preview = await createTenantBusinessUnderstandingService(tenant).getPreview();
      return context.json({ preview });
    },
  }),
];
