import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { ApplicationError } from '../http/errors';
import { applicationLogger } from '../http/logger';
import {
  getOrCreateRequestId,
  requireAuthenticatedUser,
  setTenantContext,
} from '../http/request-context';
import { findMembership } from '../memberships/business-user.repository';
import type { TenantContext } from './tenant-context';
import { enforceRateLimit } from '../http/rate-limit';

export const BUSINESS_SELECTOR_HEADER = 'x-business-id' as const;

const businessIdSchema = z.uuid();

const tenantAccessDenied = (): ApplicationError =>
  new ApplicationError({
    code: 'FORBIDDEN',
    message: 'You do not have access to the selected business.',
    status: 403,
  });

export const resolveDashboardTenantContext = async (
  requestContext: RequestContext,
  selectedBusinessId?: string,
): Promise<TenantContext> => {
  const user = requireAuthenticatedUser(requestContext);
  enforceRateLimit(`dashboard:${user.id}`, 180);
  const requestId = getOrCreateRequestId(requestContext);

  if (!selectedBusinessId) {
    applicationLogger.warn('Tenant context resolution denied', {
      requestId,
      userId: user.id,
      reason: 'selection-required',
    });

    throw new ApplicationError({
      code: 'TENANT_SELECTION_REQUIRED',
      message: `Select a business with the ${BUSINESS_SELECTOR_HEADER} header.`,
      status: 400,
    });
  }

  const parsedBusinessId = businessIdSchema.safeParse(selectedBusinessId.trim());

  if (!parsedBusinessId.success) {
    applicationLogger.warn('Tenant context resolution denied', {
      requestId,
      userId: user.id,
      reason: 'access-denied',
    });

    throw tenantAccessDenied();
  }

  const businessId = parsedBusinessId.data;
  const membership = await findMembership(user.id, businessId);

  if (!membership) {
    applicationLogger.warn('Tenant context resolution denied', {
      requestId,
      userId: user.id,
      businessId,
      reason: 'access-denied',
    });

    throw tenantAccessDenied();
  }

  const tenantContext: TenantContext = Object.freeze({
    userId: user.id,
    businessId: membership.businessId,
    membershipId: membership.id,
    role: membership.role,
  });

  setTenantContext(requestContext, tenantContext);
  applicationLogger.info('Tenant context resolved', {
    requestId,
    userId: tenantContext.userId,
    businessId: tenantContext.businessId,
  });

  return tenantContext;
};
