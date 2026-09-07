import { z } from 'zod';

export const customerServiceToolNameSchema = z.enum([
  'getBusinessProfile',
  'getOpeningHours',
  'getBusinessRules',
  'listEntityTypes',
  'searchBusinessEntities',
  'getBusinessEntity',
]);

export const agentToolCallDiagnosticSchema = z.object({
  tool: customerServiceToolNameSchema,
  outcome: z.enum(['FOUND', 'MISSING', 'UNAVAILABLE', 'INVALID_QUERY']),
  freshness: z.enum(['FRESH', 'STALE', 'UNKNOWN']).nullable(),
}).strict();

export const agentDiagnosticsSchema = z.object({
  scope: z.enum(['BUSINESS_RELATED', 'OUT_OF_SCOPE']),
  generationBypassed: z.boolean(),
  partiallyRelated: z.boolean(),
  toolCalls: z.array(agentToolCallDiagnosticSchema).max(8),
}).strict();

export type CustomerServiceToolName = z.infer<typeof customerServiceToolNameSchema>;
export type AgentToolCallDiagnostic = z.infer<typeof agentToolCallDiagnosticSchema>;
export type AgentDiagnostics = z.infer<typeof agentDiagnosticsSchema>;
