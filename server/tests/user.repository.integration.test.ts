import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { findUserByEmail, findUserById } from '../src/users/user.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-test-password-123';

describe('user repository', () => {
  beforeEach(async () => {
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('reads the canonical Better Auth user identity', async () => {
    const result = await setupAuth.api.signUpEmail({
      body: {
        email: 'owner@example.test',
        name: 'Test Owner',
        password: fakePassword,
      },
    });

    await expect(findUserById(result.user.id)).resolves.toEqual(result.user);
    await expect(findUserByEmail(' OWNER@EXAMPLE.TEST ')).resolves.toEqual(result.user);
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('stores the delegated credential hash only on the Better Auth account', async () => {
    const result = await setupAuth.api.signUpEmail({
      body: {
        email: 'credential@example.test',
        name: 'Credential Test',
        password: fakePassword,
      },
    });

    const account = await prisma.account.findFirstOrThrow({
      where: {
        userId: result.user.id,
        providerId: 'credential',
      },
    });
    const userColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `;
    const userColumnNames = new Set(userColumns.map(column => column.column_name));

    expect(account.password).toEqual(expect.any(String));
    expect(account.password).not.toBe(fakePassword);
    expect(userColumnNames.has('password')).toBe(false);
    expect(userColumnNames.has('password_hash')).toBe(false);
  });
});
