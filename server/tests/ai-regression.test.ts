import { randomUUID } from 'node:crypto';
import { noopObserve } from '@mastra/core/tools';
import { describe, expect, it } from 'vitest';
import { customerServiceEvaluationDataset } from '../evaluations/customer-service-dataset';
import { runCustomerServiceAgent, runCustomerServiceAgentWithDiagnostics } from '../src/ai/customer-service-agent';
import { analyzeCustomerMessage } from '../src/ai/customer-message-analysis';
import { buildConversationMessages, HISTORY_MESSAGE_LIMIT } from '../src/ai/conversation-context';
import {
  businessEntitySearchOutputSchema,
  getBusinessRules,
  searchBusinessEntities,
} from '../src/mastra/tools/business-information-tools';
import { fakeMetadata, fakeProvider, fakeTenant } from './helpers/ai-fixtures';

const requiredTags = [
  'darija', 'french', 'arabic', 'english', 'mixed', 'price', 'availability',
  'hours', 'rules', 'unknown', 'complaint', 'purchase-intent', 'human-request',
  'multi-turn', 'hallucination', 'tenant-leak',
] as const;

describe('Sprint 8 customer-service evaluation regression suite', () => {
  it('keeps a unique, bounded corpus covering every required behavior', () => {
    const ids = customerServiceEvaluationDataset.map(testCase => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(customerServiceEvaluationDataset.every(testCase =>
      testCase.turns.length > 0 && testCase.turns.every(turn => turn.length <= 4_000))).toBe(true);
    const tags = new Set(customerServiceEvaluationDataset.flatMap(testCase => testCase.tags));
    for (const tag of requiredTags) expect(tags.has(tag)).toBe(true);
  });

  it('keeps application-owned intent and language classification stable for the corpus', () => {
    for (const testCase of customerServiceEvaluationDataset) {
      expect(analyzeCustomerMessage(testCase.turns.at(-1)!), testCase.id).toEqual({
        detectedIntent: testCase.expectedIntent,
        detectedLanguage: testCase.expectedLanguage,
      });
    }
  });

  it('preserves bounded multi-turn context for realistic follow-ups', () => {
    const tenant = fakeTenant();
    for (const testCase of customerServiceEvaluationDataset.filter(item => item.tags.includes('multi-turn'))) {
      const currentMessage = testCase.turns.at(-1)!;
      const earlierTurns = testCase.turns.slice(0, -1);
      const messages = buildConversationMessages(tenant, currentMessage, {
        businessId: tenant.businessId,
        messages: earlierTurns.flatMap((content, index) => [
          { role: 'user' as const, content },
          { role: 'assistant' as const, content: index === 0 ? 'Here is the relevant current answer.' : 'Understood.' },
        ]),
      });
      expect(messages.at(-1)?.content).toBe(currentMessage);
      expect(messages.some(message => message.content === earlierTurns[0])).toBe(true);
      expect(messages.length).toBeLessThanOrEqual(HISTORY_MESSAGE_LIMIT + 1);
    }
  });

  it('refuses to fabricate deliberately absent facts', async () => {
    for (const testCase of customerServiceEvaluationDataset.filter(item => item.tags.includes('hallucination'))) {
      const tenant = fakeTenant();
      const provider = fakeProvider(tenant);
      provider.searchEntities = async () => ({ items: [], limit: 5, offset: 0 });
      provider.getBusinessRules = async () => [];
      const result = await runCustomerServiceAgent({ tenant, message: testCase.turns.at(-1)! }, {
        createProvider: () => provider,
        executor: async execution => {
          const context = { requestContext: execution.requestContext, observe: noopObserve };
          if (testCase.tags.includes('price')) {
            await searchBusinessEntities.execute!({ entityType: 'vehicle', text: 'missing', limit: 5, offset: 0 }, context);
          } else {
            await getBusinessRules.execute!({}, context);
          }
          return `Yes, that is available for 900 MAD.`;
        },
      });
      expect(result).toMatchObject({ needsHuman: true, reasonCode: 'MISSING_INFORMATION' });
      for (const forbidden of testCase.forbiddenFacts ?? []) {
        expect(result.reply.toLocaleLowerCase()).not.toContain(forbidden.toLocaleLowerCase());
      }
    }
  });

  it('reports safe application-owned tool diagnostics without raw payloads', async () => {
    const tenant = fakeTenant();
    const detailed = await runCustomerServiceAgentWithDiagnostics({ tenant, message: 'What are your hours?' }, {
      createProvider: fakeProvider,
      executor: async execution => {
        await getBusinessRules.execute!({}, {
          requestContext: execution.requestContext,
          observe: noopObserve,
        });
        return 'The deposit rule is available.';
      },
    });
    expect(detailed.diagnostics).toEqual({
      scope: 'BUSINESS_RELATED',
      generationBypassed: false,
      partiallyRelated: false,
      toolCalls: [{ tool: 'getBusinessRules', outcome: 'FOUND', freshness: 'FRESH' }],
    });
    expect(JSON.stringify(detailed.diagnostics)).not.toMatch(/businessId|membershipId|userId|private-/);
  });

  it('keeps cross-company prompts bound to the authorized provider', async () => {
    const carTenant = fakeTenant();
    const salonTenant = fakeTenant();
    const carProvider = fakeProvider(carTenant, 'Atlas Cars');
    const salonProvider = fakeProvider(salonTenant, 'Nour Beauty');
    carProvider.searchEntities = async () => ({ items: [{
      id: randomUUID(), entityTypeId: randomUUID(), entityTypeKey: 'vehicle', name: 'Renault Clio',
      status: 'ACTIVE', source: 'MANUAL', externalId: null, lastVerifiedAt: new Date(), updatedAt: new Date(),
      fields: [{ definitionId: randomUUID(), key: 'price', label: 'Price', type: 'NUMBER', value: 300, hasValue: true, metadata: fakeMetadata() }],
    }], limit: 5, offset: 0 });
    salonProvider.searchEntities = async () => ({ items: [{
      id: randomUUID(), entityTypeId: randomUUID(), entityTypeKey: 'service', name: 'Haircut',
      status: 'ACTIVE', source: 'MANUAL', externalId: null, lastVerifiedAt: new Date(), updatedAt: new Date(),
      fields: [{ definitionId: randomUUID(), key: 'price', label: 'Price', type: 'NUMBER', value: 120, hasValue: true, metadata: fakeMetadata() }],
    }], limit: 5, offset: 0 });

    const cases = customerServiceEvaluationDataset.filter(item => item.tags.includes('tenant-leak'));
    for (const [tenant, provider, testCase, ownType, ownName, foreignName] of [
      [carTenant, carProvider, cases[0], 'vehicle', 'Renault Clio', 'Haircut'],
      [salonTenant, salonProvider, cases[1], 'service', 'Haircut', 'Renault Clio'],
    ] as const) {
      const result = await runCustomerServiceAgent({ tenant, message: testCase!.turns[0]! }, {
        createProvider: () => provider,
        executor: async execution => {
          const output = businessEntitySearchOutputSchema.parse(await searchBusinessEntities.execute!(
            { entityType: ownType, limit: 5, offset: 0 },
            { requestContext: execution.requestContext, observe: noopObserve },
          ));
          expect(output.entities.map(entity => entity.name)).toEqual([ownName]);
          expect(JSON.stringify(output)).not.toContain(foreignName);
          return `${ownName} is the only matching current result.`;
        },
      });
      expect(result.reply).toContain(ownName);
      expect(result.reply).not.toContain(foreignName);
    }
  });
});
