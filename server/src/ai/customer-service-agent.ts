import { RequestContext } from '@mastra/core/request-context';
import type { MastraLanguageModel } from '@mastra/core/agent';
import { customerServiceAgent } from '../mastra/agents/customer-service-agent';
import { createDatabaseBusinessDataProvider } from '../business-data/database-business-data-provider';
import { TENANT_CONTEXT_KEY, type TenantContext } from '../tenancy/tenant-context';
import { buildBusinessContext, type BusinessDataProviderFactory } from './business-context';
import { buildBusinessInstructions } from './business-instructions';
import { buildConversationMessages, type ConversationHistory, type ConversationMessage } from './conversation-context';
import { type AgentResult } from './agent-result';
import { analyzeCustomerMessage, detectCustomerLanguage } from './customer-message-analysis';
import { AI_RUN_KEY, CustomerServiceRun, customerServiceTenantContextSchema, type CustomerServiceRequestContext } from './request-context';
import type { AgentDiagnostics } from './agent-diagnostics';
import { agentDiagnosticsSchema } from './agent-diagnostics';
import { classifyCustomerScope, createOutOfScopeAgentResult } from './customer-scope';

export interface CustomerServiceAgentInput {
  readonly tenant: TenantContext;
  readonly message: string;
  // Trusted application history; the conversation boundary authorizes its tenant/thread.
  readonly history?: ConversationHistory;
}

export interface CustomerServiceAgentExecution {
  readonly messages: ConversationMessage[];
  readonly requestContext: RequestContext<CustomerServiceRequestContext>;
  readonly instructions: string;
}

export const executeCustomerServiceAgent = async (execution: CustomerServiceAgentExecution, model?: MastraLanguageModel): Promise<string> => {
  const result = await customerServiceAgent.generate(execution.messages, {
    requestContext: execution.requestContext,
    instructions: execution.instructions,
    ...(model ? { model } : {}),
    maxSteps: 6,
    abortSignal: AbortSignal.timeout(60000),
    modelSettings: { maxOutputTokens: 2000 },
    tracingOptions: { requestContextKeys: [`${TENANT_CONTEXT_KEY}.businessId`], hideInput: true, hideOutput: true },
  });
  return result.text;
};

export type CustomerServiceAgentExecutor = (execution: CustomerServiceAgentExecution) => Promise<string>;
export interface CustomerServiceAgentDependencies {
  createProvider?: BusinessDataProviderFactory;
  executor?: CustomerServiceAgentExecutor;
}

export interface CustomerServiceAgentDetailedResult {
  readonly result: AgentResult;
  readonly diagnostics: AgentDiagnostics;
}

export const runCustomerServiceAgentWithDiagnostics = async (
  input: CustomerServiceAgentInput,
  dependencies: CustomerServiceAgentDependencies = {},
): Promise<CustomerServiceAgentDetailedResult> => {
  const tenant = customerServiceTenantContextSchema.parse(input.tenant);
  const originalMessages = buildConversationMessages(tenant, input.message, input.history);
  const scopeDecision = classifyCustomerScope(input.message, input.history);
  const createProvider = dependencies.createProvider ?? createDatabaseBusinessDataProvider;
  const business = await buildBusinessContext(tenant, createProvider);
  if (scopeDecision.scope === 'OUT_OF_SCOPE') {
    return {
      result: createOutOfScopeAgentResult(business, detectCustomerLanguage(input.message)),
      diagnostics: agentDiagnosticsSchema.parse({
        scope: 'OUT_OF_SCOPE',
        generationBypassed: true,
        partiallyRelated: false,
        toolCalls: [],
      }),
    };
  }
  const scopedMessageAnalysis = analyzeCustomerMessage(scopeDecision.modelMessage);
  const messageAnalysis = {
    ...scopedMessageAnalysis,
    detectedLanguage: detectCustomerLanguage(input.message),
  };
  const messages = scopeDecision.modelMessage === input.message
    ? originalMessages
    : buildConversationMessages(tenant, scopeDecision.modelMessage, input.history);
  const instructions = buildBusinessInstructions(business);
  const run = new CustomerServiceRun(tenant, business, createProvider(tenant));
  const requestContext = new RequestContext<CustomerServiceRequestContext>([[TENANT_CONTEXT_KEY, tenant]]);
  requestContext.setRaw(AI_RUN_KEY, run);
  try {
    const value = await (dependencies.executor ?? executeCustomerServiceAgent)({ messages, requestContext, instructions });
    return {
      result: run.finish(value, messageAnalysis),
      diagnostics: run.diagnostics(scopeDecision.partiallyRelated),
    };
  } finally {
    run.close();
    requestContext.deleteRaw(AI_RUN_KEY);
  }
};

export const runCustomerServiceAgent = async (
  input: CustomerServiceAgentInput,
  dependencies: CustomerServiceAgentDependencies = {},
): Promise<AgentResult> => (await runCustomerServiceAgentWithDiagnostics(input, dependencies)).result;
