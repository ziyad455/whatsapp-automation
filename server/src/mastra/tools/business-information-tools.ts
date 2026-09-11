import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { CurrentBusinessEntity, CurrentBusinessEntityField, CurrentFactMetadata } from '../../business-data/business-data-provider';
import type { FreshnessStatus } from '../../business-data/freshness';
import { DynamicEntityQueryError } from '../../business-data/tenant-business-entity-query.service';
import { checkBusinessInformation, businessInformationCheckSchema } from '../../ai/business-information';
import { customerServiceRequestContextSchema, requireCustomerServiceRun, type CustomerServiceRun } from '../../ai/request-context';
import type { CustomerServiceToolName } from '../../ai/agent-diagnostics';

export const emptyBusinessInformationInputSchema = z.object({}).strict();
const entityTypeSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const fieldKeySchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const fieldSelectionSchema = z.array(fieldKeySchema).max(20).optional();
const modelFactMetadataSchema = z.object({
  source: z.enum(['MANUAL', 'IMPORT', 'API', 'SYNC', 'SYSTEM']),
  freshnessClass: z.enum(['STABLE', 'CHANGING', 'REAL_TIME']),
  freshnessStatus: z.enum(['FRESH', 'STALE', 'UNKNOWN']),
}).strict();
const modelValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(100)).max(10),
  z.null(),
]);
const modelEntityFieldSchema = z.object({
  key: fieldKeySchema,
  label: z.string().max(100),
  type: z.enum(['TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT']),
  value: modelValueSchema,
  metadata: modelFactMetadataSchema,
}).strict();
const modelEntitySchema = z.object({
  entityId: z.uuid(),
  entityType: entityTypeSchema,
  name: z.string().max(200),
  fields: z.array(modelEntityFieldSchema).max(20),
  fieldsTruncated: z.boolean(),
}).strict();
const sensitiveField = /password|secret|token|credential|authorization|api.?key|private.?key|business.?id|membership.?id|user.?id/i;

const metadataForModel = (metadata: CurrentFactMetadata) => modelFactMetadataSchema.parse({
  source: metadata.source,
  freshnessClass: metadata.freshnessClass,
  freshnessStatus: metadata.freshnessStatus,
});

const recordInformation = (
  run: CustomerServiceRun,
  tool: CustomerServiceToolName,
  kind: 'profile' | 'opening_hours' | 'rules' | 'entity_types' | 'entities',
  status: 'FOUND' | 'MISSING' | 'UNAVAILABLE' | 'INVALID_QUERY',
  metadata: readonly { freshnessStatus: FreshnessStatus }[] = [],
) => {
  run.recordLookup(status, kind);
  for (const item of metadata) run.record(item.freshnessStatus, kind);
  const information = checkBusinessInformation(status, metadata.map(item => item.freshnessStatus));
  run.recordToolCall(tool, status, status === 'FOUND' ? information.freshnessStatus : null);
  return information;
};

const unavailableInformation = (
  run: CustomerServiceRun,
  tool: CustomerServiceToolName,
  kind: 'profile' | 'opening_hours' | 'rules' | 'entity_types' | 'entities',
) => recordInformation(run, tool, kind, 'UNAVAILABLE');

const projectField = (field: CurrentBusinessEntityField) => {
  const value = modelValueSchema.safeParse(field.value);
  const freshnessStatus = field.hasValue && field.value !== null && value.success
    ? field.metadata.freshnessStatus
    : 'UNKNOWN';
  const metadata = metadataForModel({ ...field.metadata, freshnessStatus });
  return modelEntityFieldSchema.parse({
    key: field.key,
    label: field.label.slice(0, 100),
    type: field.type,
    value: freshnessStatus === 'FRESH' && value.success ? value.data : null,
    metadata,
  });
};

const projectEntity = (
  entity: CurrentBusinessEntity,
  selectedFields: readonly string[] | undefined,
  maximumFields: number,
) => {
  const selected = entity.fields.filter(field =>
    !selectedFields?.length || selectedFields.includes(field.key));
  const matchingFields = selected.filter(field => !sensitiveField.test(field.key));
  const fields = matchingFields.slice(0, maximumFields).map(projectField);
  return modelEntitySchema.parse({
    entityId: entity.id,
    entityType: entity.entityTypeKey,
    name: entity.name.slice(0, 200),
    fields,
    fieldsTruncated: selected.length > fields.length,
  });
};

