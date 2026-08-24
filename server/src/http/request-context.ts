import { randomUUID } from 'node:crypto';
import type { BetterAuthUser } from '@mastra/auth-better-auth';
import type { RequestContext } from '@mastra/core/request-context';
import { ApplicationError } from './errors';

export const REQUEST_ID_KEY = 'request-id' as const;
export const AUTHENTICATED_USER_KEY = 'user' as const;

export type ApplicationRequestContext = {
  [REQUEST_ID_KEY]: string;
  [AUTHENTICATED_USER_KEY]?: BetterAuthUser;
};

export type AuthenticatedUser = BetterAuthUser['user'];

const validRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export const resolveRequestId = (requestedId?: string): string => {
  if (requestedId && validRequestId.test(requestedId)) {
    return requestedId;
  }

  return randomUUID();
};

const typedRequestContext = (
  requestContext: RequestContext,
): RequestContext<ApplicationRequestContext> =>
  requestContext as RequestContext<ApplicationRequestContext>;

export const initializeRequestContext = (
  requestContext: RequestContext,
  requestedId?: string,
): string => {
  const requestId = resolveRequestId(requestedId);
  typedRequestContext(requestContext).set(REQUEST_ID_KEY, requestId);
  return requestId;
};

export const getOrCreateRequestId = (requestContext: RequestContext): string => {
  const context = typedRequestContext(requestContext);
  const requestId = context.get(REQUEST_ID_KEY);

  if (requestId) {
    return requestId;
  }

  return initializeRequestContext(requestContext);
};

export const requireAuthenticatedUser = (
  requestContext: RequestContext,
): AuthenticatedUser => {
  const authenticatedUser = typedRequestContext(requestContext).get(AUTHENTICATED_USER_KEY);

  if (!authenticatedUser?.user.id) {
    throw new ApplicationError({
      code: 'UNAUTHORIZED',
      message: 'Authentication is required.',
      status: 401,
    });
  }

  return authenticatedUser.user;
};
