import { z } from 'zod';

export const agentResultSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  needsHuman: z.boolean(),
  detectedIntent: z.enum([
    'GENERAL_QUESTION', 'BUSINESS_INFORMATION', 'PRICE_INQUIRY',
    'AVAILABILITY_INQUIRY', 'BOOKING_INTENT', 'HUMAN_REQUEST', 'COMPLAINT', 'UNKNOWN',
  ]),
  reasonCode: z.enum([
    'NONE', 'CLARIFICATION_NEEDED', 'MISSING_INFORMATION', 'STALE_INFORMATION',
    'CUSTOMER_REQUESTED_HUMAN', 'POLICY_REQUIRES_HUMAN', 'UNSUPPORTED_ACTION',
  ]),
  detectedLanguage: z.enum(['darija-arabic', 'darija-latin', 'ar', 'fr', 'en', 'mixed', 'other']),
}).strict();

export type AgentResult = z.infer<typeof agentResultSchema>;

// References are a run-local validation aid, never database IDs or customer-facing reasoning.
export const agentCandidateSchema = agentResultSchema.extend({
  factReferences: z.array(z.string().max(80)).max(40),
}).strict();
export type AgentCandidate = z.infer<typeof agentCandidateSchema>;
