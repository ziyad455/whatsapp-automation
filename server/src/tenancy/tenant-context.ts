import type { BusinessUserRole } from '../generated/prisma/client';

export const TENANT_CONTEXT_KEY = 'tenant' as const;

export interface TenantScope {
  readonly businessId: string;
}

export interface TenantContext extends TenantScope {
  readonly userId: string;
  readonly membershipId: string;
  readonly role: BusinessUserRole;
}
