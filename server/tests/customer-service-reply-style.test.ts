import { randomUUID } from 'node:crypto';
import { noopObserve } from '@mastra/core/tools';
import { describe, expect, it } from 'vitest';
import { runCustomerServiceAgent } from '../src/ai/customer-service-agent';
import { normalizeAgentReply } from '../src/ai/agent-result';
import { CUSTOMER_SERVICE_AGENT_INSTRUCTIONS } from '../src/ai/business-instructions';
import { CUSTOMER_COMMUNICATION_STYLE } from '../src/ai/customer-communication-style';
import { searchBusinessEntities } from '../src/mastra/tools/business-information-tools';
import { fakeMetadata, fakeProvider, fakeTenant } from './helpers/ai-fixtures';
import { evaluateReplyStyle } from './helpers/reply-style';

const providerWithClio = (tenant: ReturnType<typeof fakeTenant>) => {
  const provider = fakeProvider(tenant);
  provider.searchEntities = async () => ({
    items: [{
      id: randomUUID(),
      entityTypeId: randomUUID(),
      entityTypeKey: 'vehicle',
      name: 'Renault Clio',
      status: 'ACTIVE',
      source: 'MANUAL',
      externalId: null,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
      fields: [
        { definitionId: randomUUID(), key: 'price', label: 'Daily price', type: 'NUMBER', value: 300, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'CHANGING' }) },
        { definitionId: randomUUID(), key: 'available', label: 'Available', type: 'BOOLEAN', value: true, hasValue: true, metadata: fakeMetadata({ freshnessClass: 'REAL_TIME' }) },
      ],
    }],
    limit: 5,
    offset: 0,
  });
  return provider;
};

