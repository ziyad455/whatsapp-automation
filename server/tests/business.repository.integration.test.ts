import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createBusiness, findBusinessById } from '../src/businesses/business.repository';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

describe('business repository', () => {
  beforeEach(async () => {
    await prisma.business.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('creates and reads a business with its required configuration', async () => {
    const beforeCreation = new Date();
    const business = await createBusiness({
      name: '  Atlas Cars Marrakech  ',
      category: 'car_rental',
      timezone: '  Africa/Casablanca  ',
      currency: 'mad',
      defaultLanguage: 'FR',
      lifecycleStatus: 'ACTIVE',
    });
    const afterCreation = new Date();

    expect(business).toMatchObject({
      name: 'Atlas Cars Marrakech',
      category: 'CAR_RENTAL',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    expect(business.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(business.createdAt).toBeInstanceOf(Date);
    expect(business.updatedAt).toBeInstanceOf(Date);
    expect(business.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
    expect(business.createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    expect(business.updatedAt.getTime()).toBeGreaterThanOrEqual(business.createdAt.getTime());
    await expect(findBusinessById(business.id)).resolves.toEqual(business);
  });

  it.each(['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const)(
    'persists the %s lifecycle status',
    async lifecycleStatus => {
      const business = await createBusiness({
        name: `${lifecycleStatus} Business`,
        category: 'SALON',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        defaultLanguage: 'ar',
        lifecycleStatus,
      });

      expect(business.lifecycleStatus).toBe(lifecycleStatus);
    },
  );

  it('allows two businesses to share the same display name', async () => {
    const firstBusiness = await createBusiness({
      name: 'Shared Business Name',
      category: 'SALON',
      timezone: 'Africa/Casablanca',
      currency: 'MAD',
      defaultLanguage: 'fr',
      lifecycleStatus: 'ACTIVE',
    });
    const secondBusiness = await createBusiness({
      name: 'Shared Business Name',
      category: 'GYM',
      timezone: 'Europe/Paris',
      currency: 'EUR',
      defaultLanguage: 'en',
      lifecycleStatus: 'INACTIVE',
    });

    expect(secondBusiness.name).toBe(firstBusiness.name);
    expect(secondBusiness.id).not.toBe(firstBusiness.id);
  });

  it('rejects lifecycle values outside the database enum', async () => {
    await expect(
      prisma.$executeRaw`
        insert into businesses (
          name,
          category,
          timezone,
          currency,
          default_language,
          lifecycle_status
        ) values (
          'Invalid Lifecycle Business',
          'GYM',
          'Africa/Casablanca',
          'MAD',
          'en',
          'DELETED'::business_lifecycle_status
        )
      `,
    ).rejects.toThrow();
  });
});
