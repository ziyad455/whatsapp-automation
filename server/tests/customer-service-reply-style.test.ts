import { noopObserve } from '@mastra/core/tools';
import { describe, expect, it } from 'vitest';
import { runCustomerServiceAgent } from '../src/ai/customer-service-agent';
import { CUSTOMER_SERVICE_AGENT_INSTRUCTIONS } from '../src/ai/business-instructions';
import { searchBusinessEntities } from '../src/mastra/tools/business-information-tools';
import { fakeProvider, fakeTenant } from './helpers/ai-fixtures';
import { evaluateReplyStyle } from './helpers/reply-style';

describe('customer-service reply style', () => {
  it('defines a direct staff-like voice while keeping tools and internals invisible', () => {
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('customer-facing staff member');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Use tools silently');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Start with the answer');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('Ask a follow-up only when');
    expect(CUSTOMER_SERVICE_AGENT_INSTRUCTIONS).toContain('STALE and UNKNOWN facts cannot be stated');
  });

  it.each([
    ['available vehicle', 'Right now we have a Renault Clio automatic available for 300 MAD/day.'],
    ['opening hours', "We're open from 09:00 to 18:00."],
    ['known current price', "It's 300 MAD/day."],
    ['missing information', "I don't have a confirmed price for that one right now. The team will need to check."],
    ['stale information', "I'm not fully sure about today's availability. The team will need to confirm it."],
    ['multiple results', 'We currently have:\n- Renault Clio automatic — 300 MAD/day\n- Dacia Logan manual — 250 MAD/day'],
    ['conversation follow-up', 'The automatic one is the Renault Clio at 300 MAD/day.'],
    ['English', 'Yes, the Clio is available.'],
    ['Darija', 'إييه، الكليو متوفرة دابا بـ300 درهم للنهار.'],
    ['French', 'Oui, la Clio est disponible à 300 MAD par jour.'],
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
