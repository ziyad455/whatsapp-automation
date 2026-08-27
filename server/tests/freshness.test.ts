import { describe, expect, it } from 'vitest';
import {
  getFreshnessStatus,
  isStaleFromStatus,
} from '../src/business-data/freshness';

const now = new Date('2026-08-27T12:00:00.000Z');

describe('business-data freshness', () => {
  it('distinguishes fresh, stale, and never-verified values deterministically', () => {
    expect(
      getFreshnessStatus(
        {
          freshnessClass: 'CHANGING',
          lastVerifiedAt: new Date('2026-08-27T11:59:30.000Z'),
          staleAfterSeconds: 60,
          updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('FRESH');

    expect(
      getFreshnessStatus(
        {
          freshnessClass: 'REAL_TIME',
          lastVerifiedAt: new Date('2026-08-27T11:59:00.000Z'),
          staleAfterSeconds: 60,
          updatedAt: now,
        },
        now,
      ),
    ).toBe('STALE');

    expect(
      getFreshnessStatus(
        {
          freshnessClass: 'STABLE',
          lastVerifiedAt: null,
          staleAfterSeconds: null,
          updatedAt: now,
        },
        now,
      ),
    ).toBe('UNKNOWN');
  });

  it('treats a verified fact with no expiry as fresh without inventing a TTL', () => {
    expect(
      getFreshnessStatus(
        {
          freshnessClass: 'STABLE',
          lastVerifiedAt: new Date('2020-01-01T00:00:00.000Z'),
          staleAfterSeconds: null,
        },
        now,
      ),
    ).toBe('FRESH');
  });

  it('does not substitute updatedAt for lastVerifiedAt', () => {
    expect(
      getFreshnessStatus(
        {
          freshnessClass: 'CHANGING',
          lastVerifiedAt: null,
          staleAfterSeconds: 60,
          updatedAt: now,
        },
        now,
      ),
    ).toBe('UNKNOWN');
    expect(isStaleFromStatus('UNKNOWN')).toBeNull();
    expect(isStaleFromStatus('STALE')).toBe(true);
    expect(isStaleFromStatus('FRESH')).toBe(false);
  });
});
