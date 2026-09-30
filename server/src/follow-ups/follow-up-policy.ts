import { z } from 'zod';

export const followUpSettingsSchema = z.object({
  followUpsEnabled: z.boolean(),
  initialFollowUpDelayMinutes: z.number().int().min(5).max(10_080),
  followUpWindowStartMinutes: z.number().int().min(0).max(1_439),
  followUpWindowEndMinutes: z.number().int().min(0).max(1_439),
  maxFollowUpsPerLead: z.number().int().min(1).max(3),
  minimumFollowUpIntervalMinutes: z.number().int().min(60).max(10_080),
}).strict().refine(value =>
  value.followUpWindowStartMinutes !== value.followUpWindowEndMinutes,
  { path: ['followUpWindowEndMinutes'], message: 'Messaging window must have a non-zero duration.' },
);

export type FollowUpSettings = z.infer<typeof followUpSettingsSchema>;

const OPT_OUT_COMMANDS = new Set([
  'stop', 'unsubscribe', 'opt out', 'please stop messaging me',
  'ne me contactez plus', 'arretez de me contacter',
  'لا تراسلني', 'توقف عن مراسلتي',
]);

export const isExplicitFollowUpOptOut = (message: string): boolean =>
  OPT_OUT_COMMANDS.has(message.normalize('NFKC').trim().toLocaleLowerCase()
    .replace(/[.!؟]+$/gu, '').trim());

export type FollowUpGuardReason =
  | 'ELIGIBLE'
  | 'CUSTOMER_REPLIED'
  | 'LEAD_CLOSED'
  | 'HUMAN_MODE'
  | 'PAUSED'
  | 'CONVERSATION_CLOSED'
  | 'BUSINESS_DISABLED'
  | 'FOLLOWUPS_DISABLED'
  | 'CONSENT_MISSING'
  | 'CUSTOMER_OPTED_OUT'
  | 'QUIET_HOURS'
  | 'FREQUENCY_LIMIT'
  | 'CONNECTION_UNAVAILABLE'
  | 'TEMPLATE_REQUIRED';

export interface FollowUpGuardInput {
  now: Date;
  customerActivityAt: Date;
  latestCustomerMessageAt: Date;
  latestCustomerProviderAt?: Date;
  businessStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  settings: FollowUpSettings;
  timezone: string;
  leadStatus: 'NEW' | 'INTERESTED' | 'QUALIFIED' | 'WON' | 'LOST';
  conversationMode: 'AI' | 'HUMAN' | 'PAUSED';
  conversationStatus: 'OPEN' | 'CLOSED';
  consentAt: Date | null;
  optedOutAt: Date | null;
  connectionActive: boolean;
  sentForLead: number;
  lastCustomerFollowUpAt: Date | null;
}

const localMinutes = (date: Date, timezone: string): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return hour * 60 + minute;
};

export const isWithinMessagingWindow = (
  date: Date,
  timezone: string,
  start: number,
  end: number,
): boolean => {
  const minute = localMinutes(date, timezone);
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
};

export const nextMessagingWindowAt = (
  now: Date,
  timezone: string,
  start: number,
  end: number,
): Date => {
  for (let offset = 0; offset <= 2_880; offset += 1) {
    const candidate = new Date(Math.ceil(now.getTime() / 60_000) * 60_000 + offset * 60_000);
    if (isWithinMessagingWindow(candidate, timezone, start, end)) return candidate;
  }
  throw new Error('No messaging window found in the next two days.');
};

export const evaluateFollowUpGuard = (input: FollowUpGuardInput): FollowUpGuardReason => {
  if (input.businessStatus !== 'ACTIVE') return 'BUSINESS_DISABLED';
  if (!input.settings.followUpsEnabled) return 'FOLLOWUPS_DISABLED';
  if (!input.consentAt) return 'CONSENT_MISSING';
  if (input.optedOutAt && input.optedOutAt >= input.consentAt) return 'CUSTOMER_OPTED_OUT';
  if (input.leadStatus === 'WON' || input.leadStatus === 'LOST') return 'LEAD_CLOSED';
  if (input.conversationStatus !== 'OPEN') return 'CONVERSATION_CLOSED';
  if (input.conversationMode === 'HUMAN') return 'HUMAN_MODE';
  if (input.conversationMode === 'PAUSED') return 'PAUSED';
  if (input.latestCustomerMessageAt > input.customerActivityAt) return 'CUSTOMER_REPLIED';
  if (!input.connectionActive) return 'CONNECTION_UNAVAILABLE';
  if (input.sentForLead >= input.settings.maxFollowUpsPerLead) return 'FREQUENCY_LIMIT';
  if (input.lastCustomerFollowUpAt &&
    input.now.getTime() - input.lastCustomerFollowUpAt.getTime() <
      input.settings.minimumFollowUpIntervalMinutes * 60_000) return 'FREQUENCY_LIMIT';
  // The current transport sends free-form text, not approved Meta templates.
  if (input.now.getTime() >=
    (input.latestCustomerProviderAt ?? input.latestCustomerMessageAt).getTime() + 24 * 60 * 60_000)
    return 'TEMPLATE_REQUIRED';
  if (!isWithinMessagingWindow(input.now, input.timezone,
    input.settings.followUpWindowStartMinutes, input.settings.followUpWindowEndMinutes))
    return 'QUIET_HOURS';
  return 'ELIGIBLE';
};
