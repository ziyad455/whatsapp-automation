import { registerApiRoute } from '@mastra/core/server';
import { mastraAuth } from '../auth/mastra-auth';
import { requireAuthenticatedUser } from './request-context';

export const applicationRoutes = [
  registerApiRoute('/auth/api/*', {
    method: 'ALL',
    requiresAuth: false,
    handler: context => mastraAuth.handleAuthRequest(context.req.raw),
  }),
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
      const user = requireAuthenticatedUser(context.get('requestContext'));

      return context.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    },
  }),
];
