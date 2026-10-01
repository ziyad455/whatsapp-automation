import type { BusinessRule } from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';

export interface CreateBusinessRuleInput {
  category: string;
  name: string;
  content: string;
  active?: boolean;
  businessId?: never;
}

export interface UpdateBusinessRuleInput {
  category?: string;
  name?: string;
  content?: string;
  active?: boolean;
  businessId?: never;
}

export interface TenantBusinessRuleService {
  list(input?: { active?: boolean }): Promise<BusinessRule[]>;
  create(input: CreateBusinessRuleInput): Promise<BusinessRule>;
  update(ruleId: string, input: UpdateBusinessRuleInput): Promise<BusinessRule | null>;
}

export const createTenantBusinessRuleService = (
  tenant: TenantContext,
): TenantBusinessRuleService => ({
  list: input =>
    prisma.businessRule.findMany({
      where: {
        businessId: tenant.businessId,
        ...(input?.active === undefined ? {} : { active: input.active }),
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  create: async input => {
    requireBusinessPermission(tenant, 'BUSINESS_CONFIGURATION_WRITE');
    return prisma.$transaction(async transaction => {
      const rule = await transaction.businessRule.create({
        data: {
          businessId: tenant.businessId,
          category: input.category.trim().toUpperCase(),
          name: input.name.trim(),
          content: input.content.trim(),
          active: input.active ?? true,
          source: 'MANUAL',
          externalId: null,
          lastVerifiedAt: new Date(),
        },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_RULE',
        targetId: rule.id,
        action: 'CREATE',
        before: null,
        after: rule,
      });

      return rule;
    });
  },
  update: async (ruleId, input) => {
    requireBusinessPermission(tenant, 'BUSINESS_CONFIGURATION_WRITE');
    return prisma.$transaction(async transaction => {
      const before = await transaction.businessRule.findFirst({
        where: { id: ruleId, businessId: tenant.businessId },
      });

      if (!before) {
        return null;
      }

      const after = await transaction.businessRule.update({
        where: { id: before.id },
        data: {
          ...(input.category === undefined
            ? {}
            : { category: input.category.trim().toUpperCase() }),
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.content === undefined ? {} : { content: input.content.trim() }),
          ...(input.active === undefined ? {} : { active: input.active }),
          source: 'MANUAL',
          externalId: null,
          lastVerifiedAt: new Date(),
        },
      });

      await appendTenantAuditEvent(transaction, tenant, {
        targetType: 'BUSINESS_RULE',
        targetId: after.id,
        action: 'UPDATE',
        before,
        after,
      });

      return after;
    });
  },
});
