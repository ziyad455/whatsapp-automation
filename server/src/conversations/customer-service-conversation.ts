import type { AgentResult } from '../ai/agent-result';
import {
  runCustomerServiceAgent,
  type CustomerServiceAgentInput,
} from '../ai/customer-service-agent';
import {
  conversationMessageSchema,
  HISTORY_MESSAGE_LIMIT,
} from '../ai/conversation-context';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  createTenantConversationRepository,
  type TenantConversationRepository,
} from './tenant-conversation.repository';
import type { ConversationReference } from './conversation.service';

export type CustomerServiceRuntime = (
  input: CustomerServiceAgentInput,
) => Promise<AgentResult>;

export interface CustomerServiceConversationDependencies {
  readonly runCustomerService?: CustomerServiceRuntime;
  readonly createRepository?: (
    tenant: TenantContext,
  ) => TenantConversationRepository;
}

export interface CustomerServiceConversationResult {
  readonly conversationId: string;
  readonly result: AgentResult;
}

export const runCustomerServiceConversation = async (
  input: {
    readonly tenant: TenantContext;
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
  const runtime = dependencies.runCustomerService ?? runCustomerServiceAgent;
  const result = await runtime({
    tenant: input.tenant,
    message: customerMessage.content,
    history,
  });

  await repository.appendMessage(
    input.conversation.id,
    'ASSISTANT',
    result.reply,
  );

  return { conversationId: input.conversation.id, result };
};
