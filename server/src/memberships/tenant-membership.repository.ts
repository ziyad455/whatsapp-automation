import type { BusinessUser, BusinessUserRole } from '../generated/prisma/client';
import type { TenantContext } from '../tenancy/tenant-context';
import { prisma } from '../db/prisma';

export interface CreateTenantMembershipInput {
  userId: string;
  role: BusinessUserRole;
  businessId?: never;
}

export interface TenantMembershipRepository {
  list(): Promise<BusinessUser[]>;
  findById(membershipId: string): Promise<BusinessUser | null>;
  create(input: CreateTenantMembershipInput): Promise<BusinessUser>;
  updateRole(membershipId: string, role: BusinessUserRole): Promise<boolean>;
  deleteById(membershipId: string): Promise<boolean>;
}

export const createTenantMembershipRepository = (
  tenant: TenantContext,
): TenantMembershipRepository => {
  const businessId = tenant.businessId;

  return {
    list: () =>
      prisma.businessUser.findMany({
        where: { businessId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    findById: membershipId =>
      prisma.businessUser.findFirst({
        where: {
          id: membershipId,
          businessId,
        },
      }),
    create: input =>
      prisma.businessUser.create({
        data: {
          userId: input.userId,
          businessId,
          role: input.role,
        },
      }),
    updateRole: async (membershipId, role) => {
      const result = await prisma.businessUser.updateMany({
        where: {
          id: membershipId,
          businessId,
        },
        data: { role },
      });

      return result.count === 1;
    },
    deleteById: async membershipId => {
      const result = await prisma.businessUser.deleteMany({
        where: {
          id: membershipId,
          businessId,
        },
      });

      return result.count === 1;
    },
  };
};
