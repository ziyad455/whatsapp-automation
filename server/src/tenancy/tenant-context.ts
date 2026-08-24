import type { BusinessUserRole } from '../generated/prisma/client';

export const TENANT_CONTEXT_KEY = 'tenant' as const;

export interface TenantContext {
  userId: string;
  businessId: string;
  membershipId: string;
  role: BusinessUserRole;
}
