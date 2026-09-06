import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { noopObserve } from '@mastra/core/tools';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createBusiness } from '../src/businesses/business.repository';
import { prisma, closeDatabaseConnection } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import { applyBusinessTemplate } from '../src/business-data/business-type-templates';
import { createTenantBusinessEntityService } from '../src/business-data/tenant-business-entity.service';
import { createTenantBusinessRuleService } from '../src/business-configuration/tenant-business-rule.service';
import { createTenantBusinessProfileService } from '../src/business-configuration/tenant-business-profile.service';
import { createTenantOpeningHoursService, BUSINESS_WEEKDAYS } from '../src/business-configuration/tenant-opening-hours.service';
import { buildBusinessContext } from '../src/ai/business-context';
import { runCustomerServiceAgent, executeCustomerServiceAgent } from '../src/ai/customer-service-agent';
import { readBusinessFacts, businessFactsOutputSchema } from '../src/mastra/tools/business-facts';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';
import type { TenantContext } from '../src/tenancy/tenant-context';

assertIsolatedTestDatabase();
const tenants: TenantContext[] = [];

describe('Sprint 6 database and Mastra runtime', () => {
  beforeAll(async () => {
    for (const [name, category] of [['S6 Atlas Cars', 'CAR_RENTAL'], ['S6 Nour Beauty', 'SALON'], ['S6 Atlas Fitness', 'GYM']]) {
      const business = await createBusiness({ name, category, timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'fr', lifecycleStatus: 'ACTIVE' });
      const user = await prisma.user.create({ data: { name: 'Fake S6 owner', email: `${business.id}@example.test` } });
      const member = await createMembership({ businessId: business.id, userId: user.id, role: 'OWNER' });
      const tenant = { businessId: business.id, userId: user.id, membershipId: member.id, role: member.role };
      tenants.push(tenant);
      await applyBusinessTemplate(tenant);
      await createTenantOpeningHoursService(tenant).replaceWeek(BUSINESS_WEEKDAYS.map(dayOfWeek => ({ dayOfWeek, isOpen: true, opensAt: '09:00', closesAt: category === 'SALON' ? '19:00' : '18:00' })));
      await createTenantBusinessRuleService(tenant).create({ category: 'POLICY', name: `${name} policy`, content: `${name} policy only.` });
    }
  });
  afterAll(async () => {
    for (const tenant of tenants) {
      await prisma.business.delete({ where: { id: tenant.businessId } });
      await prisma.user.delete({ where: { id: tenant.userId } });
    }
    await closeDatabaseConnection();
  });

  it('loads tenant configuration and changes profile, hours, language and active policy on the next run', async () => {
    const tenant = tenants[0];
    const rules = createTenantBusinessRuleService(tenant);
    const rule = await rules.create({ category: 'DEPOSIT', name: 'Deposit', content: 'Deposit required: 3000 MAD' });
    const prompts: string[] = [];
    const invoke = () => runCustomerServiceAgent({ tenant, message: 'What is your policy?' }, {
      executor: async execution => { prompts.push(execution.instructions); return 'Here is the current policy.'; },
    });
    await invoke();
    await rules.update(rule.id, { content: 'Deposit required: 4000 MAD' });
    await createTenantBusinessProfileService(tenant).update({ name: 'S6 Atlas Cars', description: 'New authorized description', timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'en', supportedLanguages: ['en', 'fr', 'darija'] });
    await invoke();
    await rules.update(rule.id, { active: false });
    await invoke();
    expect(prompts[0]).toContain('Deposit required: 3000 MAD');
    expect(prompts[1]).toContain('Deposit required: 4000 MAD');
    expect(prompts[1]).toContain('New authorized description');
    expect(prompts[1]).toContain('"defaultLanguage":"en"');
    expect(prompts[2]).not.toContain('Deposit required:');
    for (const prompt of prompts) expect(prompt).not.toContain('S6 Nour Beauty');
    const contexts = await Promise.all(tenants.map(tenant => buildBusinessContext(tenant)));
    expect(contexts.map(context => context.name)).toEqual(['S6 Atlas Cars', 'S6 Nour Beauty', 'S6 Atlas Fitness']);
    expect(contexts.every(context => context.deferredOpeningHours)).toBe(true);
    for (const tenant of tenants) {
      await runCustomerServiceAgent({ tenant, message: 'Hours?' }, { executor: async execution => {
        const result = businessFactsOutputSchema.parse(await readBusinessFacts.execute!({ kind: 'opening_hours' }, { requestContext: execution.requestContext, observe: noopObserve }));
        expect(result.facts.every(fact => fact.value === (tenant === tenants[1] ? '09:00–19:00' : '09:00–18:00'))).toBe(true);
        return 'These are the current opening hours.';
      } });
    }
    await createTenantOpeningHoursService(tenant).replaceWeek(BUSINESS_WEEKDAYS.map(dayOfWeek => ({ dayOfWeek, isOpen: true, opensAt: '10:00', closesAt: '17:00' })));
    await runCustomerServiceAgent({ tenant, message: 'Updated hours?' }, { executor: async execution => {
      const result = businessFactsOutputSchema.parse(await readBusinessFacts.execute!({ kind: 'opening_hours' }, { requestContext: execution.requestContext, observe: noopObserve }));
      expect(result.facts.every(fact => fact.value === '10:00–17:00')).toBe(true);
      return 'These are the updated opening hours.';
    } });
  });

  it('executes a real Mastra tool loop with plain text and uses current database prices over old history', async () => {
    const tenant = tenants[0];
    const entities = createTenantBusinessEntityService(tenant);
    const entity = await entities.createForType('vehicle', { name: 'Clio', data: { brand: 'Renault', model: 'Clio', pricePerDay: 500, available: true } });
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async options => {
        calls++;
        const toolMessage = [...options.prompt].reverse().find(message => message.role === 'tool');
        if (!toolMessage || toolMessage.role !== 'tool') {
          return { content: [{ type: 'tool-call', toolCallId: 'lookup-price', toolName: 'readBusinessFacts', input: JSON.stringify({ kind: 'entities', entityType: 'vehicle', search: 'Clio', fields: ['pricePerDay'] }) }], finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
        }
        const result = toolMessage.content[0];
        if (result.type !== 'tool-result' || result.output.type !== 'json') throw new Error('Expected current tool JSON.');
        const facts = businessFactsOutputSchema.parse(result.output.value).facts;
        const price = facts[0];
        return { content: [{ type: 'text', text: `The current price is ${price.value} MAD.` }], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
      },
    });
    const invoke = () => runCustomerServiceAgent({ tenant, message: 'How much is the Clio now?', history: { businessId: tenant.businessId, messages: [{ role: 'user', content: 'Clio price?' }, { role: 'assistant', content: 'Clio is 400 MAD.' }] } }, { executor: execution => executeCustomerServiceAgent(execution, model) });
    expect(await invoke()).toMatchObject({
      reply: expect.stringContaining('500 MAD'),
      detectedIntent: 'PRICE_INQUIRY',
      detectedLanguage: 'en',
      reasonCode: 'NONE',
      needsHuman: false,
    });
    await entities.update('vehicle', entity!.id, { name: 'Clio', data: { brand: 'Renault', model: 'Clio', pricePerDay: 550, available: true } });
    expect((await invoke()).reply).toContain('550 MAD');
    expect(calls).toBe(4);
    const missing = await runCustomerServiceAgent({ tenant: tenants[1], message: 'Find Clio' }, { executor: async execution => {
      const result = businessFactsOutputSchema.parse(await readBusinessFacts.execute!({ kind: 'entities', entityType: 'vehicle', search: entity!.id }, { requestContext: execution.requestContext, observe: noopObserve }));
      expect(result.facts).toEqual([]);
      return 'That information is not available for this business.';
    } });
    expect(missing).toMatchObject({ reasonCode: 'MISSING_INFORMATION', needsHuman: true });
  });
});
