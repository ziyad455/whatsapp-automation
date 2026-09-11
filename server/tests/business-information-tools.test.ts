import { randomUUID } from 'node:crypto';
import { noopObserve } from '@mastra/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { runCustomerServiceAgent, type CustomerServiceAgentExecution } from '../src/ai/customer-service-agent';
import {
  businessEntityOutputSchema,
  businessEntitySearchOutputSchema,
  businessProfileOutputSchema,
  businessRulesOutputSchema,
  emptyBusinessInformationInputSchema,
  entityTypesOutputSchema,
  getBusinessEntity,
  getBusinessEntityInputSchema,
  getBusinessProfile,
  getBusinessRules,
  getOpeningHours,
  listEntityTypes,
  openingHoursOutputSchema,
  searchBusinessEntities,
  searchBusinessEntitiesInputSchema,
} from '../src/mastra/tools/business-information-tools';
import { fakeMetadata, fakeProvider, fakeTenant } from './helpers/ai-fixtures';
import type { BusinessDataProvider, CurrentBusinessEntity } from '../src/business-data/business-data-provider';
import type { TenantContext } from '../src/tenancy/tenant-context';

const toolContext = (execution: CustomerServiceAgentExecution) => ({
  requestContext: execution.requestContext,
  observe: noopObserve,
});

const insideRun = async <T>(
  tenant: TenantContext,
  provider: BusinessDataProvider,
  callback: (execution: CustomerServiceAgentExecution) => Promise<T>,
): Promise<T> => {
  let output: T | undefined;
  await runCustomerServiceAgent({ tenant, message: 'Show current business information.' }, {
    createProvider: () => provider,
    executor: async execution => {
      output = await callback(execution);
      return 'Here is the current information.';
    },
  });
  if (output === undefined) throw new Error('Expected tool output.');
  return output;
};

const entity = (entityTypeKey = 'vehicle'): CurrentBusinessEntity => ({
  id: randomUUID(),
  entityTypeId: randomUUID(),
  entityTypeKey,
  name: 'Clio',
  status: 'ACTIVE',
  source: 'MANUAL',
  externalId: 'private-external',
  lastVerifiedAt: new Date('2026-09-01T12:00:00Z'),
  updatedAt: new Date('2026-09-01T12:00:00Z'),
  fields: [
    {
      definitionId: randomUUID(), key: 'pricePerDay', label: 'Daily price', type: 'NUMBER',
      value: 500, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'CHANGING' }),
    },
    {
      definitionId: randomUUID(), key: 'apiKey', label: 'API key', type: 'TEXT',
      value: 'private-secret', hasValue: true, metadata: fakeMetadata(),
    },
  ],
});

