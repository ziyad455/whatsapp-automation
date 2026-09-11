import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import {
  runCustomerServiceAgentWithDiagnostics,
  type CustomerServiceAgentDetailedResult,
  type CustomerServiceAgentInput,
} from '../ai/customer-service-agent';
import type { AgentDiagnostics } from '../ai/agent-diagnostics';
import { resolveChannelConversation } from '../conversations/conversation.service';
import { runCustomerServiceConversation } from '../conversations/customer-service-conversation';
import { createTenantConversationRepository } from '../conversations/tenant-conversation.repository';
import { ApplicationError } from '../http/errors';
import { resolveDashboardTenantContext } from '../tenancy/dashboard-tenant-context';
import { DASHBOARD_TRANSCRIPT_LIMIT } from './dashboard-agent-channel';

const playgroundRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  conversationId: z.uuid().optional(),
}).strict();

export type DetailedCustomerServiceRuntime = (
  input: CustomerServiceAgentInput,
) => Promise<CustomerServiceAgentDetailedResult>;

export interface AiPlaygroundDependencies {
  readonly runCustomerService?: DetailedCustomerServiceRuntime;
}

const participantKeyFor = (userId: string): string => `ai-playground:${userId}`;

const invalidRequest = (details?: unknown): ApplicationError =>
  new ApplicationError({
    code: 'BAD_REQUEST',
    message: 'Request validation failed.',
    status: 400,
    details,
  });

const readRequestBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw invalidRequest();
  }
};

export const handleAiPlaygroundMessage = async (
  input: {
    readonly requestContext: RequestContext;
    readonly selectedBusinessId?: string;
    readonly request: Request;
  },
  dependencies: AiPlaygroundDependencies = {},
) => {
  const tenant = await resolveDashboardTenantContext(
    input.requestContext,
    input.selectedBusinessId,
  );
  const parsed = playgroundRequestSchema.safeParse(await readRequestBody(input.request));
  if (!parsed.success) {
    throw invalidRequest({
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || null,
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const conversation = await resolveChannelConversation(tenant, {
    channel: 'DASHBOARD',
    participantKey: participantKeyFor(tenant.userId),
    requestedConversationId: parsed.data.conversationId,
    createIfMissing: true,
  });
  if (!conversation) {
    throw new ApplicationError({
      code: 'NOT_FOUND',
      message: 'Playground conversation was not found.',
      status: 404,
    });
  }

  let diagnostics: AgentDiagnostics = {
    scope: 'BUSINESS_RELATED',
    generationBypassed: false,
    partiallyRelated: false,
    toolCalls: [],
  };
  const runDetailed = dependencies.runCustomerService ?? runCustomerServiceAgentWithDiagnostics;
  const response = await runCustomerServiceConversation(
    { tenant, conversation, message: parsed.data.message },
    {
      runCustomerService: async runtimeInput => {
        const detailed = await runDetailed(runtimeInput);
        diagnostics = detailed.diagnostics;
        return detailed;
      },
    },
  );

  return { ...response, diagnostics };
};

export const handleAiPlaygroundConversation = async (input: {
  readonly requestContext: RequestContext;
  readonly selectedBusinessId?: string;
}) => {
  const tenant = await resolveDashboardTenantContext(
    input.requestContext,
    input.selectedBusinessId,
  );
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'DASHBOARD',
    participantKey: participantKeyFor(tenant.userId),
    createIfMissing: false,
  });
  if (!conversation) return { conversation: null };

  const messages = await createTenantConversationRepository(tenant)
    .listRecentMessages(conversation.id, DASHBOARD_TRANSCRIPT_LIMIT);
  return {
    conversation: {
      id: conversation.id,
      messages: messages.map(message => ({
        id: message.id,
        role: message.role === 'CUSTOMER' ? 'customer' as const : 'assistant' as const,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    },
  };
};

export const handleAiPlaygroundReset = async (input: {
  readonly requestContext: RequestContext;
  readonly selectedBusinessId?: string;
}) => {
  const tenant = await resolveDashboardTenantContext(
    input.requestContext,
    input.selectedBusinessId,
  );
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'DASHBOARD',
    participantKey: participantKeyFor(tenant.userId),
    createIfMissing: false,
  });
  if (conversation) {
    await createTenantConversationRepository(tenant).deleteById(conversation.id);
  }
  return { reset: true };
};
