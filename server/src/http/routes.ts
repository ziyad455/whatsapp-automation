import { registerApiRoute } from '@mastra/core/server';

export const applicationRoutes = [
  registerApiRoute('/version', {
    method: 'GET',
    requiresAuth: false,
    handler: async context =>
      context.json({
        name: 'whatsapp-automation-server',
        version: '1.0.0',
      }),
  }),
];
