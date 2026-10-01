import { RequestContext } from '@mastra/core/request-context';
import { currentCorrelation } from '../observability/correlation';
import { signalOperationalFailure } from '../observability/operational-alerts';
import type { MastraLanguageModel } from '@mastra/core/agent';
import {
  CUSTOMER_SERVICE_MODEL,
  CUSTOMER_SERVICE_PROVIDER,
  customerServiceAgent,
} from '../mastra/agents/customer-service-agent';
import { recordAiUsageSafely } from '../analytics/ai-usage.service';
import { createDatabaseBusinessDataProvider } from '../business-data/database-business-data-provider';
import { TENANT_CONTEXT_KEY, type TenantScope } from '../tenancy/tenant-context';
import { buildBusinessContext, type BusinessDataProviderFactory } from './business-context';
import { buildBusinessInstructions } from './business-instructions';
import { buildConversationMessages, type ConversationHistory, type ConversationMessage } from './conversation-context';
import { type AgentResult } from './agent-result';
import { analyzeCustomerMessage, detectCustomerLanguage } from './customer-message-analysis';
import { AI_RUN_KEY, CustomerServiceRun, customerServiceTenantContextSchema, type CustomerServiceRequestContext } from './request-context';
import type { AgentDiagnostics } from './agent-diagnostics';
import { agentDiagnosticsSchema } from './agent-diagnostics';
import { classifyCustomerScope, createOutOfScopeAgentResult } from './customer-scope';
import {
  createPendingActionClarification,
  createUnsupportedCapabilityResult,
  detectUnsupportedCapabilityRequest,
  isPendingActionAcceptance,
  pendingCustomerActionsSchema,
  resolveCustomerServiceCapabilities,
  type PendingCustomerAction,
} from './customer-capabilities';
import { customerServiceBusinessTools } from '../mastra/tools/business-information-tools';
import type { CustomerServiceToolName } from './agent-diagnostics';

export interface CustomerServiceAgentInput {
  readonly tenant: TenantScope;
  readonly conversationId?: string;
  readonly message: string;
  // Trusted application history; the conversation boundary authorizes its tenant/thread.
  readonly history?: ConversationHistory;
  // Trusted application state loaded from the authorized conversation.
  readonly pendingActions?: readonly PendingCustomerAction[];
}

export interface CustomerServiceAgentExecution {
  readonly conversationId?: string;
  readonly messages: ConversationMessage[];
  readonly requestContext: RequestContext<CustomerServiceRequestContext>;
  readonly instructions: string;
  readonly capabilities: ReturnType<typeof resolveCustomerServiceCapabilities>;
  readonly acceptedAction?: PendingCustomerAction;
}

