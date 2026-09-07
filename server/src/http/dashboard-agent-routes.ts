import { registerApiRoute } from '@mastra/core/server';
import {
  handleDashboardAgentRequest,
  handleDashboardConversationRequest,
} from '../channels/dashboard-agent-channel';
import {
  BUSINESS_SELECTOR_HEADER,
} from '../tenancy/dashboard-tenant-context';

export const dashboardAgentRoutes = [
  registerApiRoute('/dashboard/agent-chat', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const response = await handleDashboardConversationRequest({
        requestContext: context.get('requestContext'),
        selectedBusinessId: context.req.header(BUSINESS_SELECTOR_HEADER),
      });

      return context.json(response);
    },
  }),
  registerApiRoute('/dashboard/agent-chat', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const response = await handleDashboardAgentRequest({
        requestContext: context.get('requestContext'),
        selectedBusinessId: context.req.header(BUSINESS_SELECTOR_HEADER),
        request: context.req.raw,
      });

      return context.json(response);
    },
  }),
];
