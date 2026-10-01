import { z } from 'zod';
import { TENANT_CONTEXT_KEY } from '../tenancy/tenant-context';
import type { TenantScope } from '../tenancy/tenant-context';
import {
  LEAD_SUMMARY_MODEL,
  LEAD_SUMMARY_PROVIDER,
  leadSummaryWorker,
} from '../mastra/agents/lead-summary-worker';
import { RequestContext } from '@mastra/core/request-context';
import { recordAiUsageSafely } from '../analytics/ai-usage.service';

export const leadSummarySchema = z.object({
  summary: z.string().trim().min(1).max(500),
  keyFacts: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(160),
  }).strict()).max(8),
  constraints: z.array(z.string().trim().min(1).max(160)).max(6),
  missingImportantInfo: z.array(z.enum([
    'ITEM_OR_SERVICE',
    'DATE_OR_TIME',
    'QUANTITY_OR_DURATION',
    'BUDGET',
  ])).max(4),
}).strict();

export type LeadSummary = z.infer<typeof leadSummarySchema>;

export const leadSummaryEvidenceSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  evidenceTypes: z.array(z.enum([
    'PURCHASE_INTENT',
    'BOOKING_INTENT',
    'ITEM_OR_SERVICE',
    'DATE_OR_TIME',
    'BUDGET',
    'QUANTITY_OR_DURATION',
    'COMMITMENT',
  ])).min(1),
}).strict();

export const leadSummaryInputSchema = z.object({
  intent: z.enum([
    'INFORMATION',
    'PURCHASE_INTEREST',
    'BOOKING_INTEREST',
    'COMPLAINT',
    'SUPPORT',
  ]),
  evidence: z.array(leadSummaryEvidenceSchema).min(1).max(12),
}).strict();

export type LeadSummaryInput = z.infer<typeof leadSummaryInputSchema>;
export interface LeadSummaryExecutionContext {
  readonly tenant: TenantScope;
  readonly leadId: string;
  readonly conversationId: string;
}
export type LeadSummaryExecutor = (
  input: LeadSummaryInput,
  context?: LeadSummaryExecutionContext,
) => Promise<unknown>;

const IMPORTANT_EVIDENCE_TYPES = [
  'ITEM_OR_SERVICE',
  'DATE_OR_TIME',
  'QUANTITY_OR_DURATION',
  'BUDGET',
] as const;

export const buildProvisionalLeadSummary = (input: LeadSummaryInput): LeadSummary => {
  const trustedInput = leadSummaryInputSchema.parse(input);
  const evidenceTypes = new Set(
    trustedInput.evidence.flatMap(item => item.evidenceTypes),
  );
  const evidence = [...new Set(trustedInput.evidence.map(item =>
    item.content.replace(/\s+/gu, ' ').trim(),
  ))].join(' | ');
  const prefix = 'Customer evidence: ';

  return leadSummarySchema.parse({
    summary: `${prefix}${evidence.slice(0, 500 - prefix.length)}`,
    keyFacts: [],
    constraints: [],
    missingImportantInfo: IMPORTANT_EVIDENCE_TYPES.filter(type =>
      !evidenceTypes.has(type),
    ),
  });
};

const CONCRETE_WORDS = new Set([
  'mad', 'dhs', 'dh', 'dirham', 'dirhams',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'today', 'tomorrow', 'morning', 'afternoon', 'evening',
  'aujourd', 'hui', 'demain', 'matin', 'soir',
  'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد',
  'اليوم', 'غدا', 'غداً', 'صباح', 'مساء',
]);

const FACT_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'from', 'with', 'to', 'on', 'at',
  'day', 'days', 'week', 'weeks', 'month', 'months',
  'un', 'une', 'le', 'la', 'les', 'de', 'des', 'du', 'et', 'ou', 'pour', 'avec', 'à',
  'jour', 'jours', 'semaine', 'semaines', 'mois',
  'من', 'في', 'على', 'و', 'أو', 'مع', 'لمدة', 'يوم', 'أيام', 'ايام',
]);

