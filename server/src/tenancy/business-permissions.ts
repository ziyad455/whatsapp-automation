import type { BusinessUserRole } from '../generated/prisma/client';
import { ApplicationError } from '../http/errors';
import type { TenantContext } from './tenant-context';

const members = ['OWNER', 'STAFF'] as const;
const owners = ['OWNER'] as const;

export const BUSINESS_PERMISSIONS = {
  BUSINESS_READ: members,
  BUSINESS_CONFIGURATION_WRITE: owners,
  BUSINESS_SCHEMA_WRITE: owners,
  BUSINESS_ENTITY_WRITE: members,
  INTEGRATION_WRITE: owners,
  MEMBER_ADMINISTRATION: owners,
  FOLLOW_UP_CONFIGURATION_WRITE: owners,
  CAMPAIGN_READ: members,
  CAMPAIGN_CREATE: owners,
  CAMPAIGN_PREPARE: owners,
  CAMPAIGN_LAUNCH: owners,
  CAMPAIGN_CANCEL: owners,
  CONVERSATION_MANAGE: members,
  LEAD_MANAGE: members,
  CUSTOMER_PREFERENCE_WRITE: members,
  CUSTOMER_LIFECYCLE_WRITE: members,
  ANALYTICS_READ: members,
} as const satisfies Record<string, readonly BusinessUserRole[]>;

export type BusinessPermission = keyof typeof BUSINESS_PERMISSIONS;

export const requireBusinessPermission = (
  tenant: TenantContext,
  permission: BusinessPermission,
): void => {
  const roles: readonly BusinessUserRole[] = BUSINESS_PERMISSIONS[permission];
  if (!roles?.includes(tenant.role)) {
    throw new ApplicationError({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Your business role does not permit this action.',
    });
  }
};
