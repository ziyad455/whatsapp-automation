import { describe, expect, it } from 'vitest';
import { agentResultSchema } from '../src/ai/agent-result';
import { determineHandoffReason } from '../src/conversations/conversation-escalation';

const result = (overrides: Partial<Parameters<typeof agentResultSchema.parse>[0]>) =>
  agentResultSchema.parse({
    reply: 'Safe customer-facing reply.',
    needsHuman: false,
    detectedIntent: 'BUSINESS_INFORMATION',
    reasonCode: 'NONE',
    detectedLanguage: 'en',
    ...overrides,
  });

describe('application-owned conversation escalation policy', () => {
  it('maps human requests, complaints, purchase intent, and important unknowns', () => {
    expect(determineHandoffReason(result({
      needsHuman: true,
      detectedIntent: 'HUMAN_REQUEST',
      reasonCode: 'CUSTOMER_REQUESTED_HUMAN',
    }))).toBe('CUSTOMER_REQUEST');
    expect(determineHandoffReason(result({
      needsHuman: true,
      detectedIntent: 'COMPLAINT',
    }))).toBe('COMPLAINT');
    expect(determineHandoffReason(result({
      detectedIntent: 'BOOKING_INTENT',
      reasonCode: 'CLARIFICATION_NEEDED',
    }))).toBe('PURCHASE_INTENT');
    expect(determineHandoffReason(result({
      needsHuman: true,
      reasonCode: 'MISSING_INFORMATION',
    }))).toBe('LOW_CONFIDENCE');
  });

  it('does not escalate normal business questions or out-of-scope redirects', () => {
    expect(determineHandoffReason(result({}))).toBeNull();
    expect(determineHandoffReason(result({
      detectedIntent: 'OUT_OF_SCOPE',
      reasonCode: 'OUT_OF_SCOPE',
      needsHuman: false,
    }))).toBeNull();
  });
});
