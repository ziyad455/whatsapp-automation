import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { BusinessUserRole } from '../generated/prisma/enums';
import { TENANT_CONTEXT_KEY, type TenantContext } from '../tenancy/tenant-context';
import type { BusinessDataProvider } from '../business-data/business-data-provider';
import type { BusinessContext } from './business-context';
import { agentCandidateSchema, agentResultSchema, type AgentResult } from './agent-result';

export const customerServiceTenantContextSchema = z.object({
  userId: z.uuid(), businessId: z.uuid(), membershipId: z.uuid(), role: z.enum(BusinessUserRole),
}).strict().readonly() satisfies z.ZodType<TenantContext>;
export const customerServiceRequestContextSchema = z.object({
  [TENANT_CONTEXT_KEY]: customerServiceTenantContextSchema,
});
export type CustomerServiceRequestContext = z.output<typeof customerServiceRequestContextSchema>;

export const AI_RUN_KEY = 'customer-service-run';
export interface FactReceipt {
  reference: string;
  status: 'FRESH' | 'STALE' | 'UNKNOWN';
  kind: 'entities' | 'rules' | 'opening_hours';
}

// A server-created capability, not serializable client configuration. Private fields keep
// provider and evidence out of RequestContext snapshots. Each invocation creates its own instance.
export class CustomerServiceRun {
  #provider: BusinessDataProvider;
  #receipts = new Map<string, FactReceipt>();
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
  finish(value: unknown): AgentResult {
    const candidate = agentCandidateSchema.parse(value);
    const references = candidate.factReferences.map(reference => {
      const receipt = this.#receipts.get(reference);
      if (!receipt) throw new Error('Agent returned unsupported fact references.');
      return receipt;
    });
    if (references.some(receipt => receipt.status !== 'FRESH') &&
      !['STALE_INFORMATION', 'MISSING_INFORMATION'].includes(candidate.reasonCode)) {
      throw new Error('Agent presented unverified facts without an uncertainty signal.');
    }
    if (['PRICE_INQUIRY', 'AVAILABILITY_INQUIRY'].includes(candidate.detectedIntent) &&
      candidate.reasonCode === 'NONE' &&
      !references.some(receipt => receipt.kind === 'entities' && receipt.status === 'FRESH')) {
      throw new Error('Current factual answers require fresh tool evidence.');
    }
    if (candidate.detectedIntent === 'HUMAN_REQUEST' ||
      ['CUSTOMER_REQUESTED_HUMAN', 'POLICY_REQUIRES_HUMAN', 'UNSUPPORTED_ACTION'].includes(candidate.reasonCode)) {
      candidate.needsHuman = true;
      if (candidate.detectedIntent === 'HUMAN_REQUEST') candidate.reasonCode = 'CUSTOMER_REQUESTED_HUMAN';
    }
    const { factReferences: _references, ...result } = candidate;
    return agentResultSchema.parse(result);
  }
  close(): void { this.#closed = true; this.#receipts.clear(); }
}

export const requireCustomerServiceRun = (context: Pick<RequestContext, 'getRaw'> | undefined): CustomerServiceRun => {
  const tenant = customerServiceTenantContextSchema.parse(context?.getRaw(TENANT_CONTEXT_KEY));
  const run = context?.getRaw(AI_RUN_KEY);
  if (!(run instanceof CustomerServiceRun)) throw new Error('Authorized AI runtime context is required.');
  run.authorize(tenant);
  return run;
};
