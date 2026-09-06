import { z } from 'zod';
import type { FreshnessStatus } from '../business-data/freshness';

export const businessInformationCheckSchema = z.object({
  status: z.enum(['FOUND', 'MISSING', 'UNAVAILABLE', 'INVALID_QUERY']),
  freshnessStatus: z.enum(['FRESH', 'STALE', 'UNKNOWN']),
}).strict();

export type BusinessInformationCheck = z.infer<typeof businessInformationCheckSchema>;

// Freshness is calculated by the existing provider. This checker only aggregates those
// trusted statuses into one explicit model-facing known/stale/unknown result.
export const checkBusinessInformation = (
  status: BusinessInformationCheck['status'],
  freshnessStatuses: readonly FreshnessStatus[] = [],
): BusinessInformationCheck => {
  if (status !== 'FOUND') {
    return businessInformationCheckSchema.parse({ status, freshnessStatus: 'UNKNOWN' });
  }
  const freshnessStatus: FreshnessStatus = freshnessStatuses.includes('STALE')
    ? 'STALE'
    : freshnessStatuses.includes('UNKNOWN')
      ? 'UNKNOWN'
      : 'FRESH';
  return businessInformationCheckSchema.parse({ status, freshnessStatus });
};
