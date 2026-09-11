import { registerApiRoute } from '@mastra/core/server';
import { isDevelopmentRuntime } from '../config/env';
import {
  handleAiPlaygroundConversation,
  handleAiPlaygroundMessage,
  handleAiPlaygroundReset,
} from '../channels/ai-playground-channel';
import { BUSINESS_SELECTOR_HEADER } from '../tenancy/dashboard-tenant-context';

const routes = [
  registerApiRoute('/dashboard/ai-playground', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => context.json(await handleAiPlaygroundConversation({
      requestContext: context.get('requestContext'),
      selectedBusinessId: context.req.header(BUSINESS_SELECTOR_HEADER),
    })),
  }),
  registerApiRoute('/dashboard/ai-playground', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => context.json(await handleAiPlaygroundMessage({
      requestContext: context.get('requestContext'),
      selectedBusinessId: context.req.header(BUSINESS_SELECTOR_HEADER),
      request: context.req.raw,
    })),
  }),
  registerApiRoute('/dashboard/ai-playground', {
    method: 'DELETE',
    requiresAuth: true,
    handler: async context => context.json(await handleAiPlaygroundReset({
      requestContext: context.get('requestContext'),
      selectedBusinessId: context.req.header(BUSINESS_SELECTOR_HEADER),
    })),
  }),
];

export const aiPlaygroundRoutes = isDevelopmentRuntime ? routes : [];
