import type { BusinessUserRole } from '../generated/prisma/client';

export const TENANT_CONTEXT_KEY = 'tenant' as const;

export interface TenantContext {
  readonly userId: string;
  readonly businessId: string;
  readonly membershipId: string;
  readonly role: BusinessUserRole;
}
