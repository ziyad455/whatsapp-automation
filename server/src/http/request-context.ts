import { randomUUID } from 'node:crypto';
import type { BetterAuthUser } from '@mastra/auth-better-auth';
import type { RequestContext } from '@mastra/core/request-context';
import { TENANT_CONTEXT_KEY, type TenantContext } from '../tenancy/tenant-context';
import { ApplicationError } from './errors';

export const REQUEST_ID_KEY = 'request-id' as const;
export const AUTHENTICATED_USER_KEY = 'user' as const;

export type ApplicationRequestContext = {
  [REQUEST_ID_KEY]: string;
  [AUTHENTICATED_USER_KEY]?: BetterAuthUser;
  [TENANT_CONTEXT_KEY]?: TenantContext;
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
  const context = typedRequestContext(requestContext);

  context.delete(TENANT_CONTEXT_KEY);
  context.set(REQUEST_ID_KEY, requestId);
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

export const setTenantContext = (
  requestContext: RequestContext,
  tenantContext: TenantContext,
): void => {
  typedRequestContext(requestContext).set(TENANT_CONTEXT_KEY, tenantContext);
};

export const requireTenantContext = (requestContext: RequestContext): TenantContext => {
  const tenantContext = typedRequestContext(requestContext).get(TENANT_CONTEXT_KEY);

  if (!tenantContext) {
    throw new ApplicationError({
      code: 'FORBIDDEN',
      message: 'An authorized tenant context is required.',
      status: 403,
    });
  }

  return tenantContext;
};
