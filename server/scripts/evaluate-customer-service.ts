// Explicit live-provider evaluation, separate from npm test. Uses fake data only; no database writes.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runCustomerServiceAgent as invokeAgent } from '../src/ai/customer-service-agent';
import type { AgentResult } from '../src/ai/agent-result';
import type { CurrentBusinessEntity } from '../src/business-data/business-data-provider';
import { fakeTenant, fakeProvider, fakeMetadata } from '../tests/helpers/ai-fixtures';
import { evaluateReplyStyle } from '../tests/helpers/reply-style';

const tenant = fakeTenant();
let observed: AgentResult | undefined;
const runCustomerServiceAgent: typeof invokeAgent = async (...args) => {
  observed = await invokeAgent(...args);
  return observed;
};
const provider = fakeProvider(tenant, 'Example Customer Service');
let status: 'FRESH' | 'STALE' = 'FRESH';
let lookups = 0;

interface VehicleFixture {
  readonly name: string;
  readonly brand: string;
  readonly model: string;
  readonly transmission: 'automatic' | 'manual';
  readonly pricePerDay: number;
  readonly available: boolean;
}

let vehicles: VehicleFixture[] = [{
  name: 'Renault Clio',
  brand: 'Renault',
  model: 'Clio',
  transmission: 'automatic',
  pricePerDay: 300,
  available: true,
}];

const toEntity = (vehicle: VehicleFixture, index: number): CurrentBusinessEntity => ({
  id: `fixture-entity-${index}`,
  entityTypeId: 'fixture-type',
  entityTypeKey: 'vehicle',
  name: vehicle.name,
  status: 'ACTIVE',
  source: 'MANUAL',
  externalId: null,
  lastVerifiedAt: new Date(),
  updatedAt: new Date(),
  fields: [
    ['brand', 'Brand', 'TEXT', vehicle.brand],
    ['model', 'Model', 'TEXT', vehicle.model],
    ['transmission', 'Transmission', 'SELECT', vehicle.transmission],
    ['pricePerDay', 'Daily price', 'NUMBER', vehicle.pricePerDay],
    ['available', 'Available', 'BOOLEAN', vehicle.available],
  ].map(([key, label, type, value], fieldIndex) => ({
    definitionId: `fixture-field-${fieldIndex}`,
    key: String(key),
    label: String(label),
    type: type as 'TEXT' | 'SELECT' | 'NUMBER' | 'BOOLEAN',
    value,
    hasValue: true,
    metadata: fakeMetadata({ freshnessClass: 'CHANGING', freshnessStatus: status }),
  })),
});

provider.searchEntities = async input => {
  lookups++;
  const limit = input.limit ?? 5;
  const offset = input.offset ?? 0;
  const matches = vehicles.filter(vehicle => Object.entries(input.filters ?? {}).every(
    ([field, value]) => vehicle[field as keyof VehicleFixture] === value,
  ));
  return {
    limit,
    offset,
    items: matches.slice(offset, offset + limit).map(toEntity),
  };
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
    assert.deepEqual(evaluateReplyStyle(result.reply), []);
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
    if (test.name === 'French') {
      assert.match(result.reply, /lundi/iu);
      assert.doesNotMatch(result.reply, /mardi|mercredi|jeudi|vendredi|samedi|dimanche/iu);
    }
    return result;
  });
}
await check('Explicit human request', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'I want to talk to a person.' }, { createProvider: () => provider });
  assert(result.needsHuman);
  assert.equal(result.reasonCode, 'CUSTOMER_REQUESTED_HUMAN');
  return result;
});

await check('Available vehicles style', async () => {
  vehicles = [{ name: 'Renault Clio', brand: 'Renault', model: 'Clio', transmission: 'automatic', pricePerDay: 300, available: true }];
  status = 'FRESH';
  const result = await runCustomerServiceAgent({ tenant, message: 'What cars are available and how much are they?' }, { createProvider: () => provider });
  assert.match(result.reply, /Clio/iu);
  assert.match(result.reply, /300/iu);
  return result;
});

await check('Opening hours style', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'What time do you close on Monday?' }, { createProvider: () => provider });
  assert.match(result.reply, /18:00|6\s*(?:pm|p\.m\.)/iu);
  return result;
});

await check('Known current price style', async () => {
  const result = await runCustomerServiceAgent({ tenant, message: 'How much is the Renault Clio per day?' }, { createProvider: () => provider });
  assert.match(result.reply, /300/iu);
  return result;
});

await check('Multiple vehicle results style', async () => {
  vehicles = [
    { name: 'Renault Clio', brand: 'Renault', model: 'Clio', transmission: 'automatic', pricePerDay: 300, available: true },
    { name: 'Dacia Logan', brand: 'Dacia', model: 'Logan', transmission: 'manual', pricePerDay: 250, available: true },
    { name: 'Peugeot 208', brand: 'Peugeot', model: '208', transmission: 'automatic', pricePerDay: 350, available: true },
  ];
  const result = await runCustomerServiceAgent({ tenant, message: 'Which cars are available and what are their daily prices?' }, { createProvider: () => provider });
  assert.match(result.reply, /Clio/iu);
  assert.match(result.reply, /Logan/iu);
  assert.match(result.reply, /208/iu);
  return result;
});

await check('Conversation follow-up style', async () => {
  const result = await runCustomerServiceAgent({
    tenant,
    message: 'And the automatic one?',
    history: {
      businessId: tenant.businessId,
      messages: [
        { role: 'user', content: 'What cars are available?' },
        { role: 'assistant', content: 'We have a Renault Clio automatic and a Dacia Logan manual.' },
      ],
    },
  }, { createProvider: () => provider });
  assert.match(result.reply, /Clio|208/iu);
  return result;
});

for (const nextPrice of [500, 550]) {
  vehicles = [{ name: 'Renault Clio', brand: 'Renault', model: 'Clio', transmission: 'automatic', pricePerDay: nextPrice, available: true }];
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
vehicles = [{ name: 'Renault Clio', brand: 'Renault', model: 'Clio', transmission: 'automatic', pricePerDay: 450, available: true }];
status = 'STALE';
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
