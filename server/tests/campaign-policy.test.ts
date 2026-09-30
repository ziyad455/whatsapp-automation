import { describe, expect, it } from 'vitest';
import {
  evaluateCampaignRecipientEligibility,
  type CampaignEligibilityInput,
} from '../src/reactivation/campaign-compliance';
import { renderCampaignTemplate } from '../src/reactivation/campaign.service';

const eligible: CampaignEligibilityInput = {
  businessActive: true,
  connectionActive: true,
  consentAt: new Date('2026-01-01T00:00:00Z'),
  optedOutAt: null,
  templateName: 'customer_return_offer',
  templateStatus: 'APPROVED',
  templateCategory: 'MARKETING',
  customerEligible: true,
  promotionalMessagesInWindow: 0,
};

describe('campaign compliance guard', () => {
  it('requires consent, honors later opt-out, and fails closed on template state', () => {
    expect(evaluateCampaignRecipientEligibility(eligible)).toBe('ELIGIBLE');
    expect(evaluateCampaignRecipientEligibility({ ...eligible, consentAt: null }))
      .toBe('NO_VALID_CONSENT');
    expect(evaluateCampaignRecipientEligibility({
      ...eligible,
      optedOutAt: new Date('2026-01-02T00:00:00Z'),
    })).toBe('OPTED_OUT');
    expect(evaluateCampaignRecipientEligibility({ ...eligible, templateName: null }))
      .toBe('TEMPLATE_REQUIRED');
    expect(evaluateCampaignRecipientEligibility({ ...eligible, templateStatus: 'UNVERIFIED' }))
      .toBe('TEMPLATE_UNAVAILABLE');
    expect(evaluateCampaignRecipientEligibility({
      ...eligible,
      templateStatus: 'REJECTED',
    })).toBe('TEMPLATE_NOT_APPROVED');
  });

  it('blocks inactive businesses, connections, customers, and frequency violations', () => {
    expect(evaluateCampaignRecipientEligibility({ ...eligible, businessActive: false }))
      .toBe('BUSINESS_INACTIVE');
    expect(evaluateCampaignRecipientEligibility({ ...eligible, connectionActive: false }))
      .toBe('CONNECTION_INACTIVE');
    expect(evaluateCampaignRecipientEligibility({ ...eligible, customerEligible: false }))
      .toBe('CUSTOMER_INELIGIBLE');
    expect(evaluateCampaignRecipientEligibility({
      ...eligible,
      promotionalMessagesInWindow: 1,
    })).toBe('FREQUENCY_LIMIT');
  });

  it('renders only complete positional template parameters', () => {
    expect(renderCampaignTemplate('Hello {{1}}, your {{2}} is ready.', ['Sam', 'car']))
      .toBe('Hello Sam, your car is ready.');
    expect(() => renderCampaignTemplate('Hello {{2}}.', ['Sam']))
      .toThrow('Template placeholders must be sequential');
    expect(() => renderCampaignTemplate('Hello.', ['unused']))
      .toThrow('Template placeholders must be sequential');
  });
});
