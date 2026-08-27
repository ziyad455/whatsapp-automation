import {
  type Prisma,
  type AuditAction,
  type AuditEvent,
  type AuditTargetType,
} from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { createSafeAuditSnapshot } from './audit-snapshot';

export interface AppendTenantAuditEventInput {
  targetType: AuditTargetType;
  targetId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

export const appendTenantAuditEvent = (
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  input: AppendTenantAuditEventInput,
): Promise<AuditEvent> =>
  transaction.auditEvent.create({
    data: {
      businessId: tenant.businessId,
      actorUserId: tenant.userId,
      actorKind: 'USER',
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      ...(input.before === undefined
        ? {}
        : { before: createSafeAuditSnapshot(input.before) }),
      ...(input.after === undefined
        ? {}
        : { after: createSafeAuditSnapshot(input.after) }),
    },
  });

export interface ListTenantAuditEventsInput {
  targetType?: AuditTargetType;
  targetId?: string;
  limit?: number;
  businessId?: never;
}

export interface TenantAuditQueryService {
  list(input?: ListTenantAuditEventsInput): Promise<AuditEvent[]>;
}

export const createTenantAuditQueryService = (
  tenant: TenantContext,
): TenantAuditQueryService => ({
  list: input =>
    prisma.auditEvent.findMany({
      where: {
        businessId: tenant.businessId,
        ...(input?.targetType === undefined
          ? {}
          : { targetType: input.targetType }),
        ...(input?.targetId === undefined ? {} : { targetId: input.targetId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(input?.limit ?? 50, 1), 100),
    }),
});
