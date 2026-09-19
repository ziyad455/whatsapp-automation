import { describe, expect, it } from 'vitest';
import { leadQualificationCases } from '../evaluations/lead-qualification-cases';
import { analyzeCustomerMessage } from '../src/ai/customer-message-analysis';
import { qualifyLeadMessage } from '../src/leads/lead-qualification';

describe('application-owned Lead qualification', () => {
  it.each(leadQualificationCases)('$name', testCase => {
    const analysis = analyzeCustomerMessage(testCase.message);
    const result = qualifyLeadMessage({
      message: testCase.message,
      detectedIntent: analysis.detectedIntent,
      hasActiveLead: false,
    });

    expect(analysis.detectedIntent).toBe(testCase.expectedIntent);
    expect(result.qualifies).toBe(testCase.qualifies);
  });

  it('adds meaningful follow-up evidence to an active Lead without treating noise as evidence', () => {
    expect(qualifyLeadMessage({
      message: 'My budget is 1500 MAD.',
      detectedIntent: 'UNKNOWN',
      hasActiveLead: true,
    })).toMatchObject({
      qualifies: true,
      reasonCode: 'ACTIVE_LEAD_EVIDENCE',
      evidenceTypes: expect.arrayContaining(['BUDGET']),
    });

    for (const message of ['Thanks', 'Okay', '👍']) {
      expect(qualifyLeadMessage({
        message,
        detectedIntent: 'UNKNOWN',
        hasActiveLead: true,
      })).toMatchObject({ qualifies: false, evidenceTypes: [] });
    }
  });

  it('keeps escalation and commercial qualification separate', () => {
    expect(qualifyLeadMessage({
      message: 'I want a human agent.',
      detectedIntent: 'HUMAN_REQUEST',
      hasActiveLead: false,
    })).toMatchObject({
      qualifies: false,
      intent: 'SUPPORT',
      reasonCode: 'ESCALATION_ONLY',
    });
  });
});