describe('Sprint 7 business information tools', () => {
  it('exposes strict model inputs with no tenant or unrestricted query selectors', () => {
    for (const value of [
      { businessId: randomUUID() },
      { tenantId: randomUUID() },
      { membershipId: randomUUID() },
      { userId: randomUUID() },
    ]) {
      expect(emptyBusinessInformationInputSchema.safeParse(value).success).toBe(false);
      expect(searchBusinessEntitiesInputSchema.safeParse({ entityType: 'vehicle', ...value }).success).toBe(false);
      expect(getBusinessEntityInputSchema.safeParse({ entityType: 'vehicle', entityId: randomUUID(), ...value }).success).toBe(false);
    }
    expect(searchBusinessEntitiesInputSchema.safeParse({ entityType: 'vehicle', status: 'ARCHIVED' }).success).toBe(false);
    expect(searchBusinessEntitiesInputSchema.safeParse({ entityType: 'vehicle', where: { businessId: randomUUID() } }).success).toBe(false);
    expect(searchBusinessEntitiesInputSchema.safeParse({ entityType: 'vehicle', limit: 6 }).success).toBe(false);
    expect(searchBusinessEntitiesInputSchema.safeParse({
      entityType: 'vehicle', filters: [{ field: 'brand', value: 'Renault' }, { field: 'brand', value: 'Dacia' }],
    }).success).toBe(false);
  });

  it('returns concise validated profile, hours, active-rule-provider, and entity-type projections', async () => {
    const tenant = fakeTenant();
    const provider = fakeProvider(tenant);
    provider.getBusinessRules = async () => Array.from({ length: 25 }, (_, index) => ({
      id: randomUUID(), category: 'POLICY', name: `Rule ${index}`, content: 'x'.repeat(900), metadata: fakeMetadata(),
    }));
    provider.listEntityTypes = async () => Array.from({ length: 25 }, (_, index) => ({
      id: randomUUID(), key: `type-${index}`, name: `Type ${index}`, description: 'Useful public description', schemaVersion: 1, fieldCount: 2,
      fields: [
        { key: 'weeklyRate', label: 'Weekly rate', type: 'NUMBER' as const },
        { key: 'apiKey', label: 'Private API key', type: 'TEXT' as const },
      ],
    }));

    const outputs = await insideRun(tenant, provider, async execution => ({
      profile: businessProfileOutputSchema.parse(await getBusinessProfile.execute!({}, toolContext(execution))),
      hours: openingHoursOutputSchema.parse(await getOpeningHours.execute!({}, toolContext(execution))),
      rules: businessRulesOutputSchema.parse(await getBusinessRules.execute!({}, toolContext(execution))),
      types: entityTypesOutputSchema.parse(await listEntityTypes.execute!({}, toolContext(execution))),
    }));

    expect(outputs.profile.profile).toMatchObject({ name: 'Atlas Cars', currency: 'MAD' });
    expect(outputs.hours.hours).toHaveLength(1);
    expect(outputs.rules.truncated).toBe(true);
    expect(outputs.rules.rules.length).toBeLessThanOrEqual(20);
    expect(outputs.types).toMatchObject({ truncated: true });
    expect(outputs.types.entityTypes).toHaveLength(20);
    expect(outputs.types.entityTypes[0]).toMatchObject({
      fields: [{ key: 'weeklyRate', label: 'Weekly rate', type: 'NUMBER' }],
    });
    expect(JSON.stringify(outputs)).not.toMatch(/businessId|membershipId|userId|externalId|lastVerifiedAt|schemaVersion|fieldCount|private-provider-id/);
  });

  it('uses safe filters, caps entity search, strips sensitive fields, and supports exact lookup', async () => {
    const tenant = fakeTenant();
    const provider = fakeProvider(tenant);
    const entities = Array.from({ length: 7 }, () => entity());
    const search = vi.fn(async () => ({ items: entities, limit: 5, offset: 0 }));
    provider.searchEntities = search;
    provider.getEntity = async (_entityType, entityId) => entities.find(item => item.id === entityId) ?? null;

    const outputs = await insideRun(tenant, provider, async execution => ({
      search: businessEntitySearchOutputSchema.parse(await searchBusinessEntities.execute!({
        entityType: 'vehicle', text: 'Clio', filters: [{ field: 'brand', value: 'Renault' }],
        fields: ['pricePerDay', 'apiKey'], limit: 5, offset: 0,
      }, toolContext(execution))),
      exact: businessEntityOutputSchema.parse(await getBusinessEntity.execute!({
        entityType: 'vehicle', entityId: entities[0]!.id, fields: ['pricePerDay', 'apiKey'],
      }, toolContext(execution))),
    }));

    expect(search).toHaveBeenCalledWith({
      entityType: 'vehicle', search: 'Clio', filters: { brand: 'Renault' }, limit: 5, offset: 0,
    });
    expect(outputs.search).toMatchObject({ truncated: true, limit: 5, offset: 0 });
    expect(outputs.search.entities).toHaveLength(5);
    expect(outputs.search.entities[0]?.fields.map(field => field.key)).toEqual(['pricePerDay']);
    expect(outputs.exact.entity?.entityId).toBe(entities[0]!.id);
    expect(outputs.exact.entity?.fields.map(field => field.key)).toEqual(['pricePerDay']);
    expect(JSON.stringify(outputs)).not.toMatch(/private-secret|private-external|definitionId|entityTypeId|apiKey/);
  });
});