export const executeCustomerServiceAgent = async (execution: CustomerServiceAgentExecution, model?: MastraLanguageModel): Promise<string> => {
  const tenant = customerServiceTenantContextSchema.parse(
    execution.requestContext.getRaw(TENANT_CONTEXT_KEY),
  );
  const startedAt = Date.now();
  try {
    const result = await customerServiceAgent.generate(execution.messages, {
      requestContext: execution.requestContext,
      instructions: execution.instructions,
      ...(model ? { model } : {}),
      maxSteps: 6,
      abortSignal: AbortSignal.timeout(60000),
      modelSettings: { maxOutputTokens: 2000 },
      tracingOptions: {
        requestContextKeys: [], hideInput: true, hideOutput: true,
        metadata: { ...currentCorrelation(), businessId: tenant.businessId, conversationId: execution.conversationId, operation: 'CUSTOMER_SERVICE' },
      },
    });
    await recordAiUsageSafely({
      tenant,
      ...(execution.conversationId ? { conversationId: execution.conversationId } : {}),
      operation: 'CUSTOMER_SERVICE',
      provider: CUSTOMER_SERVICE_PROVIDER,
      model: result.response.modelId || CUSTOMER_SERVICE_MODEL,
      status: 'SUCCESS',
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    });
    return result.text;
  } catch (error) {
    signalOperationalFailure('AI_FAILURE', { businessId: tenant.businessId, conversationId: execution.conversationId });
    await recordAiUsageSafely({
      tenant,
      ...(execution.conversationId ? { conversationId: execution.conversationId } : {}),
      operation: 'CUSTOMER_SERVICE',
      provider: CUSTOMER_SERVICE_PROVIDER,
      model: CUSTOMER_SERVICE_MODEL,
      status: 'FAILED',
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error;
  }
};

export type CustomerServiceAgentExecutor = (execution: CustomerServiceAgentExecution) => Promise<string>;
export interface CustomerServiceAgentDependencies {
  createProvider?: BusinessDataProviderFactory;
  executor?: CustomerServiceAgentExecutor;
  enabledTools?: ReadonlySet<CustomerServiceToolName>;
}

export interface CustomerServiceAgentDetailedResult {
  readonly result: AgentResult;
  readonly diagnostics: AgentDiagnostics;
  readonly offeredActions: readonly PendingCustomerAction[];
}

const DEFAULT_ENABLED_TOOLS = new Set(
  Object.keys(customerServiceBusinessTools) as CustomerServiceToolName[],
);

const bypassedDiagnostics = (scope: 'BUSINESS_RELATED' | 'OUT_OF_SCOPE'): AgentDiagnostics =>
  agentDiagnosticsSchema.parse({
    scope,
    generationBypassed: true,
    partiallyRelated: false,
    toolCalls: [],
  });

export const runCustomerServiceAgentWithDiagnostics = async (
  input: CustomerServiceAgentInput,
  dependencies: CustomerServiceAgentDependencies = {},
): Promise<CustomerServiceAgentDetailedResult> => {
  const tenant = customerServiceTenantContextSchema.parse({
    businessId: input.tenant.businessId,
  });
  const originalMessages = buildConversationMessages(tenant, input.message, input.history);
  const pendingActions = pendingCustomerActionsSchema.parse(input.pendingActions ?? []);
  const acceptsPendingAction = pendingActions.length > 0 && isPendingActionAcceptance(input.message);
  const scopeDecision = acceptsPendingAction
    ? { scope: 'BUSINESS_RELATED' as const, modelMessage: input.message, partiallyRelated: false }
    : classifyCustomerScope(input.message, input.history);
  const createProvider = dependencies.createProvider ?? createDatabaseBusinessDataProvider;
  const business = await buildBusinessContext(tenant, createProvider);
  if (scopeDecision.scope === 'OUT_OF_SCOPE') {
    return {
      result: createOutOfScopeAgentResult(business, detectCustomerLanguage(input.message)),
      diagnostics: bypassedDiagnostics('OUT_OF_SCOPE'),
      offeredActions: [],
    };
  }
  const scopedMessageAnalysis = analyzeCustomerMessage(scopeDecision.modelMessage);
  const messageAnalysis = {
    ...scopedMessageAnalysis,
    detectedLanguage: detectCustomerLanguage(input.message),
  };
  const capabilities = resolveCustomerServiceCapabilities(
    dependencies.enabledTools ?? DEFAULT_ENABLED_TOOLS,
  );
  const unsupportedCapability = detectUnsupportedCapabilityRequest(scopeDecision.modelMessage);
  if (unsupportedCapability) {
    return {
      result: createUnsupportedCapabilityResult(
        unsupportedCapability,
        messageAnalysis.detectedLanguage,
        messageAnalysis.detectedIntent,
      ),
      diagnostics: bypassedDiagnostics('BUSINESS_RELATED'),
      offeredActions: [],
    };
  }
  if (acceptsPendingAction && pendingActions.length > 1) {
    return {
      result: createPendingActionClarification(pendingActions, messageAnalysis.detectedLanguage),
      diagnostics: bypassedDiagnostics('BUSINESS_RELATED'),
      offeredActions: pendingActions,
    };
  }
  const acceptedAction = acceptsPendingAction ? pendingActions[0] : undefined;
  const messages = scopeDecision.modelMessage === input.message
    ? originalMessages
    : buildConversationMessages(tenant, scopeDecision.modelMessage, input.history);
  const instructions = buildBusinessInstructions(business, {
    capabilities,
    ...(acceptedAction ? { acceptedAction } : {}),
  });
  const run = new CustomerServiceRun(tenant, business, createProvider(tenant), capabilities);
  const requestContext = new RequestContext<CustomerServiceRequestContext>([[TENANT_CONTEXT_KEY, tenant]]);
  requestContext.setRaw(AI_RUN_KEY, run);
  try {
    const value = await (dependencies.executor ?? executeCustomerServiceAgent)({
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      messages,
      requestContext,
      instructions,
      capabilities,
      ...(acceptedAction ? { acceptedAction } : {}),
    });
    const result = run.finish(value, messageAnalysis);
    return {
      result,
      diagnostics: run.diagnostics(scopeDecision.partiallyRelated),
      offeredActions: run.offeredActions,
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
