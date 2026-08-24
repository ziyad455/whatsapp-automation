import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import type { BusinessUser } from '../src/generated/prisma/client';
import { createMembership } from '../src/memberships/business-user.repository';
import {
  createTenantMembershipRepository,
  type CreateTenantMembershipInput,
  type TenantMembershipRepository,
} from '../src/memberships/tenant-membership.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-tenant-data-password-123';

type TenantDataFixtures = {
  tenantA: TenantContext;
  tenantB: TenantContext;
  membershipA: BusinessUser;
  membershipB: BusinessUser;
  candidateUserId: string;
};

let fixtures: TenantDataFixtures;

const createTestUser = async (email: string, name: string) => {
  const result = await setupAuth.api.signUpEmail({
    body: { email, name, password: fakePassword },
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

describe('tenant-scoped membership data access', () => {
  beforeEach(async () => {
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();

    const [businessA, businessB] = await Promise.all([
      createTestBusiness('Tenant Data Business A'),
      createTestBusiness('Tenant Data Business B'),
    ]);
    const [ownerA, ownerB, staffA, staffB, candidate] = await Promise.all([
      createTestUser('tenant-data-owner-a@example.test', 'Owner A'),
      createTestUser('tenant-data-owner-b@example.test', 'Owner B'),
      createTestUser('tenant-data-staff-a@example.test', 'Staff A'),
      createTestUser('tenant-data-staff-b@example.test', 'Staff B'),
      createTestUser('tenant-data-candidate@example.test', 'Candidate'),
    ]);
    const [ownerMembershipA, ownerMembershipB, membershipA, membershipB] =
      await Promise.all([
        createMembership({ userId: ownerA.id, businessId: businessA.id, role: 'OWNER' }),
        createMembership({ userId: ownerB.id, businessId: businessB.id, role: 'OWNER' }),
        createMembership({ userId: staffA.id, businessId: businessA.id, role: 'STAFF' }),
        createMembership({ userId: staffB.id, businessId: businessB.id, role: 'STAFF' }),
      ]);

    fixtures = {
      tenantA: Object.freeze({
        userId: ownerA.id,
        businessId: businessA.id,
        membershipId: ownerMembershipA.id,
        role: ownerMembershipA.role,
      }),
      tenantB: Object.freeze({
        userId: ownerB.id,
        businessId: businessB.id,
        membershipId: ownerMembershipB.id,
        role: ownerMembershipB.role,
      }),
      membershipA,
      membershipB,
      candidateUserId: candidate.id,
    };
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('requires TenantContext and an ownership-free create input at compile time', () => {
    expectTypeOf(createTenantMembershipRepository)
      .parameter(0)
      .toEqualTypeOf<TenantContext>();
    expectTypeOf<TenantMembershipRepository['create']>()
      .parameter(0)
      .toEqualTypeOf<CreateTenantMembershipInput>();
  });

  it('reads only memberships owned by the bound tenant', async () => {
    const repositoryA = createTenantMembershipRepository(fixtures.tenantA);
    const repositoryB = createTenantMembershipRepository(fixtures.tenantB);

    const [membershipsA, membershipsB] = await Promise.all([
      repositoryA.list(),
      repositoryB.list(),
    ]);

    expect(membershipsA.every(item => item.businessId === fixtures.tenantA.businessId)).toBe(
      true,
    );
    expect(membershipsB.every(item => item.businessId === fixtures.tenantB.businessId)).toBe(
      true,
    );
    await expect(repositoryA.findById(fixtures.membershipA.id)).resolves.toEqual(
      fixtures.membershipA,
    );
    await expect(repositoryB.findById(fixtures.membershipB.id)).resolves.toEqual(
      fixtures.membershipB,
    );
    await expect(repositoryA.findById(fixtures.membershipB.id)).resolves.toBeNull();
    await expect(repositoryB.findById(fixtures.membershipA.id)).resolves.toBeNull();
  });

  it('forces create ownership from TenantContext even for an untyped caller', async () => {
    const repositoryA = createTenantMembershipRepository(fixtures.tenantA);
    const spoofedInput = {
      userId: fixtures.candidateUserId,
      role: 'STAFF' as const,
      businessId: fixtures.tenantB.businessId,
    };

    // @ts-expect-error Tenant ownership is deliberately forbidden in the create DTO.
    const membership = await repositoryA.create(spoofedInput);

    expect(membership.businessId).toBe(fixtures.tenantA.businessId);
    expect(membership.businessId).not.toBe(fixtures.tenantB.businessId);
  });

  it('scopes updates by both membership ID and tenant ownership', async () => {
    const repositoryA = createTenantMembershipRepository(fixtures.tenantA);

    await expect(repositoryA.updateRole(fixtures.membershipB.id, 'OWNER')).resolves.toBe(
      false,
    );
    await expect(repositoryA.updateRole(fixtures.membershipA.id, 'OWNER')).resolves.toBe(
      true,
    );
    await expect(
      prisma.businessUser.findUnique({ where: { id: fixtures.membershipB.id } }),
    ).resolves.toMatchObject({ role: 'STAFF', businessId: fixtures.tenantB.businessId });
    await expect(
      prisma.businessUser.findUnique({ where: { id: fixtures.membershipA.id } }),
    ).resolves.toMatchObject({ role: 'OWNER', businessId: fixtures.tenantA.businessId });
  });

  it('scopes deletes by both membership ID and tenant ownership', async () => {
    const repositoryA = createTenantMembershipRepository(fixtures.tenantA);

    await expect(repositoryA.deleteById(fixtures.membershipB.id)).resolves.toBe(false);
    await expect(repositoryA.deleteById(fixtures.membershipA.id)).resolves.toBe(true);
    await expect(
      prisma.businessUser.findUnique({ where: { id: fixtures.membershipB.id } }),
    ).resolves.toEqual(fixtures.membershipB);
    await expect(
      prisma.businessUser.findUnique({ where: { id: fixtures.membershipA.id } }),
    ).resolves.toBeNull();
  });
});
