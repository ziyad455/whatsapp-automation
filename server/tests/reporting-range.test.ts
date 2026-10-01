import { describe, expect, it } from 'vitest';
import { getBusinessReportingRange } from '../src/analytics/reporting-range';

describe('business reporting ranges', () => {
  it('uses business-local calendar boundaries in Casablanca', () => {
    const range = getBusinessReportingRange(
      'Africa/Casablanca',
      'TODAY',
      new Date('2026-09-30T00:30:00.000Z'),
    );
    expect(range.localStartDate).toBe('2026-09-30');
    expect(range.start.toISOString()).toBe('2026-09-29T23:00:00.000Z');
  });

  it('counts calendar days across a daylight-saving transition', () => {
    const range = getBusinessReportingRange(
      'America/New_York',
      'LAST_7_DAYS',
      new Date('2026-11-02T15:00:00.000Z'),
    );
    expect(range.localStartDate).toBe('2026-10-27');
    expect(range.start.toISOString()).toBe('2026-10-27T04:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });
});
