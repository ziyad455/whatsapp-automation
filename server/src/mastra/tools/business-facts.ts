import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { publicFactMetadata, factMetadataSchema } from '../../ai/business-context';
import { customerServiceRequestContextSchema, requireCustomerServiceRun } from '../../ai/request-context';

export const businessFactsInputSchema = z.object({
  kind: z.enum(['entity_types', 'entities', 'opening_hours', 'rules']),
  entityType: z.string().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  fields: z.array(z.string().min(1).max(100)).max(8).optional(),
}).strict();

const valueSchema = z.union([
  z.string().max(2000), z.number().finite(), z.boolean(),
  z.array(z.string().max(200)).max(20), z.null(),
]);
export const businessFactsOutputSchema = z.object({
  status: z.enum(['FOUND', 'MISSING', 'UNAVAILABLE', 'INVALID_QUERY']),
  truncated: z.boolean(),
  entityTypes: z.array(z.object({ key: z.string(), name: z.string() })).max(20),
  facts: z.array(z.object({
    reference: z.string(), subject: z.string().max(200), field: z.string().max(100),
    value: valueSchema, metadata: factMetadataSchema,
  })).max(40),
});
export type BusinessFacts = z.infer<typeof businessFactsOutputSchema>;

const sensitiveField = /password|secret|token|credential|authorization|api.?key|private.?key|business.?id|membership.?id|user.?id/i;

export const readBusinessFacts = createTool({
  id: 'read-business-facts',
  description: 'Read current authorized business facts. Use entity_types to discover collection keys, then entities with a name search and optional field keys. Also reads opening_hours or active rules. Never accepts tenant IDs. Unverified values are withheld; MISSING is not proof of nonexistence.',
  inputSchema: businessFactsInputSchema,
  outputSchema: businessFactsOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (input, context): Promise<BusinessFacts> => {
    const run = requireCustomerServiceRun(context?.requestContext);
    const query = businessFactsInputSchema.parse(input);
    const output: BusinessFacts = { status: 'MISSING', truncated: false, entityTypes: [], facts: [] };
    if ((query.kind === 'entities' && !query.entityType) ||
      (query.kind !== 'entities' && (query.entityType || query.search || query.fields))) {
      run.recordLookup('INVALID_QUERY', query.kind);
      return { ...output, status: 'INVALID_QUERY' };
    }
    const provider = run.provider;
    let outputCharacters = 0;
    const add = (
      subject: string, field: string, value: unknown,
      metadata: Parameters<typeof publicFactMetadata>[0],
    ) => {
      if (sensitiveField.test(field)) return;
      if (output.facts.length >= 40) { output.truncated = true; return; }
      const safeValue = valueSchema.safeParse(value);
      const status = value === null || !safeValue.success ? 'UNKNOWN' : metadata.freshnessStatus;
      const fact = {
        reference: '', subject: subject.slice(0, 200), field: field.slice(0, 100),
        value: status === 'FRESH' && safeValue.success ? safeValue.data : null,
        metadata: { ...publicFactMetadata(metadata), freshnessStatus: status },
      };
      const characters = JSON.stringify(fact).length + 20;
      if (outputCharacters + characters > 16000) { output.truncated = true; return; }
      outputCharacters += characters;
      output.facts.push(fact);
    };
    try {
      if (query.kind === 'entity_types') {
        const types = await provider.listEntityTypes();
        output.entityTypes = types.slice(0, 20).map(type => ({ key: type.key.slice(0, 100), name: type.name.slice(0, 200) }));
        output.truncated = types.length > 20;
      } else if (query.kind === 'entities') {
        const page = await provider.searchEntities({ entityType: query.entityType!, search: query.search, limit: 5, offset: 0 });
        output.truncated = page.items.length >= 5;
        for (const entity of page.items.slice(0, 5)) {
          for (const field of entity.fields.filter(field => !query.fields?.length || query.fields.includes(field.key))) {
            add(entity.name, field.key, field.hasValue ? field.value : null, field.metadata);
          }
        }
      } else if (query.kind === 'opening_hours') {
        for (const hour of (await provider.getOpeningHours()).slice(0, 7)) {
          add(hour.dayOfWeek, 'normalHours', hour.isOpen ? `${hour.opensAt}–${hour.closesAt}` : 'closed', hour.metadata);
        }
      } else {
        const rules = await provider.getBusinessRules();
        output.truncated = rules.length > 40;
        for (const rule of rules.slice(0, 40)) add(rule.name, 'policy', rule.content, rule.metadata);
      }
    } catch {
      run.recordLookup('UNAVAILABLE', query.kind);
      return { status: 'UNAVAILABLE', truncated: false, facts: [], entityTypes: [] };
    }
    output.status = output.facts.length || output.entityTypes.length ? 'FOUND' : 'MISSING';
    const validated = businessFactsOutputSchema.parse(output);
    if (query.kind !== 'entity_types') {
      for (const fact of validated.facts) fact.reference = run.record(fact.metadata.freshnessStatus, query.kind);
    }
    run.recordLookup(validated.status, query.kind);
    return validated;
  },
});
