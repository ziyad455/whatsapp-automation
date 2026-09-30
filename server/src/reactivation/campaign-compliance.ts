export const campaignEligibilityReasonCodes = [
  'ELIGIBLE',
  'OPTED_OUT',
  'NO_VALID_CONSENT',
  'TEMPLATE_REQUIRED',
  'TEMPLATE_UNAVAILABLE',
  'TEMPLATE_NOT_APPROVED',
  'WINDOW_RESTRICTION',
  'CUSTOMER_INELIGIBLE',
  'BUSINESS_INACTIVE',
  'CONNECTION_INACTIVE',
  'FREQUENCY_LIMIT',
  'OTHER_COMPLIANCE_BLOCK',
] as const;

export type CampaignEligibilityReason = typeof campaignEligibilityReasonCodes[number];

export interface CampaignEligibilityInput {
  readonly businessActive: boolean;
  readonly connectionActive: boolean;
  readonly consentAt: Date | null;
  readonly optedOutAt: Date | null;
  readonly templateName: string | null;
  readonly templateStatus: 'UNVERIFIED' | 'APPROVED' | 'REJECTED';
  readonly templateCategory: string | null;
  readonly customerEligible: boolean;
  readonly promotionalMessagesInWindow: number;
}

export const evaluateCampaignRecipientEligibility = (
  input: CampaignEligibilityInput,
): CampaignEligibilityReason => {
  if (input.optedOutAt && (!input.consentAt || input.optedOutAt >= input.consentAt)) {
    return 'OPTED_OUT';
  }
  if (!input.consentAt) return 'NO_VALID_CONSENT';
  if (!input.businessActive) return 'BUSINESS_INACTIVE';
  if (!input.connectionActive) return 'CONNECTION_INACTIVE';
  if (!input.customerEligible) return 'CUSTOMER_INELIGIBLE';
  if (!input.templateName) return 'TEMPLATE_REQUIRED';
  if (input.templateStatus === 'UNVERIFIED') return 'TEMPLATE_UNAVAILABLE';
  if (input.templateStatus !== 'APPROVED' || input.templateCategory !== 'MARKETING') {
    return 'TEMPLATE_NOT_APPROVED';
  }
  if (input.promotionalMessagesInWindow >= 1) return 'FREQUENCY_LIMIT';
  return 'ELIGIBLE';
};
