import type { AgentResult } from '../ai/agent-result';
import type { ConversationHandoffReason } from '../generated/prisma/client';

export const determineHandoffReason = (
  result: AgentResult,
): ConversationHandoffReason | null => {
  if (result.detectedIntent === 'OUT_OF_SCOPE') return null;
  if (
    result.detectedIntent === 'HUMAN_REQUEST' ||
    result.reasonCode === 'CUSTOMER_REQUESTED_HUMAN'
  ) {
    return 'CUSTOMER_REQUEST';
  }
  if (result.detectedIntent === 'COMPLAINT') return 'COMPLAINT';
  if (
    result.detectedIntent === 'BOOKING_INTENT' ||
    result.detectedIntent === 'PURCHASE_INTENT'
  ) return 'PURCHASE_INTENT';
  if (
    result.needsHuman ||
    ['MISSING_INFORMATION', 'STALE_INFORMATION', 'POLICY_REQUIRES_HUMAN']
      .includes(result.reasonCode)
  ) {
    return 'LOW_CONFIDENCE';
  }
  return null;
};
