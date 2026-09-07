import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { BusinessUserRole } from '../generated/prisma/enums';
import { TENANT_CONTEXT_KEY, type TenantContext } from '../tenancy/tenant-context';
import type { BusinessDataProvider } from '../business-data/business-data-provider';
import type { BusinessContext } from './business-context';
import {
  agentResultSchema,
  normalizeAgentReply,
  type AgentIntent,
  type AgentLanguage,
  type AgentReasonCode,
  type AgentResult,
} from './agent-result';
import type { CustomerMessageAnalysis } from './customer-message-analysis';

export const customerServiceTenantContextSchema = z.object({
  userId: z.uuid(), businessId: z.uuid(), membershipId: z.uuid(), role: z.enum(BusinessUserRole),
}).strict().readonly() satisfies z.ZodType<TenantContext>;
export const customerServiceRequestContextSchema = z.object({
  [TENANT_CONTEXT_KEY]: customerServiceTenantContextSchema,
});
export type CustomerServiceRequestContext = z.output<typeof customerServiceRequestContextSchema>;

export const AI_RUN_KEY = 'customer-service-run';
export type BusinessInformationKind =
  | 'profile'
  | 'opening_hours'
  | 'rules'
  | 'entity_types'
  | 'entities';
export interface FactReceipt {
  reference: string;
  status: 'FRESH' | 'STALE' | 'UNKNOWN';
  kind: BusinessInformationKind;
}
export interface FactLookupReceipt {
  status: 'FOUND' | 'MISSING' | 'UNAVAILABLE' | 'INVALID_QUERY';
  kind: BusinessInformationKind;
}

const UNVERIFIED_REPLY: Readonly<Record<AgentLanguage, string>> = {
  'darija-arabic': 'ما عنديش معلومة مؤكدة على هاد الشي دابا. الفريق خاصو يتأكد ليك منها.',
  'darija-latin': "Ma 3ndich confirmation 3la hadchi daba. L'équipe khasha t2kked lik.",
  ar: 'ليست لدي معلومة مؤكدة عن ذلك الآن. سيحتاج الفريق إلى التحقق منها.',
  fr: "Je n'ai pas d'information confirmée là-dessus pour le moment. L'équipe devra vérifier.",
  en: "I don't have confirmed information on that right now. The team will need to check.",
  mixed: "Ma 3ndich confirmation 3la had l'information daba. L'équipe devra vérifier.",
  other: "I don't have confirmed information on that right now. The team will need to check.",
};

// A server-created capability, not serializable client configuration. Private fields keep
// provider and evidence out of RequestContext snapshots. Each invocation creates its own instance.
export class CustomerServiceRun {
  #provider: BusinessDataProvider;
  #receipts = new Map<string, FactReceipt>();
  #lookups: FactLookupReceipt[] = [];
  #tenant: TenantContext;
  #business: BusinessContext;
  #closed = false;
  #calls = 0;

  constructor(tenant: TenantContext, business: BusinessContext, provider: BusinessDataProvider) {
    this.#tenant = tenant;
    this.#business = business;
    this.#provider = provider;
  }

  authorize(tenant: TenantContext): void {
    if (this.#closed || Object.entries(this.#tenant).some(([key, value]) =>
      tenant[key as keyof TenantContext] !== value)) {
      throw new Error('Authorized AI runtime context is required.');
    }
  }

  assertBusinessId(businessId: string): void {
    if (this.#closed || businessId !== this.#tenant.businessId) {
      throw new Error('Authorized AI runtime context is required.');
    }
  }

  get business(): BusinessContext { return this.#business; }
  get provider(): BusinessDataProvider {
    if (this.#closed || ++this.#calls > 8) throw new Error('AI fact lookup budget exceeded.');
    return this.#provider;
  }
  record(status: FactReceipt['status'], kind: FactReceipt['kind']): string {
    const reference = `fact-${this.#receipts.size + 1}`;
    this.#receipts.set(reference, { reference, status, kind });
    return reference;
  }
  recordLookup(status: FactLookupReceipt['status'], kind: FactLookupReceipt['kind']): void {
    this.#lookups.push({ status, kind });
  }
  finish(replyValue: unknown, analysis: CustomerMessageAnalysis): AgentResult {
    const reply = normalizeAgentReply(replyValue);
    const receipts = [...this.#receipts.values()];
    const hasUnverifiedFacts = receipts.some(receipt => receipt.status !== 'FRESH');
    const hasMissingLookup = this.#lookups.some(lookup =>
      ['MISSING', 'UNAVAILABLE', 'INVALID_QUERY'].includes(lookup.status) &&
      !this.#lookups.some(candidate => candidate.kind === lookup.kind && candidate.status === 'FOUND'));
    const hasFreshEntityFacts = receipts.some(receipt =>
      receipt.kind === 'entities' && receipt.status === 'FRESH');

    let detectedIntent: AgentIntent = analysis.detectedIntent;
    if (detectedIntent === 'UNKNOWN' && this.#lookups.length > 0) {
      detectedIntent = 'BUSINESS_INFORMATION';
    }

    let reasonCode: AgentReasonCode = 'NONE';
    let needsHuman = false;
    if (detectedIntent === 'HUMAN_REQUEST') {
      reasonCode = 'CUSTOMER_REQUESTED_HUMAN';
      needsHuman = true;
    } else if (hasUnverifiedFacts) {
      reasonCode = 'STALE_INFORMATION';
      needsHuman = true;
    } else if (hasMissingLookup ||
      (['PRICE_INQUIRY', 'AVAILABILITY_INQUIRY'].includes(detectedIntent) && !hasFreshEntityFacts)) {
      reasonCode = 'MISSING_INFORMATION';
      needsHuman = true;
    } else if (detectedIntent === 'BOOKING_INTENT') {
      reasonCode = 'CLARIFICATION_NEEDED';
    } else if (detectedIntent === 'COMPLAINT') {
      needsHuman = true;
    }

    const safeReply = ['MISSING_INFORMATION', 'STALE_INFORMATION'].includes(reasonCode)
      ? UNVERIFIED_REPLY[analysis.detectedLanguage]
      : reply;

    return agentResultSchema.parse({
      reply: safeReply,
      needsHuman,
      detectedIntent,
      reasonCode,
      detectedLanguage: analysis.detectedLanguage,
    });
  }
  close(): void {
    this.#closed = true;
    this.#receipts.clear();
    this.#lookups.length = 0;
  }
}

export const requireCustomerServiceRun = (context: Pick<RequestContext, 'getRaw'> | undefined): CustomerServiceRun => {
  const tenant = customerServiceTenantContextSchema.parse(context?.getRaw(TENANT_CONTEXT_KEY));
  const run = context?.getRaw(AI_RUN_KEY);
  if (!(run instanceof CustomerServiceRun)) throw new Error('Authorized AI runtime context is required.');
  run.authorize(tenant);
  return run;
};
