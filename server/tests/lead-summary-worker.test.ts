import { describe, expect, it, vi } from 'vitest';
import {
  buildProvisionalLeadSummary,
  runLeadSummaryWorker,
  type LeadSummaryInput,
} from '../src/leads/lead-summary';

const completeEvidence: LeadSummaryInput = {
  intent: 'BOOKING_INTEREST',
  evidence: [
    {
      content: 'I need an automatic Clio for 5 days starting Monday.',
      evidenceTypes: ['BOOKING_INTENT', 'ITEM_OR_SERVICE', 'QUANTITY_OR_DURATION', 'DATE_OR_TIME', 'COMMITMENT'],
    },
    {
      content: 'My budget is 1500 MAD.',
      evidenceTypes: ['BUDGET'],
    },
  ],
};

describe('specialized Lead summary worker boundary', () => {
  it('accepts a concise grounded structured summary', async () => {
    await expect(runLeadSummaryWorker(completeEvidence, async () => ({
      summary: 'Customer wants an automatic Clio for 5 days starting Monday with a 1,500 MAD budget.',
      keyFacts: [
        { label: 'Vehicle', value: 'automatic Clio' },
        { label: 'Duration', value: '5 days' },
        { label: 'Budget', value: '1,500 MAD' },
      ],
      constraints: ['Starting Monday'],
      missingImportantInfo: [],
    }))).resolves.toMatchObject({
      keyFacts: expect.arrayContaining([{ label: 'Budget', value: '1,500 MAD' }]),
      missingImportantInfo: [],
    });
  });

  it('keeps absent budget and date explicitly missing', async () => {
    const evidence: LeadSummaryInput = {
      intent: 'PURCHASE_INTEREST',
      evidence: [{
        content: 'I want to buy the keratin service.',
        evidenceTypes: ['PURCHASE_INTENT', 'ITEM_OR_SERVICE', 'COMMITMENT'],
      }],
    };
    await expect(runLeadSummaryWorker(evidence, async () => ({
      summary: 'Customer wants to buy the keratin service.',
      keyFacts: [{ label: 'Service', value: 'keratin' }],
      constraints: [],
      missingImportantInfo: ['DATE_OR_TIME', 'BUDGET'],
    }))).resolves.toMatchObject({
      missingImportantInfo: ['DATE_OR_TIME', 'BUDGET'],
    });
  });

  it('passes only selected Lead evidence and excludes unrelated conversation noise', async () => {
    const executor = vi.fn().mockResolvedValue({
      summary: 'Customer wants an automatic Clio.',
      keyFacts: [{ label: 'Vehicle', value: 'automatic Clio' }],
      constraints: [],
      missingImportantInfo: ['DATE_OR_TIME', 'QUANTITY_OR_DURATION', 'BUDGET'],
    });
    await runLeadSummaryWorker({
      intent: 'PURCHASE_INTEREST',
      evidence: [{
        content: 'I want an automatic Clio.',
        evidenceTypes: ['PURCHASE_INTENT', 'ITEM_OR_SERVICE', 'COMMITMENT'],
      }],
    }, executor);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      evidence: [expect.objectContaining({ content: 'I want an automatic Clio.' })],
    }));
  });

  it('rejects malformed output and concrete facts absent from evidence', async () => {
    await expect(runLeadSummaryWorker(completeEvidence, async () => ({ summary: 'Incomplete' })))
      .rejects.toBeDefined();
    await expect(runLeadSummaryWorker(completeEvidence, async () => ({
      summary: 'Customer wants the Clio on Friday with a 2500 MAD budget.',
      keyFacts: [],
      constraints: [],
      missingImportantInfo: [],
    }))).rejects.toThrow('concrete fact');
    await expect(runLeadSummaryWorker(completeEvidence, async () => ({
      summary: 'Customer wants a Renault Clio.',
      keyFacts: [{ label: 'Vehicle', value: 'Renault Clio' }],
      constraints: [],
      missingImportantInfo: [],
    }))).rejects.toThrow('key fact');
  });

  it('surfaces provider failures and disallows lifecycle mutation fields', async () => {
    await expect(runLeadSummaryWorker(completeEvidence, async () => {
      throw new Error('Provider unavailable');
    })).rejects.toThrow('Provider unavailable');

    await expect(runLeadSummaryWorker(completeEvidence, async () => ({
      summary: 'Customer wants an automatic Clio.',
      keyFacts: [],
      constraints: [],
      missingImportantInfo: [],
      status: 'WON',
    }))).rejects.toBeDefined();
  });

  it('builds a grounded provisional summary without inventing extracted facts', () => {
    expect(buildProvisionalLeadSummary({
      intent: 'PURCHASE_INTEREST',
      evidence: [{
        content: 'I want to rent a car for 4 days',
        evidenceTypes: ['PURCHASE_INTENT', 'ITEM_OR_SERVICE', 'QUANTITY_OR_DURATION', 'COMMITMENT'],
      }],
    })).toEqual({
      summary: 'Customer evidence: I want to rent a car for 4 days',
      keyFacts: [],
      constraints: [],
      missingImportantInfo: ['DATE_OR_TIME', 'BUDGET'],
    });
  });
});
