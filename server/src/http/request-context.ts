import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@mastra/core/request-context';

export const REQUEST_ID_KEY = 'request-id' as const;

export type ApplicationRequestContext = {
  [REQUEST_ID_KEY]: string;
};

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
