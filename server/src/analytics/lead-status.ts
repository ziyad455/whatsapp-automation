import type { LeadStatus } from '../generated/prisma/client';

export const ACTIVE_LEAD_STATUSES = [
  'NEW',
  'INTERESTED',
  'QUALIFIED',
] as const satisfies readonly LeadStatus[];

export const TERMINAL_LEAD_STATUSES = [
  'WON',
  'LOST',
] as const satisfies readonly LeadStatus[];

export const LEAD_STATUS_ORDER = [
  ...ACTIVE_LEAD_STATUSES,
  ...TERMINAL_LEAD_STATUSES,
] as const satisfies readonly LeadStatus[];

export const isActiveLeadStatus = (status: LeadStatus): boolean =>
  ACTIVE_LEAD_STATUSES.includes(status as (typeof ACTIVE_LEAD_STATUSES)[number]);
