import type { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import {
  ConversationOperationError,
  createTenantConversationInboxService,
} from '../conversations/tenant-conversation-inbox.service';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import type { TenantContext } from '../tenancy/tenant-context';
import { WhatsAppSendError } from '../whatsapp/whatsapp-send.types';
import { ApplicationError } from './errors';

const conversationIdSchema = z.uuid();
const modeRequestSchema = z.object({
  mode: z.enum(['AI', 'HUMAN', 'PAUSED']),
}).strict();
const replyRequestSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
}).strict();

const badRequest = (message: string, details?: unknown) => new ApplicationError({
  code: 'BAD_REQUEST',
  message,
  status: 400,
  details,
});

const parseConversationId = (value: string): string => {
  const parsed = conversationIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Conversation ID must be valid.');
  return parsed.data;
};

const parseBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must contain valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw badRequest('Request validation failed.', {
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || null,
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  return parsed.data;
};

const resolveTenant = (
  requestContext: RequestContext,
  selectedBusinessId?: string,
): Promise<TenantContext> =>
  resolveDashboardTenantContext(requestContext, selectedBusinessId);

const mapConversationError = (error: unknown): never => {
  if (error instanceof ConversationOperationError) {
    if (error.code === 'NOT_FOUND') {
      throw new ApplicationError({ code: 'NOT_FOUND', message: error.message, status: 404 });
    }
    if (error.code === 'CONFLICT') {
      throw new ApplicationError({ code: 'CONFLICT', message: error.message, status: 409 });
    }
    if (error.code === 'UNAVAILABLE_CONNECTION') {
      throw new ApplicationError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: error.message,
        status: 503,
      });
    }
    throw badRequest(error.message);
  }
  if (error instanceof WhatsAppSendError) {
    throw new ApplicationError({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'WhatsApp could not send the reply. The failed attempt remains visible.',
      status: 503,
      cause: error,
    });
  }
  throw error;
};

export const conversationDashboardRoutes = [
  registerApiRoute('/dashboard/conversations', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const conversations = await createTenantConversationInboxService(tenant).list();
      return context.json({ conversations });
    },
  }),
  registerApiRoute('/dashboard/conversations/:conversationId', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const conversationId = parseConversationId(context.req.param('conversationId'));
      const conversation = await createTenantConversationInboxService(tenant)
        .getById(conversationId);
      if (!conversation) {
        throw new ApplicationError({
          code: 'NOT_FOUND',
          message: 'Conversation was not found.',
          status: 404,
        });
      }
      return context.json({ conversation });
    },
  }),
  registerApiRoute('/dashboard/conversations/:conversationId/mode', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const conversationId = parseConversationId(context.req.param('conversationId'));
      const input = await parseBody(context.req.raw, modeRequestSchema);
      try {
        const conversation = await createTenantConversationInboxService(tenant)
          .setMode(conversationId, input.mode);
        return context.json({ conversation });
      } catch (error) {
        return mapConversationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/conversations/:conversationId/replies', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const conversationId = parseConversationId(context.req.param('conversationId'));
      const input = await parseBody(context.req.raw, replyRequestSchema);
      try {
        const response = await createTenantConversationInboxService(tenant)
          .sendManualReply(conversationId, input.content);
        return context.json(response);
      } catch (error) {
        return mapConversationError(error);
      }
    },
  }),
];
