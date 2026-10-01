import { describe, expect, it } from 'vitest';
import { estimateAiCostUsd } from '../src/analytics/ai-usage.service';

describe('AI usage cost estimation', () => {
  it('calculates cost only from a trusted pricing catalog', () => {
    const cost = estimateAiCostUsd('provider', 'model', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    }, {
      'provider:model': {
        inputUsdPerMillionTokens: '1.25',
        outputUsdPerMillionTokens: '2.50',
      },
    });
    expect(cost?.toFixed(8)).toBe('2.50000000');
  });

  it('returns unknown rather than inventing price or incomplete token data', () => {
    expect(estimateAiCostUsd('openrouter', 'openrouter/free', {
      inputTokens: 100,
      outputTokens: 50,
    })).toBeNull();
    expect(estimateAiCostUsd('provider', 'model', { inputTokens: 100 }, {
      'provider:model': {
        inputUsdPerMillionTokens: '1',
        outputUsdPerMillionTokens: '1',
      },
    })).toBeNull();
  });
});
