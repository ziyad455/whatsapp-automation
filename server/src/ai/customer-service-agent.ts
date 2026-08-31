import type { MessageListInput } from '@mastra/core/agent/message-list';
import { RequestContext } from '@mastra/core/request-context';
import {
  customerServiceAgent,
  customerServiceTenantContextSchema,
  type CustomerServiceRequestContext,
} from '../mastra/agents/customer-service-agent';
import { TENANT_CONTEXT_KEY, type TenantContext } from '../tenancy/tenant-context';

export interface CustomerServiceAgentInput {
  readonly tenant: TenantContext;
  readonly messages: MessageListInput;
}

export interface CustomerServiceAgentExecution {
  readonly messages: MessageListInput;
  readonly requestContext: RequestContext<CustomerServiceRequestContext>;
}

const executeCustomerServiceAgent = (execution: CustomerServiceAgentExecution) =>
  customerServiceAgent.generate(execution.messages, {
    requestContext: execution.requestContext,
    tracingOptions: {
      requestContextKeys: [`${TENANT_CONTEXT_KEY}.businessId`],
    },
  });

export type CustomerServiceAgentResult = Awaited<
  ReturnType<typeof executeCustomerServiceAgent>
>;

export type CustomerServiceAgentExecutor<TResult> = (
  execution: CustomerServiceAgentExecution,
) => Promise<TResult>;

const createCustomerServiceRequestContext = (
  tenant: TenantContext,
): RequestContext<CustomerServiceRequestContext> => {
  const validatedTenant = customerServiceTenantContextSchema.parse(tenant);

  return new RequestContext<CustomerServiceRequestContext>([
    [TENANT_CONTEXT_KEY, validatedTenant],
  ]);
};

export function runCustomerServiceAgent(
  input: CustomerServiceAgentInput,
): Promise<CustomerServiceAgentResult>;
export function runCustomerServiceAgent<TResult>(
  input: CustomerServiceAgentInput,
  executor: CustomerServiceAgentExecutor<TResult>,
): Promise<TResult>;
export async function runCustomerServiceAgent<TResult>(
  input: CustomerServiceAgentInput,
  executor?: CustomerServiceAgentExecutor<TResult>,
): Promise<CustomerServiceAgentResult | TResult> {
  const execution: CustomerServiceAgentExecution = {
    messages: input.messages,
    requestContext: createCustomerServiceRequestContext(input.tenant),
  };

  if (executor) {
    return executor(execution);
  }

  return executeCustomerServiceAgent(execution);
}
