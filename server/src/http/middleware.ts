import type { Middleware } from '@mastra/core/server';
import { verifyDatabaseConnection } from '../db/prisma';
import { ApplicationError } from './errors';
import { applicationLogger } from './logger';
import { initializeRequestContext } from './request-context';

export const requestContextMiddleware: Middleware = async (context, next) => {
  const startedAt = performance.now();
  const requestId = initializeRequestContext(
    context.get('requestContext'),
    context.req.header('x-request-id'),
  );
  const path = new URL(context.req.url).pathname;

  applicationLogger.info('HTTP request started', {
    requestId,
    method: context.req.method,
    path,
  });

  context.header('x-request-id', requestId);
  await next();

  applicationLogger.info('HTTP request completed', {
    requestId,
    method: context.req.method,
    path,
    status: context.res.status,
    durationMs: Math.round(performance.now() - startedAt),
  });
};

export const readinessMiddleware: Middleware = {
  path: '/ready',
  handler: async context => {
    try {
      await verifyDatabaseConnection();
    } catch (error) {
      throw new ApplicationError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'PostgreSQL is unavailable.',
        status: 503,
        cause: error,
      });
    }

    return context.json({
      status: 'ready',
      dependencies: {
        postgresql: 'ready',
      },
    });
  },
};
