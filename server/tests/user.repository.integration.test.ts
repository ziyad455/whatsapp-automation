import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import {
  createUser,
  findUserByEmail,
  findUserById,
} from '../src/users/user.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const fakePasswordHash = '$argon2id$v=19$fake-test-salt$fake-test-hash';

describe('user repository', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('creates a user with a normalized email and hash-only credential', async () => {
    const user = await createUser({
      email: '  Owner@Example.Test ',
      passwordHash: fakePasswordHash,
    });

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.email).toBe('owner@example.test');
    expect(user.passwordHash).toBe(fakePasswordHash);
    expect(typeof user.passwordHash).toBe('string');
    expect(user).not.toHaveProperty('password');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('reads a user by id and normalized email identity', async () => {
    const createdUser = await createUser({
      email: 'reader@example.test',
      passwordHash: fakePasswordHash,
    });

    await expect(findUserById(createdUser.id)).resolves.toEqual(createdUser);
    await expect(findUserByEmail(' READER@EXAMPLE.TEST ')).resolves.toEqual(createdUser);
  });

  it('rejects duplicate normalized email identities', async () => {
    await createUser({
      email: 'duplicate@example.test',
      passwordHash: fakePasswordHash,
    });

    await expect(
      createUser({
        email: ' DUPLICATE@EXAMPLE.TEST ',
        passwordHash: fakePasswordHash,
      }),
    ).rejects.toThrow();
  });

  it('stores only password_hash as a text credential column', async () => {
    const result = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `;
    const columns = new Map(result.map(column => [column.column_name, column.data_type]));

    expect(columns.get('password_hash')).toBe('text');
    expect(columns.has('password')).toBe(false);
  });
});
