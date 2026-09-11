import { randomUUID } from 'node:crypto';
import { noopObserve } from '@mastra/core/tools';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveCustomerServiceCapabilities,
  type PendingCustomerAction,
} from '../src/ai/customer-capabilities';
import {
  runCustomerServiceAgentWithDiagnostics,
  type CustomerServiceAgentExecution,
} from '../src/ai/customer-service-agent';
import type { CustomerServiceToolName } from '../src/ai/agent-diagnostics';
import {
  businessEntitySearchOutputSchema,
  entityTypesOutputSchema,
  listEntityTypes,
  searchBusinessEntities,
} from '../src/mastra/tools/business-information-tools';
import {
  offerCustomerServiceActions,
  offerCustomerServiceActionsOutputSchema,
} from '../src/mastra/tools/customer-service-control-tools';
import { fakeMetadata, fakeProvider, fakeTenant } from './helpers/ai-fixtures';

const availableVehiclesAction: PendingCustomerAction = {
  type: 'LIST_AVAILABLE_ENTITIES',
  entityType: 'vehicle',
};
const weeklyRateAction: PendingCustomerAction = {
  type: 'CHECK_ENTITY_FIELD',
  entityType: 'vehicle',
  field: 'weeklyRate',
  label: 'Weekly rate',
};

const providerWithVehicles = (tenant: ReturnType<typeof fakeTenant>) => {
  const provider = fakeProvider(tenant, 'Atlas Cars');
  provider.searchEntities = async () => ({
    items: [
      {
        id: randomUUID(), entityTypeId: randomUUID(), entityTypeKey: 'vehicle', name: 'Renault Clio',
        status: 'ACTIVE', source: 'MANUAL', externalId: null, lastVerifiedAt: new Date(), updatedAt: new Date(),
        fields: [
          { definitionId: randomUUID(), key: 'price', label: 'Daily price', type: 'NUMBER', value: 300, hasValue: true, metadata: fakeMetadata() },
          { definitionId: randomUUID(), key: 'weeklyRate', label: 'Weekly rate', type: 'NUMBER', value: 1500, hasValue: true, metadata: fakeMetadata() },
          { definitionId: randomUUID(), key: 'available', label: 'Available', type: 'BOOLEAN', value: true, hasValue: true, metadata: fakeMetadata() },
        ],
      },
      {
        id: randomUUID(), entityTypeId: randomUUID(), entityTypeKey: 'vehicle', name: 'Dacia Logan',
        status: 'ACTIVE', source: 'MANUAL', externalId: null, lastVerifiedAt: new Date(), updatedAt: new Date(),
        fields: [
          { definitionId: randomUUID(), key: 'available', label: 'Available', type: 'BOOLEAN', value: true, hasValue: true, metadata: fakeMetadata() },
        ],
      },
    ],
    limit: 5,
    offset: 0,
  });
  return provider;
};

const searchVehicles = async (execution: CustomerServiceAgentExecution) =>
  businessEntitySearchOutputSchema.parse(await searchBusinessEntities.execute!(
    { entityType: 'vehicle', fields: ['price', 'available'], limit: 5, offset: 0 },
    { requestContext: execution.requestContext, observe: noopObserve },
  ));

