import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import {
  resolveChannelConversation,
} from '../conversations/conversation.service';
import {
  runCustomerServiceConversation,
  type CustomerServiceConversationResult,
} from '../conversations/customer-service-conversation';
import { createTenantConversationRepository } from '../conversations/tenant-conversation.repository';
import { ApplicationError } from '../http/errors';
import { resolveDashboardTenantContext } from '../tenancy/dashboard-tenant-context';

export const dashboardAgentRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  conversationId: z.uuid().optional(),
}).strict();

export type DashboardConversationRunner = typeof runCustomerServiceConversation;

export interface DashboardAgentChannelDependencies {
  readonly runConversation?: DashboardConversationRunner;
}

export const DASHBOARD_TRANSCRIPT_LIMIT = 50;

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
    throw new ApplicationError({
      code: 'BAD_REQUEST',
      message: 'Request body must contain valid JSON.',
      status: 400,
    });
  }
};

export const handleDashboardAgentRequest = async (
  input: {
    readonly requestContext: RequestContext;
    readonly selectedBusinessId?: string;
    readonly request: Request;
  },
  dependencies: DashboardAgentChannelDependencies = {},
): Promise<CustomerServiceConversationResult> => {
  const tenant = await resolveDashboardTenantContext(
    input.requestContext,
    input.selectedBusinessId,
  );
  const body = await readRequestBody(input.request);
  const parsed = dashboardAgentRequestSchema.safeParse(body);

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
    participantKey: tenant.userId,
    requestedConversationId: parsed.data.conversationId,
    createIfMissing: true,
  });

  if (!conversation) {
    throw new ApplicationError({
      code: 'NOT_FOUND',
      message: 'Conversation was not found.',
      status: 404,
    });
  }

  const runConversation = dependencies.runConversation ?? runCustomerServiceConversation;
  return runConversation({ tenant, conversation, message: parsed.data.message });
};

export const handleDashboardConversationRequest = async (input: {
  readonly requestContext: RequestContext;
  readonly selectedBusinessId?: string;
}) => {
  const tenant = await resolveDashboardTenantContext(
    input.requestContext,
    input.selectedBusinessId,
  );
  const conversation = await resolveChannelConversation(tenant, {
    channel: 'DASHBOARD',
    participantKey: tenant.userId,
    createIfMissing: false,
  });

  if (!conversation) {
    return { conversation: null };
  }

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
