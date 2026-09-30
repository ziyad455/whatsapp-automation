import { describe, expect, it } from 'vitest';
import {
  evaluateFollowUpGuard,
  followUpSettingsSchema,
  isWithinMessagingWindow,
  nextMessagingWindowAt,
  isExplicitFollowUpOptOut,
  type FollowUpGuardInput,
} from '../src/follow-ups/follow-up-policy';

const now = new Date('2026-09-22T10:00:00Z');
const settings = followUpSettingsSchema.parse({
  followUpsEnabled: true,
  initialFollowUpDelayMinutes: 60,
  followUpWindowStartMinutes: 540,
  followUpWindowEndMinutes: 1200,
  maxFollowUpsPerLead: 1,
  minimumFollowUpIntervalMinutes: 1440,
});
const eligible: FollowUpGuardInput = {
  now,
  customerActivityAt: new Date('2026-09-22T09:00:00Z'),
  latestCustomerMessageAt: new Date('2026-09-22T09:00:00Z'),
  businessStatus: 'ACTIVE', settings, timezone: 'Africa/Casablanca',
  leadStatus: 'NEW', conversationMode: 'AI', conversationStatus: 'OPEN',
  consentAt: new Date('2026-09-22T08:00:00Z'), optedOutAt: null,
  connectionActive: true, sentForLead: 0, lastCustomerFollowUpAt: null,
};

describe('follow-up policy', () => {
  it('requires explicit consent and valid numeric business settings', () => {
    expect(evaluateFollowUpGuard({ ...eligible, consentAt: null })).toBe('CONSENT_MISSING');
    expect(followUpSettingsSchema.safeParse({ ...settings,
      followUpWindowEndMinutes: settings.followUpWindowStartMinutes }).success).toBe(false);
  });

  it('recognizes explicit opt-out commands without treating normal messages as opt-outs', () => {
    expect(isExplicitFollowUpOptOut('STOP!')).toBe(true);
    expect(isExplicitFollowUpOptOut('Please stop messaging me.')).toBe(true);
    expect(isExplicitFollowUpOptOut('I will stop by tomorrow')).toBe(false);
  });

  it('blocks customer replies, terminal leads, human control, disabled businesses, and frequency', () => {
    expect(evaluateFollowUpGuard(eligible)).toBe('ELIGIBLE');
    expect(evaluateFollowUpGuard({ ...eligible,
      latestCustomerMessageAt: now })).toBe('CUSTOMER_REPLIED');
    expect(evaluateFollowUpGuard({ ...eligible, leadStatus: 'WON' })).toBe('LEAD_CLOSED');
    expect(evaluateFollowUpGuard({ ...eligible, leadStatus: 'LOST' })).toBe('LEAD_CLOSED');
    expect(evaluateFollowUpGuard({ ...eligible, conversationMode: 'HUMAN' })).toBe('HUMAN_MODE');
    expect(evaluateFollowUpGuard({ ...eligible, conversationMode: 'PAUSED' })).toBe('PAUSED');
    expect(evaluateFollowUpGuard({ ...eligible, businessStatus: 'SUSPENDED' })).toBe('BUSINESS_DISABLED');
    expect(evaluateFollowUpGuard({ ...eligible, settings: {
      ...settings, followUpsEnabled: false } })).toBe('FOLLOWUPS_DISABLED');
    expect(evaluateFollowUpGuard({ ...eligible, sentForLead: 1 })).toBe('FREQUENCY_LIMIT');
    expect(evaluateFollowUpGuard({ ...eligible,
      lastCustomerFollowUpAt: new Date('2026-09-22T09:30:00Z') })).toBe('FREQUENCY_LIMIT');
  });

  it('defers by business-local time, including crossing midnight', () => {
    const before = new Date('2026-09-22T06:30:00Z');
    expect(isWithinMessagingWindow(before, 'Africa/Casablanca', 540, 1200)).toBe(false);
    expect(nextMessagingWindowAt(before, 'Africa/Casablanca', 540, 1200).toISOString())
      .toBe('2026-09-22T08:00:00.000Z');
    expect(isWithinMessagingWindow(new Date('2026-09-22T22:30:00Z'),
      'Africa/Casablanca', 1380, 120)).toBe(true);
    expect(isWithinMessagingWindow(new Date('2026-09-22T11:00:00Z'),
      'Africa/Casablanca', 1380, 120)).toBe(false);
  });

  it('fails closed outside the Meta free-form reply window', () => {
    expect(evaluateFollowUpGuard({ ...eligible,
      latestCustomerMessageAt: new Date('2026-09-21T09:00:00Z'),
      customerActivityAt: new Date('2026-09-21T09:00:00Z'),
    })).toBe('TEMPLATE_REQUIRED');
    expect(evaluateFollowUpGuard({ ...eligible,
      latestCustomerProviderAt: new Date('2026-09-21T09:00:00Z'),
    })).toBe('TEMPLATE_REQUIRED');
  });
});
