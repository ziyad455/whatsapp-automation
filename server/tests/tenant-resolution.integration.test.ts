import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';
import { startMastraServer } from './helpers/mastra-server';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const dashboardOrigin = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const fakePassword = 'fake-tenant-password-123';

type TenantResponse = {
  tenant: {
    businessId: string;
    role: 'OWNER' | 'STAFF';
  };
};

type TestIdentity = {
  id: string;
  email: string;
  cookie: string;
};

type TenantFixtures = {
  userA: TestIdentity;
  userB: TestIdentity;
  userWithoutMembership: TestIdentity;
  businessAId: string;
  businessBId: string;
  membershipAId: string;
};

let server: Awaited<ReturnType<typeof startMastraServer>>;
let fixtures: TenantFixtures;

const authRequest = (path: string, init?: RequestInit) =>
  fetch(`${server.baseUrl}/auth/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: dashboardOrigin,
      ...init?.headers,
    },
  });

const createTestIdentity = async (email: string, name: string): Promise<TestIdentity> => {
  const result = await setupAuth.api.signUpEmail({
    body: { email, name, password: fakePassword },
  });
  const response = await authRequest('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: fakePassword }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ');

  if (!response.ok || !cookie) {
    throw new Error(`Unable to create a test session for ${email}.`);
  }

  return { id: result.user.id, email, cookie };
};

const tenantRequest = (
  identity: Pick<TestIdentity, 'cookie'> | undefined,
  businessId?: string,
  url = `${server.baseUrl}/tenant-context`,
): Promise<Response> => {
  const headers = new Headers();

  if (identity) {
    headers.set('cookie', identity.cookie);
  }

  if (businessId) {
    headers.set('x-business-id', businessId);
  }

  return fetch(url, { headers });
};

describe('dashboard tenant resolution', () => {
  beforeAll(async () => {
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();

    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4214,
    });

    const [businessA, businessB] = await Promise.all([
      createBusiness({
        name: 'Tenant A',
        category: 'CAR_RENTAL',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        defaultLanguage: 'fr',
        lifecycleStatus: 'ACTIVE',
      }),
      createBusiness({
        name: 'Tenant B',
        category: 'CAR_RENTAL',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        defaultLanguage: 'fr',
        lifecycleStatus: 'ACTIVE',
      }),
    ]);
    const [userA, userB, userWithoutMembership] = await Promise.all([
      createTestIdentity('tenant-a-owner@example.test', 'Tenant A Owner'),
      createTestIdentity('tenant-b-staff@example.test', 'Tenant B Staff'),
      createTestIdentity('tenant-no-membership@example.test', 'No Membership'),
    ]);
    const [membershipA] = await Promise.all([
      createMembership({ userId: userA.id, businessId: businessA.id, role: 'OWNER' }),
      createMembership({ userId: userB.id, businessId: businessB.id, role: 'STAFF' }),
    ]);

    fixtures = {
      userA,
      userB,
      userWithoutMembership,
      businessAId: businessA.id,
      businessBId: businessB.id,
      membershipAId: membershipA.id,
    };
  });

  afterAll(async () => {
    await server?.stop();
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();
    await closeDatabaseConnection();
  });

  it.each([
    ['A', () => fixtures.userA, () => fixtures.businessAId, 'OWNER'],
    ['B', () => fixtures.userB, () => fixtures.businessBId, 'STAFF'],
  ] as const)('resolves User %s to its authorized business context', async (
    _label,
    getUser,
    getBusinessId,
    role,
  ) => {
    const user = getUser();
    const businessId = getBusinessId();
    const response = await tenantRequest(user, businessId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tenant: {
        businessId,
        role,
      },
    });
  });

  it.each([
    ['User A requesting Business B', () => fixtures.userA, () => fixtures.businessBId],
    ['User B requesting Business A', () => fixtures.userB, () => fixtures.businessAId],
  ] as const)('denies the BOLA/IDOR case: %s', async (_label, getUser, getBusinessId) => {
    const response = await tenantRequest(getUser(), getBusinessId());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have access to the selected business.',
      },
    });
  });

  it('rejects an unauthenticated request', async () => {
    const response = await tenantRequest(undefined, fixtures.businessAId);

    expect(response.status).toBe(401);
  });

  it('requires an explicit business selection', async () => {
    const response = await tenantRequest(fixtures.userA);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'TENANT_SELECTION_REQUIRED' },
    });
  });

  it('denies an authenticated user with no membership', async () => {
    const response = await tenantRequest(
      fixtures.userWithoutMembership,
      fixtures.businessAId,
    );

    expect(response.status).toBe(403);
  });

  it.each([randomUUID(), 'not-a-business-id'])(
    'fails safely for an unknown or malformed business selector: %s',
    async businessId => {
      const response = await tenantRequest(fixtures.userA, businessId);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to the selected business.',
        },
      });
    },
  );

  it('ignores forged user, membership, and role values from client RequestContext', async () => {
    const url = new URL('/tenant-context', server.baseUrl);
    url.searchParams.set(
      'requestContext',
      JSON.stringify({
        tenant: {
          userId: fixtures.userA.id,
          businessId: fixtures.businessAId,
          membershipId: fixtures.membershipAId,
          role: 'OWNER',
        },
      }),
    );

    const response = await tenantRequest(fixtures.userB, fixtures.businessBId, url.toString());
    const body = (await response.json()) as TenantResponse;

    const accountUrl = new URL('/account', server.baseUrl);
    accountUrl.search = url.search;
    const accountResponse = await tenantRequest(
      fixtures.userB,
      fixtures.businessBId,
      accountUrl.toString(),
    );
    const accountBody = (await accountResponse.json()) as { user: { id: string } };

    expect(response.status).toBe(200);
    expect(body.tenant).toEqual({
      businessId: fixtures.businessBId,
      role: 'STAFF',
    });
    expect(accountResponse.status).toBe(200);
    expect(accountBody.user.id).toBe(fixtures.userB.id);
  });

  it('keeps concurrent tenant contexts isolated per request', async () => {
    const requests = Array.from({ length: 20 }, (_, index) => {
      const isTenantA = index % 2 === 0;
      const user = isTenantA ? fixtures.userA : fixtures.userB;
      const businessId = isTenantA ? fixtures.businessAId : fixtures.businessBId;

      return tenantRequest(user, businessId).then(async response => ({
        status: response.status,
        body: (await response.json()) as TenantResponse,
        expectedBusinessId: businessId,
        expectedRole: isTenantA ? 'OWNER' : 'STAFF',
      }));
    });

    const responses = await Promise.all(requests);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.tenant.businessId).toBe(response.expectedBusinessId);
      expect(response.body.tenant.role).toBe(response.expectedRole);
    }
  });
});
