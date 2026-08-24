import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';
import {
  initializeRequestContext,
  resolveRequestId,
} from '../src/http/request-context';
import { TENANT_CONTEXT_KEY } from '../src/tenancy/tenant-context';

describe('resolveRequestId', () => {
  it('preserves a safe caller correlation ID', () => {
    expect(resolveRequestId('request-abc_123')).toBe('request-abc_123');
  });

  it('replaces an unsafe correlation ID', () => {
    expect(resolveRequestId('contains spaces and unsafe data')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('removes a client-supplied tenant value during initialization', () => {
    const requestContext = new RequestContext();
    requestContext.setRaw(TENANT_CONTEXT_KEY, {
      userId: 'forged-user',
      businessId: 'forged-business',
      membershipId: 'forged-membership',
      role: 'OWNER',
    });

    initializeRequestContext(requestContext);

    expect(requestContext.hasRaw(TENANT_CONTEXT_KEY)).toBe(false);
  });
});
