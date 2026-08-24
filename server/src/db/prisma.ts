import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });

  return new PrismaClient({ adapter });
};

const globalForPrisma = globalThis as typeof globalThis & {
  whatsappAutomationPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.whatsappAutomationPrisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.whatsappAutomationPrisma = prisma;
}

export const verifyDatabaseConnection = async (): Promise<void> => {
  try {
    await prisma.$queryRaw`select 1`;
  } catch (error) {
    throw new Error('Unable to connect to PostgreSQL using DATABASE_URL.', {
      cause: error,
    });
  }
};

export const closeDatabaseConnection = async (): Promise<void> => {
  await prisma.$disconnect();
};
