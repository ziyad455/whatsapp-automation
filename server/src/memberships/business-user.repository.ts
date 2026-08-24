import type { Business, BusinessUser, BusinessUserRole } from '../generated/prisma/client';
import { prisma } from '../db/prisma';

export interface CreateMembershipInput {
  userId: string;
  businessId: string;
  role: BusinessUserRole;
}

export type UserBusinessMembership = BusinessUser & {
  business: Business;
};

export const createMembership = async (
  input: CreateMembershipInput,
): Promise<BusinessUser> =>
  prisma.businessUser.create({
    data: input,
  });

export const findMembership = async (
  userId: string,
  businessId: string,
): Promise<BusinessUser | null> =>
  prisma.businessUser.findUnique({
    where: {
      userId_businessId: {
        userId,
        businessId,
      },
    },
  });

export const listUserBusinesses = async (
  userId: string,
): Promise<UserBusinessMembership[]> =>
  prisma.businessUser.findMany({
    where: { userId },
    include: { business: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
