import type { BusinessRule } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';

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
  list(): Promise<BusinessRule[]>;
  create(input: CreateBusinessRuleInput): Promise<BusinessRule>;
  update(ruleId: string, input: UpdateBusinessRuleInput): Promise<BusinessRule | null>;
}

export const createTenantBusinessRuleService = (
  tenant: TenantContext,
): TenantBusinessRuleService => ({
  list: () =>
    prisma.businessRule.findMany({
      where: { businessId: tenant.businessId },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  create: input =>
    prisma.businessRule.create({
      data: {
        businessId: tenant.businessId,
        category: input.category.trim().toUpperCase(),
        name: input.name.trim(),
        content: input.content.trim(),
        active: input.active ?? true,
      },
    }),
  update: async (ruleId, input) => {
    const result = await prisma.businessRule.updateMany({
      where: { id: ruleId, businessId: tenant.businessId },
      data: {
        ...(input.category === undefined
          ? {}
          : { category: input.category.trim().toUpperCase() }),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.content === undefined ? {} : { content: input.content.trim() }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });

    return result.count === 0
      ? null
      : prisma.businessRule.findFirst({
          where: { id: ruleId, businessId: tenant.businessId },
        });
  },
});
