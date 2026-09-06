import { z } from 'zod';

export const agentIntentSchema = z.enum([
  'GENERAL_QUESTION', 'BUSINESS_INFORMATION', 'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY', 'BOOKING_INTENT', 'HUMAN_REQUEST', 'COMPLAINT', 'UNKNOWN',
]);
export type AgentIntent = z.infer<typeof agentIntentSchema>;

export const agentReasonCodeSchema = z.enum([
  'NONE', 'CLARIFICATION_NEEDED', 'MISSING_INFORMATION', 'STALE_INFORMATION',
  'CUSTOMER_REQUESTED_HUMAN', 'POLICY_REQUIRES_HUMAN', 'UNSUPPORTED_ACTION',
]);
export type AgentReasonCode = z.infer<typeof agentReasonCodeSchema>;

export const agentLanguageSchema = z.enum([
  'darija-arabic', 'darija-latin', 'ar', 'fr', 'en', 'mixed', 'other',
]);
export type AgentLanguage = z.infer<typeof agentLanguageSchema>;

export const agentResultSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  needsHuman: z.boolean(),
  detectedIntent: agentIntentSchema,
  reasonCode: agentReasonCodeSchema,
  detectedLanguage: agentLanguageSchema,
}).strict();

export type AgentResult = z.infer<typeof agentResultSchema>;

export const normalizeAgentReply = (value: unknown): string => {
  const reply = z.string().parse(value).trim();
  if (!reply) throw new Error('The model did not produce a customer-facing reply.');
  if (reply.length <= 4000) return reply;

  let normalized = '';
  for (const character of reply) {
    if (normalized.length + character.length > 3999) break;
    normalized += character;
  }
  return `${normalized.trimEnd()}…`;
};
