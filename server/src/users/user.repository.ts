import type { User } from '../generated/prisma/client';
import { prisma } from '../db/prisma';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export const normalizeUserEmail = (email: string): string => email.trim().toLowerCase();

export const createUser = async (input: CreateUserInput): Promise<User> =>
  prisma.user.create({
    data: {
      email: normalizeUserEmail(input.email),
      passwordHash: input.passwordHash,
    },
  });

export const findUserById = async (id: string): Promise<User | null> =>
  prisma.user.findUnique({ where: { id } });

export const findUserByEmail = async (email: string): Promise<User | null> =>
  prisma.user.findUnique({ where: { email: normalizeUserEmail(email) } });
