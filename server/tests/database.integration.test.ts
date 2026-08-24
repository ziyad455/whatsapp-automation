import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

describe('database migration foundation', () => {
  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('records the applied Prisma migration', async () => {
    const [result] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      select count(*)::bigint as count from _prisma_migrations
    `;

    expect(Number(result?.count)).toBeGreaterThanOrEqual(1);
  });
});