describe('customer-service reply style', () => {
  it('defines a direct staff-like voice while keeping tools and internals invisible', () => {
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('customer-facing staff member');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Use tools silently');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Start with the answer');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Ask a follow-up only when');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('STALE and UNKNOWN facts cannot be stated');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain("Never extend one day's hours to other days");
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain(CUSTOMER_COMMUNICATION_STYLE);
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain('Match the reply length to the request');
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain('State each fact once');
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain("Do not restate the customer's question");
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain('Do not use hype');
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain('Never leave a sentence or phrase unfinished');
    expect(CUSTOMER_COMMUNICATION_STYLE).toContain('Apply this same direct, natural style');
    expect(CUSTOMER_COMMUNICATION_STYLE).not.toContain('—');
  });

  it.each([
    ['available vehicle', 'Right now we have a Renault Clio automatic available for 300 MAD/day.'],
    ['opening hours', "We're open from 09:00 to 18:00."],
    ['known current price', "It's 300 MAD/day."],
    ['missing information', "I don't have a confirmed price for that one right now. The team will need to check."],
    ['stale information', "I'm not fully sure about today's availability. The team will need to confirm it."],
    ['multiple results', 'We currently have:\n- Renault Clio automatic: 300 MAD/day\n- Dacia Logan manual: 250 MAD/day'],
    ['conversation follow-up', 'The automatic one is the Renault Clio at 300 MAD/day.'],
    ['English', 'Yes, the Clio is available.'],
    ['Darija', 'إييه، الكليو متوفرة دابا بـ300 درهم للنهار.'],
    ['French', 'Oui, la Clio est disponible à 300 MAD par jour.'],
    ['Arabic', 'السيارة متوفرة الآن بسعر 300 درهم في اليوم.'],
    ['mixed language', 'Oui, Clio automatique kayna daba b 300 MAD par jour.'],
  ])('accepts natural %s replies without requiring exact wording', (_case, reply) => {
    expect(evaluateReplyStyle(reply)).toEqual([]);
  });

  it.each([
    'Based on the latest data from our system, the Clio is available.',
    'Based on our latest information, the Clio is available.',
    'Based on the available data, the Clio is available.',
    'According to our records, the price is 300 MAD.',
    'The system indicates that we close at 18:00.',
    'The system shows that we close at 18:00.',
    'Our database shows that the Clio is available.',
    'I checked the system and the Clio is available.',
    "D'après nos données, la Clio est disponible.",
    'حسب النظام، السيارة متوفرة.',
  ])('flags internal or system-style narration: %s', reply => {
    expect(evaluateReplyStyle(reply)).toContain('ROBOTIC_NARRATION');
  });

  it('flags scripted closers, report formatting, and mini-report length independently', () => {
    expect(evaluateReplyStyle('The Clio is available. Would you like assistance with anything else?'))
      .toContain('GENERIC_CLOSER');
    expect(evaluateReplyStyle('## Availability\n**Brand:** Renault\n**Model:** Clio ✅'))
      .toContain('REPORT_FORMATTING');
    expect(evaluateReplyStyle('x'.repeat(701))).toContain('EXCESSIVE_LENGTH');
  });

  it.each([
    ['Absolutely! The Clio is 300 MAD/day.', 'RITUAL_OPENER'],
    ['You are asking about the Clio price. It is 300 MAD/day.', 'CUSTOMER_ECHO'],
    ['The Clio is a fantastic deal. Secure your booking today.', 'SALES_PRESSURE'],
    ['The Clio is available — it costs 300 MAD/day.', 'EM_DASH'],
    ['We close at 18:00. If you need another time, just', 'INCOMPLETE_ENDING'],
    ['The Clio is available. Feel free to ask if you have any other questions.', 'GENERIC_CLOSER'],
  ] as const)('flags anti-slop pattern %s', (reply, violation) => {
    expect(evaluateReplyStyle(reply)).toContain(violation);
  });

  it('removes only clear model punctuation artifacts at the final text boundary', () => {
    expect(normalizeAgentReply(
      'On Monday we close at 18:00. I currently only have the hours for Monday —',
    )).toBe('On Monday we close at 18:00.');
    expect(normalizeAgentReply(
      'We close at 18:00. If you need another time, just',
    )).toBe('We close at 18:00.');
    expect(normalizeAgentReply(
      'The Clio is available — it costs 300 MAD/day.',
    )).toBe('The Clio is available, it costs 300 MAD/day.');
    expect(normalizeAgentReply('Which dates are you looking for')).toBe(
      'Which dates are you looking for',
    );
  });

  it('keeps a simple grounded price answer short without changing AgentResult ownership', async () => {
    const tenant = fakeTenant();
    const response = await runCustomerServiceAgent({ tenant, message: 'How much is the Clio?' }, {
      createProvider: () => providerWithClio(tenant),
      executor: async execution => {
        await searchBusinessEntities.execute!(
          { entityType: 'vehicle', text: 'Clio', fields: ['price'], limit: 5, offset: 0 },
          { requestContext: execution.requestContext, observe: noopObserve },
        );
        return 'The Clio is 300 MAD/day.';
      },
    });

    expect(response).toMatchObject({
      reply: 'The Clio is 300 MAD/day.',
      detectedIntent: 'PRICE_INQUIRY',
      detectedLanguage: 'en',
      needsHuman: false,
      reasonCode: 'NONE',
    });
    expect(evaluateReplyStyle(response.reply)).toEqual([]);
  });

  it('uses recent context for a natural follow-up without repeating the earlier turn', async () => {
    const tenant = fakeTenant();
    const response = await runCustomerServiceAgent({
      tenant,
      message: 'Is it available?',
      history: {
        businessId: tenant.businessId,
        messages: [
          { role: 'user', content: 'How much is the Clio?' },
          { role: 'assistant', content: 'The Clio is 300 MAD/day.' },
        ],
      },
    }, {
      createProvider: () => providerWithClio(tenant),
      executor: async execution => {
        expect(execution.messages).toEqual([
          { role: 'user', content: 'How much is the Clio?' },
          { role: 'assistant', content: 'The Clio is 300 MAD/day.' },
          { role: 'user', content: 'Is it available?' },
        ]);
        await searchBusinessEntities.execute!(
          { entityType: 'vehicle', text: 'Clio', fields: ['available'], limit: 5, offset: 0 },
          { requestContext: execution.requestContext, observe: noopObserve },
        );
        return 'Yes, the Clio is available.';
      },
    });

    expect(response.reply).toBe('Yes, the Clio is available.');
    expect(response).toMatchObject({
      detectedIntent: 'AVAILABILITY_INQUIRY',
      detectedLanguage: 'en',
      needsHuman: false,
      reasonCode: 'NONE',
    });
    expect(evaluateReplyStyle(response.reply)).toEqual([]);
  });

  it('keeps an explicit human request concise while application metadata owns handoff', async () => {
    const tenant = fakeTenant();
    const response = await runCustomerServiceAgent({ tenant, message: 'I need to speak to a person.' }, {
      createProvider: () => fakeProvider(tenant),
      executor: async () => 'The team needs to handle this with you.',
    });

    expect(response).toMatchObject({
      reply: 'The team needs to handle this with you.',
      detectedIntent: 'HUMAN_REQUEST',
      detectedLanguage: 'en',
      needsHuman: true,
      reasonCode: 'CUSTOMER_REQUESTED_HUMAN',
    });
    expect(evaluateReplyStyle(response.reply)).toEqual([]);
  });

  it.each([
    ['What is the Tesla price?', 'en'],
    ['Quel est le prix de la Tesla ?', 'fr'],
    ['شحال ثمن تسلا؟', 'darija-arabic'],
  ] as const)('keeps missing-information safety natural in %s', async (message, language) => {
    const tenant = fakeTenant();
    const response = await runCustomerServiceAgent({ tenant, message }, {
      createProvider: () => fakeProvider(tenant),
      executor: async execution => {
        await searchBusinessEntities.execute!(
          { entityType: 'vehicle', text: 'Tesla', limit: 5, offset: 0 },
          { requestContext: execution.requestContext, observe: noopObserve },
        );
        return 'The Tesla definitely costs 900 MAD.';
      },
    });

    expect(response).toMatchObject({
      needsHuman: true,
      reasonCode: 'MISSING_INFORMATION',
      detectedLanguage: language,
    });
    expect(response.reply).not.toContain('900');
    expect(evaluateReplyStyle(response.reply)).toEqual([]);
  });
});
