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
const fakePassword = 'fake-sprint-four-http-password-123';
const email = 'sprint-four-http@example.test';

let server: Awaited<ReturnType<typeof startMastraServer>>;
let businessId: string;
let foreignBusinessId: string;
let cookie: string;

const request = (path: string, init?: RequestInit) =>
  fetch(`${server.baseUrl}${path}`, {
    ...init,
    headers: {
      origin: dashboardOrigin,
      ...init?.headers,
    },
  });

describe('Sprint 4 dashboard HTTP API', () => {
  beforeAll(async () => {
    await prisma.businessRule.deleteMany();
    await prisma.businessOpeningHour.deleteMany();
    await prisma.businessFieldDefinition.deleteMany();
    await prisma.businessEntity.deleteMany();
    await prisma.businessEntityType.deleteMany();
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();

    const user = await setupAuth.api.signUpEmail({
      body: { email, name: 'Sprint Four Owner', password: fakePassword },
    });
    const business = await createBusiness({
      name: 'HTTP Atlas Shop',
      category: 'RETAIL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    const foreignBusiness = await createBusiness({
      name: 'Foreign Shop',
      category: 'RETAIL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    businessId = business.id;
    foreignBusinessId = foreignBusiness.id;
    await createMembership({ userId: user.user.id, businessId, role: 'OWNER' });

    server = await startMastraServer({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 4214,
    });
    const signIn = await request('/auth/api/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: fakePassword }),
    });
    cookie = signIn.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ');
  });

  afterAll(async () => {
    await server?.stop();
    await closeDatabaseConnection();
  });

  it('requires an explicit verified tenant selection', async () => {
    const missingSelection = await request('/dashboard/business-profile', {
      headers: { cookie },
    });
    const foreignSelection = await request('/dashboard/business-profile', {
      headers: { cookie, 'x-business-id': foreignBusinessId },
    });

    expect(missingSelection.status).toBe(400);
    await expect(missingSelection.json()).resolves.toMatchObject({
      error: { code: 'TENANT_SELECTION_REQUIRED' },
    });
    expect(foreignSelection.status).toBe(403);
    await expect(foreignSelection.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });

  it('lists only accessible businesses before tenant resolution', async () => {
    const response = await request('/businesses', { headers: { cookie } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      businesses: [
        {
          id: businessId,
          name: 'HTTP Atlas Shop',
          category: 'RETAIL',
          role: 'OWNER',
        },
      ],
    });
  });

  it('serves profile, rule, schema, entity, and preview workflows through tenant routes', async () => {
    const tenantHeaders = {
      cookie,
      'content-type': 'application/json',
      'x-business-id': businessId,
    };
    const profileResponse = await request('/dashboard/business-profile', {
      method: 'PATCH',
      headers: tenantHeaders,
      body: JSON.stringify({
        name: 'HTTP Atlas Shop',
        description: 'Neighborhood products',
        phone: '+212 500 000 001',
        address: 'Casablanca',
        currency: 'MAD',
        defaultLanguage: 'fr',
        supportedLanguages: ['fr', 'ar'],
        timezone: 'Africa/Casablanca',
      }),
    });
    const ruleResponse = await request('/dashboard/business-rules', {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({
        category: 'DELIVERY',
        name: 'Delivery area',
        content: 'Delivery is available within Casablanca.',
      }),
    });
    const typeResponse = await request('/dashboard/entity-types', {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({
        key: 'product',
        name: 'Products',
        description: 'Products for sale',
      }),
    });
    const fieldResponse = await request('/dashboard/entity-types/product/fields', {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({
        key: 'price',
        label: 'Price',
        type: 'NUMBER',
        required: true,
        enabled: true,
        options: null,
        displayOrder: 0,
      }),
    });
    const invalidEntityResponse = await request('/dashboard/entities/product', {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({ name: 'Argan oil', data: {} }),
    });
    const entityResponse = await request('/dashboard/entities/product', {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({ name: 'Argan oil', data: { price: 120 } }),
    });
    const previewResponse = await request('/dashboard/business-understanding', {
      headers: { cookie, 'x-business-id': businessId },
    });

    expect(profileResponse.status).toBe(200);
    expect(ruleResponse.status).toBe(201);
    expect(typeResponse.status).toBe(201);
    expect(fieldResponse.status).toBe(201);
    expect(invalidEntityResponse.status).toBe(400);
    await expect(invalidEntityResponse.json()).resolves.toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: {
          fields: [expect.objectContaining({ field: 'price' })],
        },
      },
    });
    expect(entityResponse.status).toBe(201);
    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      preview: {
        profile: { name: 'HTTP Atlas Shop' },
        activeRules: [{ name: 'Delivery area' }],
        entityTypes: [
          expect.objectContaining({
            key: 'product',
            activeEntityCount: 1,
            representativeEntities: [{ name: 'Argan oil', data: { price: 120 } }],
          }),
        ],
      },
    });
  });
});
