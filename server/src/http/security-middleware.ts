import type { Middleware } from '@mastra/core/server';
import { ApplicationError } from './errors';
import { readBoundedBody, RequestBodyTooLargeError } from './bounded-body';
import { env } from '../config/env';

export const securityMiddleware: Middleware = async (context, next) => {
  // Use the router's decoded path: /%61pi must not bypass /api policy.
  const path = context.req.path;
  // Framework management routes do not apply BusinessUser authorization or
  // server-created AI capabilities. Expose only our application adapters.
  if (path === '/api' || path.startsWith('/api/')) {
    return context.json({ error: { code: 'FORBIDDEN', message: 'Management API is not exposed.' } }, 403);
  }
  const request = context.req.raw;
  const origin = request.headers.get('origin');
  if (path.startsWith('/dashboard/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      origin && origin !== env.DASHBOARD_URL && origin !== env.BETTER_AUTH_URL) {
    throw new ApplicationError({ code: 'FORBIDDEN', status: 403, message: 'Request origin is not allowed.' });
  }
  if (request.body && path !== '/webhooks/whatsapp') {
    try {
      const bytes = await readBoundedBody(request);
      context.req.raw = new Request(request, { body: bytes.buffer as ArrayBuffer });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw new ApplicationError({
        code: 'PAYLOAD_TOO_LARGE', status: 413, message: error.message,
      });
      throw error;
    }
  }
  await next();
  context.header('x-content-type-options', 'nosniff');
  context.header('referrer-policy', 'no-referrer');
  if (path.startsWith('/dashboard/') || path.startsWith('/auth/')) context.header('cache-control', 'no-store');
};
