import type { AgentResult } from '../ai/agent-result';
import {
  runCustomerServiceAgentWithDiagnostics,
  type CustomerServiceAgentDetailedResult,
  type CustomerServiceAgentInput,
} from '../ai/customer-service-agent';
import {
  pendingCustomerActionsSchema,
  type PendingCustomerAction,
} from '../ai/customer-capabilities';
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

export interface GeneratedCustomerServiceReply {
  readonly result: AgentResult;
  readonly offeredActions: readonly PendingCustomerAction[];
}

const assertConversationTenant = (
  tenant: TenantScope,
  conversation: ConversationReference,
): void => {
  if (conversation.businessId !== tenant.businessId) {
    throw new Error('Conversation does not belong to the authorized business.');
  }
};

export const generateCustomerServiceReply = async (
  input: {
    readonly tenant: TenantScope;
    readonly conversation: ConversationReference;
    readonly message: string;
    readonly customerMessageId: string;
  },
  dependencies: CustomerServiceConversationDependencies = {},
): Promise<GeneratedCustomerServiceReply> => {
  assertConversationTenant(input.tenant, input.conversation);
  const customerInput = conversationMessageSchema.parse({
    role: 'user',
    content: input.message,
  });
  const repository = (dependencies.createRepository ?? createTenantConversationRepository)(
    input.tenant,
  );
  const persistedHistory = await repository.listRecentMessages(
    input.conversation.id,
    HISTORY_MESSAGE_LIMIT,
    input.customerMessageId,
  );
  const history = {
    businessId: input.tenant.businessId,
    messages: persistedHistory.map(message => ({
      role: message.senderType === 'CUSTOMER' ? 'user' as const : 'assistant' as const,
      content: message.content,
    })),
  };
  const runtime = dependencies.runCustomerService ?? runCustomerServiceAgentWithDiagnostics;
  const runtimeOutput = await runtime({
    tenant: input.tenant,
    conversationId: input.conversation.id,
    message: customerInput.content,
    history,
    pendingActions: pendingCustomerActionsSchema.parse(
      input.conversation.pendingActions,
    ),
  });
  const detailed = 'result' in runtimeOutput;

  return {
    result: detailed ? runtimeOutput.result : runtimeOutput,
    offeredActions: detailed
      ? pendingCustomerActionsSchema.parse(runtimeOutput.offeredActions)
      : [],
  };
};

export const runCustomerServiceConversation = async (
  input: {
    readonly tenant: TenantScope;
    readonly conversation: ConversationReference;
    readonly message: string;
  },
  dependencies: CustomerServiceConversationDependencies = {},
): Promise<CustomerServiceConversationResult> => {
  assertConversationTenant(input.tenant, input.conversation);
  const customerInput = conversationMessageSchema.parse({
    role: 'user',
    content: input.message,
  });
  const repository = (dependencies.createRepository ?? createTenantConversationRepository)(
    input.tenant,
  );
  const customerMessage = await repository.appendMessage(
    input.conversation.id,
    { senderType: 'CUSTOMER', content: customerInput.content },
  );
  const generated = await generateCustomerServiceReply({
    tenant: input.tenant,
    conversation: input.conversation,
    message: customerMessage.content,
    customerMessageId: customerMessage.id,
  }, { ...dependencies, createRepository: () => repository });

  await repository.appendMessage(
    input.conversation.id,
    {
      senderType: 'AI',
      content: generated.result.reply,
      pendingActions: generated.offeredActions,
    },
  );

  return { conversationId: input.conversation.id, result: generated.result };
};