const lexicalTokens = (value: string): Set<string> => new Set(
  value.normalize('NFKC').toLocaleLowerCase()
    .replace(/(\d)[,\u00a0 ](?=\d{3}\b)/gu, '$1')
    .match(/[\p{L}\p{N}]+/gu) ?? [],
);

const concreteTokens = (value: string): Set<string> => new Set(
  (value.normalize('NFKC').toLocaleLowerCase()
    .replace(/(\d)[,\u00a0 ](?=\d{3}\b)/gu, '$1')
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => /^\d+$/u.test(token) || CONCRETE_WORDS.has(token)),
);

const assertConcreteFactsAreGrounded = (
  summary: LeadSummary,
  input: LeadSummaryInput,
): void => {
  const evidenceTokens = concreteTokens(input.evidence.map(item => item.content).join(' '));
  const outputText = [
    summary.summary,
    ...summary.keyFacts.flatMap(fact => [fact.label, fact.value]),
    ...summary.constraints,
  ].join(' ');

  for (const token of concreteTokens(outputText)) {
    if (!evidenceTokens.has(token)) {
      throw new Error('Lead summary contains a concrete fact not present in evidence.');
    }
  }

  const evidenceLexicon = lexicalTokens(input.evidence.map(item => item.content).join(' '));
  const groundedValues = [
    ...summary.keyFacts.map(fact => fact.value),
    ...summary.constraints,
  ];
  for (const value of groundedValues) {
    for (const token of lexicalTokens(value)) {
      if (token.length > 2 && !FACT_STOP_WORDS.has(token) && !evidenceLexicon.has(token)) {
        throw new Error('Lead summary key fact is not grounded in supplied evidence.');
      }
    }
  }
};

export const executeLeadSummaryWorker: LeadSummaryExecutor = async (input, context) => {
  if (!context) throw new Error('Lead summary execution requires trusted tenant context.');
  const requestContext = new RequestContext([[TENANT_CONTEXT_KEY, context.tenant]]);
  const startedAt = Date.now();
  try {
    const result = await leadSummaryWorker.generate([
      {
        role: 'user',
        content: `Summarize this authorized lead evidence as structured staff-facing data:\n${JSON.stringify(input)}`,
      },
    ], {
      requestContext,
      structuredOutput: {
        schema: leadSummarySchema,
        errorStrategy: 'strict',
        jsonPromptInjection: 'auto',
      },
      maxSteps: 1,
      abortSignal: AbortSignal.timeout(30_000),
      modelSettings: { maxOutputTokens: 700 },
      tracingOptions: {
        requestContextKeys: [`${TENANT_CONTEXT_KEY}.businessId`],
        hideInput: true,
        hideOutput: true,
      },
    });
    await recordAiUsageSafely({
      tenant: context.tenant,
      leadId: context.leadId,
      conversationId: context.conversationId,
      operation: 'LEAD_SUMMARY',
      provider: LEAD_SUMMARY_PROVIDER,
      model: result.response.modelId || LEAD_SUMMARY_MODEL,
      status: 'SUCCESS',
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    });
    return result.object;
  } catch (error) {
    await recordAiUsageSafely({
      tenant: context.tenant,
      leadId: context.leadId,
      conversationId: context.conversationId,
      operation: 'LEAD_SUMMARY',
      provider: LEAD_SUMMARY_PROVIDER,
      model: LEAD_SUMMARY_MODEL,
      status: 'FAILED',
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error;
  }
};

export const runLeadSummaryWorker = async (
  input: LeadSummaryInput,
  executor: LeadSummaryExecutor = executeLeadSummaryWorker,
  context?: LeadSummaryExecutionContext,
): Promise<LeadSummary> => {
  const trustedInput = leadSummaryInputSchema.parse(input);
  const output = context
    ? await executor(trustedInput, context)
    : await executor(trustedInput);
  const summary = leadSummarySchema.parse(output);
  assertConcreteFactsAreGrounded(summary, trustedInput);
  return summary;
};