export const businessProfileOutputSchema = z.object({
  information: businessInformationCheckSchema,
  profile: z.object({
    name: z.string().max(200),
    category: z.string().max(100),
    description: z.string().max(1000).nullable(),
    phone: z.string().max(100).nullable(),
    address: z.string().max(300).nullable(),
    timezone: z.string().max(100),
    currency: z.string().max(10),
    defaultLanguage: z.string().max(50),
    supportedLanguages: z.array(z.string().max(50)).max(20),
    metadata: modelFactMetadataSchema,
  }).strict().nullable(),
}).strict();

export const getBusinessProfile = createTool({
  id: 'get-business-profile',
  description: 'Get the current authorized business public profile. Takes no tenant or business identifier.',
  strict: true,
  inputSchema: emptyBusinessInformationInputSchema,
  outputSchema: businessProfileOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (_input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    try {
      const profile = await run.provider.getBusinessProfile();
      if (!profile) {
        return businessProfileOutputSchema.parse({
          information: recordInformation(run, 'getBusinessProfile', 'profile', 'MISSING'),
          profile: null,
        });
      }
      run.assertBusinessId(profile.id);
      const current = profile.metadata.freshnessStatus === 'FRESH';
      return businessProfileOutputSchema.parse({
        information: recordInformation(run, 'getBusinessProfile', 'profile', 'FOUND', [profile.metadata]),
        profile: {
          name: profile.name.slice(0, 200),
          category: profile.category.slice(0, 100),
          description: current ? profile.description?.slice(0, 1000) ?? null : null,
          phone: current ? profile.phone?.slice(0, 100) ?? null : null,
          address: current ? profile.address?.slice(0, 300) ?? null : null,
          timezone: profile.timezone.slice(0, 100),
          currency: profile.currency.slice(0, 10),
          defaultLanguage: profile.defaultLanguage.slice(0, 50),
          supportedLanguages: profile.supportedLanguages.slice(0, 20).map(language => language.slice(0, 50)),
          metadata: metadataForModel(profile.metadata),
        },
      });
    } catch {
      return businessProfileOutputSchema.parse({
        information: unavailableInformation(run, 'getBusinessProfile', 'profile'),
        profile: null,
      });
    }
  },
});

export const openingHoursOutputSchema = z.object({
  information: businessInformationCheckSchema,
  hours: z.array(z.object({
    dayOfWeek: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
    isOpen: z.boolean().nullable(),
    opensAt: z.string().max(5).nullable(),
    closesAt: z.string().max(5).nullable(),
    metadata: modelFactMetadataSchema,
  }).strict()).max(7),
}).strict();

export const getOpeningHours = createTool({
  id: 'get-opening-hours',
  description: 'Get the current authorized business regular weekly opening hours. Takes no tenant identifier.',
  strict: true,
  inputSchema: emptyBusinessInformationInputSchema,
  outputSchema: openingHoursOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (_input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    try {
      const hours = (await run.provider.getOpeningHours()).slice(0, 7);
      const information = recordInformation(run, 'getOpeningHours', 'opening_hours', hours.length ? 'FOUND' : 'MISSING', hours.map(hour => hour.metadata));
      return openingHoursOutputSchema.parse({
        information,
        hours: hours.map(hour => {
          const current = hour.metadata.freshnessStatus === 'FRESH';
          return {
            dayOfWeek: hour.dayOfWeek,
            isOpen: current ? hour.isOpen : null,
            opensAt: current ? hour.opensAt : null,
            closesAt: current ? hour.closesAt : null,
            metadata: metadataForModel(hour.metadata),
          };
        }),
      });
    } catch {
      return openingHoursOutputSchema.parse({
        information: unavailableInformation(run, 'getOpeningHours', 'opening_hours'),
        hours: [],
      });
    }
  },
});

export const businessRulesOutputSchema = z.object({
  information: businessInformationCheckSchema,
  truncated: z.boolean(),
  rules: z.array(z.object({
    category: z.string().max(100),
    name: z.string().max(200),
    content: z.string().max(1500).nullable(),
    metadata: modelFactMetadataSchema,
  }).strict()).max(20),
}).strict();

