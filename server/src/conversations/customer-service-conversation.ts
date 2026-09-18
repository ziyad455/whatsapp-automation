import type { AgentResult } from '../ai/agent-result';
import {
  runCustomerServiceAgentWithDiagnostics,
  type CustomerServiceAgentDetailedResult,
  type CustomerServiceAgentInput,
} from '../ai/customer-service-agent';
import { pendingCustomerActionsSchema } from '../ai/customer-capabilities';
import {
  conversationMessageSchema,
  HISTORY_MESSAGE_LIMIT,
} from '../ai/conversation-context';
import type { TenantScope } from '../tenancy/tenant-context';
import {
  createTenantConversationRepository,
  type TenantConversationRepository,
} from './tenant-conversation.repository';
import type { ConversationReference } from './conversation.service';

export type CustomerServiceRuntime = (
  input: CustomerServiceAgentInput,
) => Promise<AgentResult | CustomerServiceAgentDetailedResult>;

export interface CustomerServiceConversationDependencies {
  readonly runCustomerService?: CustomerServiceRuntime;
  readonly createRepository?: (
    tenant: TenantScope,
  ) => TenantConversationRepository;
}

export interface CustomerServiceConversationResult {
  readonly conversationId: string;
  readonly result: AgentResult;
}

export const runCustomerServiceConversation = async (
  input: {
    readonly tenant: TenantScope;
    readonly conversation: ConversationReference;
    readonly message: string;
  },
  dependencies: CustomerServiceConversationDependencies = {},
): Promise<CustomerServiceConversationResult> => {
  if (input.conversation.businessId !== input.tenant.businessId) {
    throw new Error('Conversation does not belong to the authorized business.');
  }

  const customerInput = conversationMessageSchema.parse({
    role: 'user',
    content: input.message,
  });

  const repository = (dependencies.createRepository ?? createTenantConversationRepository)(
    input.tenant,
  );
  const customerMessage = await repository.appendMessage(
    input.conversation.id,
    'CUSTOMER',
    customerInput.content,
  );
  const persistedHistory = await repository.listRecentMessages(
    input.conversation.id,
    HISTORY_MESSAGE_LIMIT,
    customerMessage.id,
  );
  const history = {
    businessId: input.tenant.businessId,
    messages: persistedHistory.map(message => ({
      role: message.role === 'CUSTOMER' ? 'user' as const : 'assistant' as const,
      content: message.content,
    })),
  };
  const runtime = dependencies.runCustomerService ?? runCustomerServiceAgentWithDiagnostics;
  const runtimeOutput = await runtime({
    tenant: input.tenant,
    message: customerMessage.content,
    history,
    pendingActions: pendingCustomerActionsSchema.parse(input.conversation.pendingActions),
  });
  const detailed = 'result' in runtimeOutput;
  const result = detailed ? runtimeOutput.result : runtimeOutput;
  const offeredActions = detailed
    ? pendingCustomerActionsSchema.parse(runtimeOutput.offeredActions)
    : [];

  await repository.appendMessage(
    input.conversation.id,
    'ASSISTANT',
    result.reply,
    { pendingActions: offeredActions },
  );

  return { conversationId: input.conversation.id, result };
};
