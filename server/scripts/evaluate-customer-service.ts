// Explicit live-provider evaluation, separate from npm test. Uses fake data only; no database writes.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runCustomerServiceAgent as invokeAgent } from '../src/ai/customer-service-agent';
import type { AgentResult } from '../src/ai/agent-result';
import { fakeTenant, fakeProvider, fakeMetadata } from '../tests/helpers/ai-fixtures';

const tenant = fakeTenant();
let observed: AgentResult | undefined;
const runCustomerServiceAgent: typeof invokeAgent = async (...args) => {
  observed = await invokeAgent(...args);
  return observed;
};
const provider = fakeProvider(tenant, 'Example Customer Service');
let price = 500;
let status: 'FRESH' | 'STALE' = 'FRESH';
let lookups = 0;
provider.searchEntities = async () => {
  lookups++;
  return { limit: 5, offset: 0, items: [{
    id: 'fixture-entity', entityTypeId: 'fixture-type', entityTypeKey: 'vehicle', name: 'Clio',
    status: 'ACTIVE', source: 'MANUAL', externalId: null, lastVerifiedAt: new Date(), updatedAt: new Date(),
    fields: [{ definitionId: 'fixture-field', key: 'pricePerDay', label: 'Daily price', type: 'NUMBER',
      value: price, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'CHANGING', freshnessStatus: status }) }],
  }] };
};

const languageCases: { name: string; message: string; languages: AgentResult['detectedLanguage'][] }[] = [
  { name: 'Darija Arabic script', message: 'واش عندكم شي طوموبيل أوتوماتيك؟', languages: ['darija-arabic'] },
  { name: 'Darija Arabizi', message: 'wach 3ndkom chi tomobil automatique?', languages: ['darija-latin', 'mixed'] },
  { name: 'Arabic', message: 'ما هي أوقات العمل؟', languages: ['ar'] },
  { name: 'French', message: 'Quels sont vos horaires ?', languages: ['fr'] },
  { name: 'English', message: 'What time do you close?', languages: ['en'] },
  { name: 'Mixed', message: 'سلام، je veux savoir le prix', languages: ['mixed'] },
];
let failures = 0;
let attempted = 0;
const selectedCases = process.argv.slice(2);
const check = async (name: string, run: () => Promise<AgentResult>) => {
  if (selectedCases.length && !selectedCases.includes(name)) return;
  // Avoid overlapping multi-step runs under the provider's development quota.
  if (attempted > 0) await delay(65000);
  attempted++;
  observed = undefined;
  try {
    const result = await run();
    // Replies contain synthetic business/customer data only. Never print raw provider errors/requests.
    console.log(JSON.stringify({ case: name, result }));
  } catch (error) {
    failures++;
    console.error(JSON.stringify({ case: name, status: 'FAIL', errorKind: error instanceof Error ? error.name : 'UnknownError', observed }));
  }
};

for (const test of languageCases) {
  await check(test.name, async () => {
    const result = await runCustomerServiceAgent({ tenant, message: test.message }, { createProvider: () => provider });
    assert(test.languages.includes(result.detectedLanguage));
    if (['ar', 'darija-arabic'].includes(result.detectedLanguage)) assert(/[\u0600-\u06ff]/u.test(result.reply));
    return result;
  });
}
await check('Explicit human request', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'I want to talk to a person.' }, { createProvider: () => provider });
  assert(result.needsHuman);
  assert.equal(result.reasonCode, 'CUSTOMER_REQUESTED_HUMAN');
  return result;
});
for (const nextPrice of [500, 550]) {
  price = nextPrice;
  await check(`Current price ${nextPrice} over old history`, async () => {
    const before = lookups;
    const result = await runCustomerServiceAgent({ tenant, message: 'What is the Clio price now?', history: {
      businessId: tenant.businessId, messages: [{ role: 'user', content: 'Clio price?' }, { role: 'assistant', content: '400 MAD per day.' }],
    } }, { createProvider: () => provider });
    assert(lookups > before);
    assert(result.reply.includes(String(nextPrice)));
    assert(!result.reply.includes('400'));
    return result;
  });
}
price = 450; status = 'STALE';
await check('Stale price withheld', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'What is the current daily Clio price?' }, { createProvider: () => provider });
  assert.equal(result.reasonCode, 'STALE_INFORMATION');
  assert(!result.reply.includes('450'));
  return result;
});
provider.searchEntities = async () => ({ items: [], limit: 5, offset: 0 });
await check('Missing price', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'What is the current daily Tesla price?' }, { createProvider: () => provider });
  assert.equal(result.reasonCode, 'MISSING_INFORMATION');
  assert(!/\d/.test(result.reply));
  return result;
});
await check('Ambiguous booking asks clarification', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'I want to book.' }, { createProvider: () => provider });
  assert.equal(result.reasonCode, 'CLARIFICATION_NEEDED');
  assert.equal(result.needsHuman, false);
  return result;
});
console.log(`Live evaluation: ${attempted - failures}/${attempted} passed. Review language/style in the printed replies.`);
process.exitCode = failures ? 1 : 0;
