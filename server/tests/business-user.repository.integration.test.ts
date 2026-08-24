import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import {
  createMembership,
  findMembership,
  listUserBusinesses,
} from '../src/memberships/business-user.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-test-password-123';

const createTestUser = async (email: string, name = 'Test User') => {
  const result = await setupAuth.api.signUpEmail({
    body: {
      email,
      name,
      password: fakePassword,
    },
  });

  return result.user;
};

const createTestBusiness = (name: string) =>
  createBusiness({
    name,
    category: 'CAR_RENTAL',
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'fr',
    lifecycleStatus: 'ACTIVE',
  });

describe('BusinessUser repository', () => {
  beforeEach(async () => {
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it.each(['OWNER', 'STAFF'] as const)('persists a %s membership', async role => {
    const user = await createTestUser(`${role.toLowerCase()}@example.test`);
    const business = await createTestBusiness(`${role} Business`);

    const membership = await createMembership({
      userId: user.id,
      businessId: business.id,
      role,
    });

    expect(membership.role).toBe(role);
    await expect(findMembership(user.id, business.id)).resolves.toEqual(membership);
  });

  it('rejects duplicate membership for the same user and business', async () => {
    const user = await createTestUser('duplicate-membership@example.test');
    const business = await createTestBusiness('Duplicate Membership Business');

    await createMembership({ userId: user.id, businessId: business.id, role: 'OWNER' });

    await expect(
      createMembership({ userId: user.id, businessId: business.id, role: 'STAFF' }),
    ).rejects.toThrow();
  });

  it('allows one user to belong to multiple businesses', async () => {
    const user = await createTestUser('multi-business@example.test');
    const firstBusiness = await createTestBusiness('First Business');
    const secondBusiness = await createTestBusiness('Second Business');

    await createMembership({ userId: user.id, businessId: firstBusiness.id, role: 'OWNER' });
    await createMembership({ userId: user.id, businessId: secondBusiness.id, role: 'STAFF' });

    const memberships = await listUserBusinesses(user.id);

    expect(memberships).toHaveLength(2);
    expect(memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ businessId: firstBusiness.id, role: 'OWNER' }),
        expect.objectContaining({ businessId: secondBusiness.id, role: 'STAFF' }),
      ]),
    );
  });

  it('allows multiple users to belong to one business', async () => {
    const owner = await createTestUser('business-owner@example.test', 'Business Owner');
    const staff = await createTestUser('business-staff@example.test', 'Business Staff');
    const business = await createTestBusiness('Shared Team Business');

    await createMembership({ userId: owner.id, businessId: business.id, role: 'OWNER' });
    await createMembership({ userId: staff.id, businessId: business.id, role: 'STAFF' });

    await expect(
      prisma.businessUser.count({ where: { businessId: business.id } }),
    ).resolves.toBe(2);
  });

  it('enforces foreign keys and cascades only dependent memberships', async () => {
    const user = await createTestUser('foreign-key@example.test');
    const business = await createTestBusiness('Foreign Key Business');

    await expect(
      createMembership({ userId: randomUUID(), businessId: business.id, role: 'STAFF' }),
    ).rejects.toThrow();

    await createMembership({ userId: user.id, businessId: business.id, role: 'OWNER' });
    await prisma.user.delete({ where: { id: user.id } });

    await expect(findMembership(user.id, business.id)).resolves.toBeNull();
    await expect(prisma.business.findUnique({ where: { id: business.id } })).resolves.toEqual(
      business,
    );
  });

  it('removes only the dependent membership when a business is deleted', async () => {
    const user = await createTestUser('business-cascade@example.test');
    const business = await createTestBusiness('Business Cascade');

    await createMembership({ userId: user.id, businessId: business.id, role: 'STAFF' });
    await prisma.business.delete({ where: { id: business.id } });

    await expect(findMembership(user.id, business.id)).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toEqual(user);
  });
});