describe('customer-service capability boundary', () => {
  it('removes unsupported offers and system narration from an otherwise valid price reply', async () => {
    const tenant = fakeTenant();
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'How much is the Clio?' }, {
      createProvider: () => providerWithVehicles(tenant),
      executor: async execution => {
        await searchVehicles(execution);
        return 'Based on our latest information, the Renault Clio is 300 MAD/day. Would you like me to check weekly rates? I can reserve it for you. The team will contact you.';
      },
    });

    expect(detailed.result.reply).toBe('The Renault Clio is 300 MAD/day.');
    expect(detailed.result.reply).not.toMatch(/based on|weekly|would you like|reserve|contact you/iu);
    expect(detailed.offeredActions).toEqual([]);
  });

  it('discovers and answers a tenant-specific weekly rate from current dynamic data', async () => {
    const tenant = fakeTenant();
    const executor = vi.fn(async execution => {
      const types = entityTypesOutputSchema.parse(await listEntityTypes.execute!(
        {},
        { requestContext: execution.requestContext, observe: noopObserve },
      ));
      expect(types.entityTypes[0]?.fields).toContainEqual({
        key: 'weeklyRate',
        label: 'Weekly rate',
        type: 'NUMBER',
      });
      const result = businessEntitySearchOutputSchema.parse(await searchBusinessEntities.execute!(
        { entityType: 'vehicle', text: 'Clio', fields: ['weeklyRate'], limit: 5, offset: 0 },
        { requestContext: execution.requestContext, observe: noopObserve },
      ));
      expect(result.entities[0]?.fields[0]?.value).toBe(1500);
      return 'The Renault Clio weekly rate is 1,500 MAD.';
    });
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'Can you check the weekly rate?' }, {
      createProvider: () => providerWithVehicles(tenant),
      executor,
    });

    expect(executor).toHaveBeenCalledOnce();
    expect(detailed.result).toMatchObject({ needsHuman: false, reasonCode: 'NONE' });
    expect(detailed.result.reply).toMatch(/weekly rate is 1,500 MAD/iu);
  });

  it('does not invent a weekly rate when the tenant schema does not provide one', async () => {
    const tenant = fakeTenant();
    const provider = providerWithVehicles(tenant);
    provider.listEntityTypes = async () => [{
      id: randomUUID(), key: 'vehicle', name: 'Vehicles', description: null, schemaVersion: 1, fieldCount: 2,
      fields: [
        { key: 'price', label: 'Daily price', type: 'NUMBER' },
        { key: 'available', label: 'Available', type: 'BOOLEAN' },
      ],
    }];
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'What is the weekly rate?' }, {
      createProvider: () => provider,
      executor: async execution => {
        const types = entityTypesOutputSchema.parse(await listEntityTypes.execute!(
          {},
          { requestContext: execution.requestContext, observe: noopObserve },
        ));
        expect(types.entityTypes[0]?.fields.map(field => field.key)).not.toContain('weeklyRate');
        return 'The weekly rate is 1,500 MAD.';
      },
    });

    expect(detailed.result).toMatchObject({ needsHuman: true, reasonCode: 'MISSING_INFORMATION' });
    expect(detailed.result.reply).not.toMatch(/1,500/iu);
  });

  it.each([
    ['Can you reserve it for me?', /(?:can|will) reserve/iu],
    ['Can you arrange delivery?', /(?:can|will) arrange delivery/iu],
  ])('does not promise an unsupported capability: %s', async (message, forbiddenPromise) => {
    const tenant = fakeTenant();
    const executor = vi.fn(async () => 'Unsupported action completed.');
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message }, {
      createProvider: () => providerWithVehicles(tenant),
      executor,
    });

    expect(executor).not.toHaveBeenCalled();
    expect(detailed.result).toMatchObject({ needsHuman: false, reasonCode: 'UNSUPPORTED_ACTION' });
    expect(detailed.result.reply).not.toMatch(forbiddenPromise);
  });

  it('registers only a real offered action after the backing entity capability succeeds', async () => {
    const tenant = fakeTenant();
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'How much is the Clio?' }, {
      createProvider: () => providerWithVehicles(tenant),
      executor: async execution => {
        await searchVehicles(execution);
        const offer = offerCustomerServiceActionsOutputSchema.parse(await offerCustomerServiceActions.execute!(
          { actions: [availableVehiclesAction] },
          { requestContext: execution.requestContext, observe: noopObserve },
        ));
        expect(offer.acceptedActions).toEqual([availableVehiclesAction]);
        return 'The Renault Clio is 300 MAD/day.';
      },
    });

    expect(detailed.result.reply).toMatch(/300 MAD\/day.*other available options/iu);
    expect(detailed.offeredActions).toEqual([availableVehiclesAction]);
  });

  it('registers a dynamic-field offer only when the tenant schema exposes that field', async () => {
    const tenant = fakeTenant();
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'How much is the Clio per day?' }, {
      createProvider: () => providerWithVehicles(tenant),
      executor: async execution => {
        await listEntityTypes.execute!(
          {},
          { requestContext: execution.requestContext, observe: noopObserve },
        );
        const offer = offerCustomerServiceActionsOutputSchema.parse(await offerCustomerServiceActions.execute!(
          {
            actions: [
              { type: 'CHECK_ENTITY_FIELD', entityType: 'vehicle', field: 'weeklyRate' },
              { type: 'CHECK_ENTITY_FIELD', entityType: 'vehicle', field: 'inventedRate' },
            ],
          },
          { requestContext: execution.requestContext, observe: noopObserve },
        ));
        expect(offer.acceptedActions).toEqual([{
          type: 'CHECK_ENTITY_FIELD',
          entityType: 'vehicle',
          field: 'weeklyRate',
          label: 'Weekly rate',
        }]);
        await searchVehicles(execution);
        return 'The Renault Clio is 300 MAD/day.';
      },
    });

    expect(detailed.result.reply).toMatch(/300 MAD\/day.*weekly rate/iu);
    expect(detailed.offeredActions).toEqual([{
      type: 'CHECK_ENTITY_FIELD',
      entityType: 'vehicle',
      field: 'weeklyRate',
      label: 'Weekly rate',
    }]);
  });

  it('resolves an unambiguous acceptance into the registered action and runs the real search', async () => {
    const tenant = fakeTenant();
    const provider = providerWithVehicles(tenant);
    const detailed = await runCustomerServiceAgentWithDiagnostics({
      tenant,
      message: 'okay do that',
      pendingActions: [availableVehiclesAction],
      history: {
        businessId: tenant.businessId,
        messages: [
          { role: 'user', content: 'How much is the Clio?' },
          { role: 'assistant', content: 'The Renault Clio is 300 MAD/day. I can also check the other available options.' },
        ],
      },
    }, {
      createProvider: () => provider,
      executor: async execution => {
        expect(execution.acceptedAction).toEqual(availableVehiclesAction);
        expect(execution.instructions).toContain('application-authorized pending action');
        const output = await searchVehicles(execution);
        expect(output.entities.map(entity => entity.name)).toEqual(['Renault Clio', 'Dacia Logan']);
        return 'The other available option is the Dacia Logan.';
      },
    });

    expect(detailed.result.reply).toContain('Dacia Logan');
    expect(detailed.result.reply).not.toContain('300 MAD');
    expect(detailed.offeredActions).toEqual([]);
  });

  it('executes an accepted tenant-defined field check through the shared search tool', async () => {
    const tenant = fakeTenant();
    const detailed = await runCustomerServiceAgentWithDiagnostics({
      tenant,
      message: 'okay do that',
      pendingActions: [weeklyRateAction],
      history: {
        businessId: tenant.businessId,
        messages: [
          { role: 'user', content: 'How much is the Clio per day?' },
          { role: 'assistant', content: 'The Clio is 300 MAD/day. I can also check Weekly rate.' },
        ],
      },
    }, {
      createProvider: () => providerWithVehicles(tenant),
      executor: async execution => {
        expect(execution.acceptedAction).toEqual(weeklyRateAction);
        expect(execution.instructions).toContain('weeklyRate');
        const output = businessEntitySearchOutputSchema.parse(await searchBusinessEntities.execute!(
          { entityType: 'vehicle', text: 'Clio', fields: ['weeklyRate'], limit: 5, offset: 0 },
          { requestContext: execution.requestContext, observe: noopObserve },
        ));
        expect(output.entities[0]?.fields[0]?.value).toBe(1500);
        return 'The Renault Clio weekly rate is 1,500 MAD.';
      },
    });

    expect(detailed.result).toMatchObject({
      reply: 'The Renault Clio weekly rate is 1,500 MAD.',
      needsHuman: false,
      reasonCode: 'NONE',
    });
  });

  it('asks for clarification when an acceptance could refer to two registered actions', async () => {
    const tenant = fakeTenant();
    const executor = vi.fn(async () => 'Guessed action.');
    const pendingActions: readonly PendingCustomerAction[] = [
      availableVehiclesAction,
      { type: 'CHECK_OPENING_HOURS' },
    ];
    const detailed = await runCustomerServiceAgentWithDiagnostics({
      tenant,
      message: 'check that',
      pendingActions,
    }, { createProvider: () => providerWithVehicles(tenant), executor });

    expect(executor).not.toHaveBeenCalled();
    expect(detailed.result).toMatchObject({ needsHuman: false, reasonCode: 'CLARIFICATION_NEEDED' });
    expect(detailed.result.reply).toMatch(/other available options.*opening hours/iu);
    expect(detailed.offeredActions).toEqual(pendingActions);
  });

  it('derives available actions from the enabled real tool set', () => {
    expect(resolveCustomerServiceCapabilities(new Set<CustomerServiceToolName>(['getOpeningHours'])))
      .toEqual(['CHECK_OPENING_HOURS']);
    expect(resolveCustomerServiceCapabilities(new Set<CustomerServiceToolName>(['listEntityTypes'])))
      .not.toContain('LIST_AVAILABLE_ENTITIES');
  });
});