export const getBusinessRules = createTool({
  id: 'get-business-rules',
  description: 'Get current active customer-service rules for the authorized business. Disabled rules are excluded before output.',
  strict: true,
  inputSchema: emptyBusinessInformationInputSchema,
  outputSchema: businessRulesOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (_input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    try {
      const source = await run.provider.getBusinessRules();
      const rules: z.infer<typeof businessRulesOutputSchema>['rules'] = [];
      let characters = 0;
      for (const rule of source.slice(0, 20)) {
        const current = rule.metadata.freshnessStatus === 'FRESH';
        const projected = {
          category: rule.category.slice(0, 100),
          name: rule.name.slice(0, 200),
          content: current ? rule.content.slice(0, 1500) : null,
          metadata: metadataForModel(rule.metadata),
        };
        const size = JSON.stringify(projected).length;
        if (characters + size > 12000) break;
        characters += size;
        rules.push(projected);
      }
      return businessRulesOutputSchema.parse({
        information: recordInformation(run, 'getBusinessRules', 'rules', source.length ? 'FOUND' : 'MISSING', source.slice(0, rules.length).map(rule => rule.metadata)),
        truncated: source.length > rules.length,
        rules,
      });
    } catch {
      return businessRulesOutputSchema.parse({
        information: unavailableInformation(run, 'getBusinessRules', 'rules'),
        truncated: false,
        rules: [],
      });
    }
  },
});

export const entityTypesOutputSchema = z.object({
  information: businessInformationCheckSchema,
  truncated: z.boolean(),
  entityTypes: z.array(z.object({
    key: entityTypeSchema,
    name: z.string().max(200),
    description: z.string().max(300).nullable(),
    fields: z.array(z.object({
      key: fieldKeySchema,
      label: z.string().max(100),
      type: z.enum(['TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT']),
    }).strict()).max(20),
    fieldsTruncated: z.boolean(),
  }).strict()).max(20),
}).strict();

export const listEntityTypes = createTool({
  id: 'list-entity-types',
  description: 'List dynamic business-data categories and enabled public field keys available to the authorized business. Use this to discover tenant-specific facts before querying them. Takes no tenant identifier.',
  strict: true,
  inputSchema: emptyBusinessInformationInputSchema,
  outputSchema: entityTypesOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (_input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    try {
      const source = await run.provider.listEntityTypes();
      const entityTypes = source.slice(0, 20).map(type => {
        const fields = type.fields
          .filter(field => !sensitiveField.test(`${field.key} ${field.label}`))
          .slice(0, 20)
          .map(field => ({
            key: field.key,
            label: field.label.slice(0, 100),
            type: field.type,
          }));
        return {
          key: type.key,
          name: type.name.slice(0, 200),
          description: type.description?.slice(0, 300) ?? null,
          fields,
          fieldsTruncated: type.fields.length > fields.length,
        };
      });
      run.recordEntityTypes(entityTypes);
      return entityTypesOutputSchema.parse({
        information: recordInformation(run, 'listEntityTypes', 'entity_types', source.length ? 'FOUND' : 'MISSING'),
        truncated: source.length > entityTypes.length,
        entityTypes,
      });
    } catch {
      return entityTypesOutputSchema.parse({
        information: unavailableInformation(run, 'listEntityTypes', 'entity_types'),
        truncated: false,
        entityTypes: [],
      });
    }
  },
});

const filterValueSchema = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const searchFilterSchema = z.object({ field: fieldKeySchema, value: filterValueSchema }).strict();
export const searchBusinessEntitiesInputSchema = z.object({
  entityType: entityTypeSchema,
  text: z.string().trim().max(200).optional(),
  filters: z.array(searchFilterSchema).max(4).optional(),
  fields: z.array(fieldKeySchema).max(8).optional(),
  limit: z.number().int().min(1).max(5).default(5),
  offset: z.number().int().min(0).max(1000).default(0),
}).strict().superRefine((input, context) => {
  const keys = new Set<string>();
  for (const filter of input.filters ?? []) {
    if (keys.has(filter.field)) {
      context.addIssue({ code: 'custom', path: ['filters'], message: 'Filter fields must be unique.' });
    }
    keys.add(filter.field);
  }
});

