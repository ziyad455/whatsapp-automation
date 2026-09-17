import { registerApiRoute } from '@mastra/core/server';
import { mastraAuth } from '../auth/mastra-auth';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import { requireAuthenticatedUser, requireTenantContext } from './request-context';
import { dashboardAgentRoutes } from './dashboard-agent-routes';
import { sprintFourRoutes } from './sprint-four-routes';
import { aiPlaygroundRoutes } from './ai-playground-routes';
import { whatsappWebhookRoutes } from './whatsapp-webhook-routes';

export const applicationRoutes = [
  registerApiRoute('/auth/api/*', {
    method: 'ALL',
    requiresAuth: false,
    handler: context => mastraAuth.handleAuthRequest(context.req.raw),
  }),
  ...whatsappWebhookRoutes,
  registerApiRoute('/version', {
    method: 'GET',
    requiresAuth: false,
    handler: async context =>
      context.json({
        name: 'whatsapp-automation-server',
        version: '1.0.0',
      }),
  }),
  registerApiRoute('/account', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const requestContext = context.get('requestContext');

      await resolveDashboardTenantContext(
        requestContext,
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const user = requireAuthenticatedUser(requestContext);

      return context.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    },
  }),
  registerApiRoute('/tenant-context', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const requestContext = context.get('requestContext');

      await resolveDashboardTenantContext(
        requestContext,
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );

      const tenant = requireTenantContext(requestContext);

      return context.json({
        tenant: {
          businessId: tenant.businessId,
          role: tenant.role,
        },
      });
    },
  }),
  ...dashboardAgentRoutes,
  ...aiPlaygroundRoutes,
  ...sprintFourRoutes,
];
