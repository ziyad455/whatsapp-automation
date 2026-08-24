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
const fakePassword = 'fake-auth-password-123';
const email = 'auth-owner@example.test';

let server: Awaited<ReturnType<typeof startMastraServer>>;
let userId: string;
let businessId: string;
let sessionCookieName: string;

const authRequest = (path: string, init?: RequestInit) =>
  fetch(`${server.baseUrl}/auth/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: dashboardOrigin,
      ...init?.headers,
    },
  });

const signIn = async (): Promise<{ cookie: string; response: Response }> => {
  const response = await authRequest('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: fakePassword }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map(value => value.split(';', 1)[0])
    .join('; ');

  return { cookie, response };
};

describe('Better Auth HTTP integration', () => {
  beforeAll(async () => {
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    const result = await setupAuth.api.signUpEmail({
      body: {
        email,
        name: 'Auth Test Owner',
        password: fakePassword,
      },
    });

    userId = result.user.id;
    const business = await createBusiness({
      name: 'Auth Test Business',
      category: 'CAR_RENTAL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    businessId = business.id;
    await createMembership({ userId, businessId, role: 'OWNER' });
    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4213,
    });
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

  it('keeps public email registration disabled', async () => {
    const usersBefore = await prisma.user.count();
    const response = await authRequest('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        email: 'public-signup@example.test',
        name: 'Public Signup',
        password: fakePassword,
      }),
    });

    expect(response.ok).toBe(false);
    await expect(prisma.user.count()).resolves.toBe(usersBefore);
  });

  it('rejects invalid credentials without creating a session', async () => {
    const response = await authRequest('/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'wrong-fake-password' }),
    });

    expect(response.status).toBe(401);
    await expect(prisma.session.count({ where: { userId } })).resolves.toBe(0);
  });

  it('creates, reads, protects, and invalidates a cookie session', async () => {
    const anonymousResponse = await fetch(`${server.baseUrl}/account`);
    const { cookie, response } = await signIn();
    const setCookie = response.headers.getSetCookie().join('; ');
    sessionCookieName = cookie.split('=', 1)[0];
    const authenticatedResponse = await fetch(`${server.baseUrl}/account`, {
      headers: { cookie, 'x-business-id': businessId },
    });
    const sessionResponse = await authRequest('/get-session', {
      headers: { cookie },
    });
    const sessionBody = (await sessionResponse.json()) as { user: { id: string } };
    const signOutResponse = await authRequest('/sign-out', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { cookie },
    });
    const signedOutResponse = await fetch(`${server.baseUrl}/account`, {
      headers: { cookie, 'x-business-id': businessId },
    });

    expect(anonymousResponse.status).toBe(401);
    expect(response.status).toBe(200);
    expect(cookie).not.toBe('');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).not.toContain('domain=');
    expect(response.headers.get('access-control-allow-origin')).toBe(dashboardOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(authenticatedResponse.status).toBe(200);
    await expect(authenticatedResponse.json()).resolves.toEqual({
      user: {
        id: userId,
        name: 'Auth Test Owner',
        email,
      },
    });
    expect(sessionResponse.status).toBe(200);
    expect(sessionBody.user.id).toBe(userId);
    expect(signOutResponse.status).toBe(200);
    expect(signedOutResponse.status).toBe(401);
    await expect(prisma.session.count({ where: { userId } })).resolves.toBe(0);
  });

  it('rejects an invalid session token', async () => {
    const invalidCookie = `${sessionCookieName}=invalid-session-token`;
    const invalidResponse = await fetch(`${server.baseUrl}/account`, {
      headers: { cookie: invalidCookie, 'x-business-id': businessId },
    });

    expect(invalidResponse.status).toBe(401);
  });

  it('rejects an expired server-side session', async () => {
    const { cookie, response } = await signIn();
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });

    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expiredResponse = await fetch(`${server.baseUrl}/account`, {
      headers: { cookie, 'x-business-id': businessId },
    });

    expect(response.status).toBe(200);
    expect(expiredResponse.status).toBe(401);
  });
});