export const businessEntitySearchOutputSchema = z.object({
  information: businessInformationCheckSchema,
  truncated: z.boolean(),
  limit: z.number().int().min(1).max(5),
  offset: z.number().int().min(0).max(1000),
  issues: z.array(z.object({
    field: z.string().max(100).nullable(),
    code: z.string().max(80),
  }).strict()).max(8),
  entities: z.array(modelEntitySchema).max(5),
}).strict();

export const searchBusinessEntities = createTool({
  id: 'search-business-entities',
  description: 'Search active entities for the authorized business by type, text, and allow-listed schema fields. Tenant and status cannot be selected.',
  strict: true,
  inputSchema: searchBusinessEntitiesInputSchema,
  outputSchema: businessEntitySearchOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    const filters = Object.create(null) as Record<string, string | number | boolean>;
    for (const filter of input.filters ?? []) filters[filter.field] = filter.value;
    try {
      const page = await run.provider.searchEntities({
        entityType: input.entityType,
        search: input.text,
        filters,
        limit: input.limit,
        offset: input.offset,
      });
      const entities: z.infer<typeof businessEntitySearchOutputSchema>['entities'] = [];
      let characters = 0;
      for (const entity of page.items.slice(0, input.limit)) {
        const projected = projectEntity(entity, input.fields, 8);
        const size = JSON.stringify(projected).length;
        if (characters + size > 16000) break;
        characters += size;
        entities.push(projected);
      }
      const metadata = entities.flatMap(entity => entity.fields.map(field => field.metadata));
      if (page.items.length > 0) {
        run.recordEntityTypes([{ key: input.entityType, fields: [] }]);
      }
      return businessEntitySearchOutputSchema.parse({
        information: recordInformation(run, 'searchBusinessEntities', 'entities', page.items.length ? 'FOUND' : 'MISSING', metadata),
        truncated: page.items.length >= input.limit || page.items.length > entities.length || entities.some(entity => entity.fieldsTruncated),
        limit: input.limit,
        offset: input.offset,
        issues: [],
        entities,
      });
    } catch (error) {
      if (error instanceof DynamicEntityQueryError) {
        return businessEntitySearchOutputSchema.parse({
          information: recordInformation(run, 'searchBusinessEntities', 'entities', 'INVALID_QUERY'),
          truncated: false,
          limit: input.limit,
          offset: input.offset,
          issues: error.errors.slice(0, 8).map(issue => ({ field: issue.field, code: issue.code })),
          entities: [],
        });
      }
      return businessEntitySearchOutputSchema.parse({
        information: unavailableInformation(run, 'searchBusinessEntities', 'entities'),
        truncated: false,
        limit: input.limit,
        offset: input.offset,
        issues: [],
        entities: [],
      });
    }
  },
});

export const getBusinessEntityInputSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.uuid(),
  fields: fieldSelectionSchema,
}).strict();

export const businessEntityOutputSchema = z.object({
  information: businessInformationCheckSchema,
  entity: modelEntitySchema.nullable(),
}).strict();

export const getBusinessEntity = createTool({
  id: 'get-business-entity',
  description: 'Get one active entity by an ID returned from search for the authorized business. A foreign ID is indistinguishable from missing.',
  strict: true,
  inputSchema: getBusinessEntityInputSchema,
  outputSchema: businessEntityOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    try {
      const entity = await run.provider.getEntity(input.entityType, input.entityId);
      if (!entity) {
        return businessEntityOutputSchema.parse({
          information: recordInformation(run, 'getBusinessEntity', 'entities', 'MISSING'),
          entity: null,
        });
      }
      const projected = projectEntity(entity, input.fields, 20);
      return businessEntityOutputSchema.parse({
        information: recordInformation(run, 'getBusinessEntity', 'entities', 'FOUND', projected.fields.map(field => field.metadata)),
        entity: projected,
      });
    } catch {
      return businessEntityOutputSchema.parse({
        information: unavailableInformation(run, 'getBusinessEntity', 'entities'),
        entity: null,
      });
    }
  },
});

export const customerServiceBusinessTools = {
  getBusinessProfile,
  getOpeningHours,
  getBusinessRules,
  listEntityTypes,
  searchBusinessEntities,
  getBusinessEntity,
} as const;
