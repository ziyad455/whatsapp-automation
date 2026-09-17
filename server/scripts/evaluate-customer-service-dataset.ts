// Explicit live-provider regression over the stable Sprint 8 corpus. Uses synthetic data only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { customerServiceEvaluationDataset } from '../evaluations/customer-service-dataset';
import { runCustomerServiceAgentWithDiagnostics } from '../src/ai/customer-service-agent';
import type { BusinessDataProvider, CurrentBusinessEntity } from '../src/business-data/business-data-provider';
import { fakeMetadata, fakeProvider, fakeTenant } from '../tests/helpers/ai-fixtures';
import { evaluateReplyStyle } from '../tests/helpers/reply-style';

const selectedIds = new Set(process.argv.slice(2));
const cases = selectedIds.size
  ? customerServiceEvaluationDataset.filter(testCase => selectedIds.has(testCase.id))
  : customerServiceEvaluationDataset;
if (selectedIds.size && cases.length !== selectedIds.size) {
  throw new Error('One or more evaluation case IDs are unknown.');
}

const entity = (
  type: 'vehicle' | 'service',
  name: string,
  price: number,
): CurrentBusinessEntity => ({
  id: randomUUID(),
  entityTypeId: randomUUID(),
  entityTypeKey: type,
  name,
  status: 'ACTIVE',
  source: 'MANUAL',
  externalId: null,
  lastVerifiedAt: new Date(),
  updatedAt: new Date(),
  fields: [
    { definitionId: randomUUID(), key: 'price', label: 'Daily price', type: 'NUMBER', value: price, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'CHANGING' }) },
    { definitionId: randomUUID(), key: 'available', label: 'Available', type: 'BOOLEAN', value: true, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'REAL_TIME' }) },
  ],
});

const providerFor = (
  tenant: ReturnType<typeof fakeTenant>,
  fixture: 'car-rental' | 'salon' | 'gym',
): BusinessDataProvider => {
  const names = { 'car-rental': 'Atlas Cars', salon: 'Nour Beauty', gym: 'Atlas Fitness' } as const;
  const provider = fakeProvider(tenant, names[fixture]);
  const ownEntity = fixture === 'car-rental'
    ? entity('vehicle', 'Renault Clio', 300)
    : fixture === 'salon'
      ? entity('service', 'Haircut', 120)
      : undefined;
  provider.searchEntities = async input => {
    const search = input.search?.toLocaleLowerCase() ?? '';
    const matches = ownEntity && input.entityType === ownEntity.entityTypeKey &&
      (!search || ownEntity.name.toLocaleLowerCase().includes(search))
      ? [ownEntity]
      : [];
    return { items: matches, limit: input.limit ?? 5, offset: input.offset ?? 0 };
  };
  provider.listEntityTypes = async () => ownEntity ? [{
    id: ownEntity.entityTypeId,
    key: ownEntity.entityTypeKey,
    name: ownEntity.entityTypeKey === 'vehicle' ? 'Vehicles' : 'Services',
    description: null,
    schemaVersion: 1,
    fieldCount: 2,
    fields: ownEntity.fields.map(field => ({
      key: field.key,
      label: field.label,
      type: field.type,
    })),
  }] : [];
  return provider;
};

let failures = 0;
for (const [caseIndex, testCase] of cases.entries()) {
  if (caseIndex > 0) await delay(65_000);
  const tenant = fakeTenant();
  const provider = providerFor(tenant, testCase.tenantFixture);
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  try {
    let finalRun: Awaited<ReturnType<typeof runCustomerServiceAgentWithDiagnostics>> | undefined;
    for (const message of testCase.turns) {
      finalRun = await runCustomerServiceAgentWithDiagnostics({
        tenant,
        message,
        history: { businessId: tenant.businessId, messages: history },
      }, { createProvider: () => provider });
      history.push({ role: 'user', content: message }, { role: 'assistant', content: finalRun.result.reply });
    }
    assert(finalRun);
    assert.equal(finalRun.result.detectedIntent, testCase.expectedIntent);
    assert.equal(finalRun.result.detectedLanguage, testCase.expectedLanguage);
    if (testCase.expectedNeedsHuman !== undefined) {
      assert.equal(finalRun.result.needsHuman, testCase.expectedNeedsHuman);
    }
    assert.deepEqual(evaluateReplyStyle(finalRun.result.reply), []);
    for (const forbidden of testCase.forbiddenFacts ?? []) {
      assert(!finalRun.result.reply.toLocaleLowerCase().includes(forbidden.toLocaleLowerCase()));
    }
    if (testCase.tags.some(tag => ['price', 'availability', 'hours', 'rules', 'hallucination'].includes(tag))) {
      assert(finalRun.diagnostics.toolCalls.length > 0, 'Expected at least one tenant-bound tool call.');
    }
    console.log(JSON.stringify({ id: testCase.id, status: 'PASS', result: finalRun.result, diagnostics: finalRun.diagnostics }));
  } catch (error) {
    failures++;
    console.error(JSON.stringify({ id: testCase.id, status: 'FAIL', errorKind: error instanceof Error ? error.name : 'UnknownError' }));
  }
}

console.log(`Live dataset evaluation: ${cases.length - failures}/${cases.length} passed.`);
process.exitCode = failures ? 1 : 0;
