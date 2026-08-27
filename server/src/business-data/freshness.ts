import type { FreshnessClass } from '../generated/prisma/client';

export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN';

export interface FreshnessInput {
  freshnessClass: FreshnessClass;
  lastVerifiedAt: Date | null;
  staleAfterSeconds: number | null;
  updatedAt?: Date;
}

export const getFreshnessStatus = (
  input: FreshnessInput,
  now: Date = new Date(),
): FreshnessStatus => {
  if (!input.lastVerifiedAt) {
    return 'UNKNOWN';
  }

  if (input.staleAfterSeconds === null) {
    return 'FRESH';
  }

  const expiresAt =
    input.lastVerifiedAt.getTime() + input.staleAfterSeconds * 1_000;

  return now.getTime() < expiresAt ? 'FRESH' : 'STALE';
};

export const isStaleFromStatus = (
  status: FreshnessStatus,
): boolean | null => (status === 'UNKNOWN' ? null : status === 'STALE');
