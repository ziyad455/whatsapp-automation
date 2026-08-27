import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { applyBusinessTemplate } from '../src/business-data/business-type-templates';
import { createTenantBusinessCatalogService } from '../src/business-data/tenant-business-catalog.service';
import { createTenantBusinessEntityQueryService } from '../src/business-data/tenant-business-entity-query.service';
import { createTenantBusinessEntityService } from '../src/business-data/tenant-business-entity.service';
import { createTenantBusinessSchemaService } from '../src/business-data/tenant-business-schema.service';
import { createTenantBusinessProfileService } from '../src/business-configuration/tenant-business-profile.service';
import { createTenantBusinessRuleService } from '../src/business-configuration/tenant-business-rule.service';
import { createTenantBusinessUnderstandingService } from '../src/business-configuration/tenant-business-understanding.service';
import {
  BUSINESS_WEEKDAYS,
  OpeningHoursValidationError,
  createTenantOpeningHoursService,
} from '../src/business-configuration/tenant-opening-hours.service';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-sprint-four-password-123';

const createTenant = async (
  slug: string,
  name: string,
  category: 'CAR_RENTAL' | 'SALON' | 'GYM',
): Promise<TenantContext> => {
  const business = await createBusiness({
    name,
    category,
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'fr',
    lifecycleStatus: 'ACTIVE',
  });
  const result = await setupAuth.api.signUpEmail({
    body: {
      email: `${slug}@example.test`,
      name: `${name} Owner`,
      password: fakePassword,
    },
  });
  const membership = await createMembership({
    userId: result.user.id,
    businessId: business.id,
    role: 'OWNER',
  });

  return Object.freeze({
    userId: result.user.id,
    businessId: business.id,
    membershipId: membership.id,
    role: membership.role,
  });
};

const clearDatabase = async () => {
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
};

describe('Sprint 4 business configuration and dashboard services', () => {
  beforeEach(clearDatabase);

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('updates only the resolved tenant profile and keeps structured locale data', async () => {
    const atlas = await createTenant('s4-atlas-profile', 'Atlas Cars', 'CAR_RENTAL');
    const nour = await createTenant('s4-nour-profile', 'Nour Beauty', 'SALON');

    const updated = await createTenantBusinessProfileService(atlas).update({
      name: 'Atlas Cars Marrakech',
      description: 'Local car rental in Marrakech',
      phone: '+212 500 000 000',
      address: 'Marrakech, Morocco',
      currency: 'mad',
      defaultLanguage: 'fr',
      supportedLanguages: ['fr', 'ar', 'fr'],
      timezone: 'Africa/Casablanca',
    });
    const unchanged = await createTenantBusinessProfileService(nour).get();

    expect(updated).toMatchObject({
      name: 'Atlas Cars Marrakech',
      currency: 'MAD',
      supportedLanguages: ['fr', 'ar'],
    });
    expect(unchanged?.name).toBe('Nour Beauty');
    expect(unchanged?.supportedLanguages).toEqual([]);
  });

  it('stores one local-time schedule per weekday and rejects invalid time ranges', async () => {
    const tenant = await createTenant('s4-hours', 'Atlas Fitness', 'GYM');
    const service = createTenantOpeningHoursService(tenant);
    const week = BUSINESS_WEEKDAYS.map(dayOfWeek => ({
      dayOfWeek,
      isOpen: dayOfWeek !== 'SUNDAY',
      opensAt: dayOfWeek === 'SUNDAY' ? null : '09:00',
      closesAt: dayOfWeek === 'SUNDAY' ? null : '18:00',
    }));

    await expect(service.replaceWeek(week)).resolves.toHaveLength(7);
    await expect(prisma.businessOpeningHour.count()).resolves.toBe(7);
    await expect(
      service.replaceWeek(
        week.map(hour =>
          hour.dayOfWeek === 'MONDAY'
            ? { ...hour, opensAt: '18:00', closesAt: '09:00' }
            : hour,
        ),
      ),
    ).rejects.toBeInstanceOf(OpeningHoursValidationError);
  });

  it('creates, edits, and deactivates tenant-owned rules without deletion', async () => {
    const atlas = await createTenant('s4-atlas-rules', 'Atlas Cars', 'CAR_RENTAL');
    const nour = await createTenant('s4-nour-rules', 'Nour Beauty', 'SALON');
    const atlasRules = createTenantBusinessRuleService(atlas);
    const nourRules = createTenantBusinessRuleService(nour);
    const rule = await atlasRules.create({
      category: 'booking',
      name: 'Deposit',
      content: 'A refundable deposit is required.',
    });

    await expect(
      nourRules.update(rule.id, { content: 'Foreign update' }),
    ).resolves.toBeNull();
    const deactivated = await atlasRules.update(rule.id, { active: false });

    expect(deactivated?.active).toBe(false);
    await expect(atlasRules.list()).resolves.toHaveLength(1);
    await expect(prisma.businessRule.count()).resolves.toBe(1);
  });

  it('proves three verticals use the same generic schema and isolates customization', async () => {
    const atlas = await createTenant('s4-atlas-data', 'Atlas Cars', 'CAR_RENTAL');
    const nour = await createTenant('s4-nour-data', 'Nour Beauty', 'SALON');
    const fitness = await createTenant('s4-fitness-data', 'Atlas Fitness', 'GYM');
    await Promise.all([
      applyBusinessTemplate(atlas),
      applyBusinessTemplate(nour),
      applyBusinessTemplate(fitness),
    ]);

    const atlasCatalog = createTenantBusinessCatalogService(atlas);
    const vehicleType = await atlasCatalog.getByKey('vehicle');
    expect(vehicleType).not.toBeNull();
    await createTenantBusinessSchemaService(atlas).addFieldDefinition({
      entityTypeId: vehicleType!.id,
      key: 'deposit',
      label: 'Deposit',
      type: 'NUMBER',
      required: true,
      displayOrder: 5,
    });
    const vehicle = await createTenantBusinessEntityService(atlas).createForType(
      'vehicle',
      {
        name: 'Renault Clio',
        data: {
          brand: 'Renault',
          model: 'Clio',
          transmission: 'automatic',
          pricePerDay: 450,
          available: true,
          deposit: 2_000,
        },
      },
    );
    const service = await createTenantBusinessEntityService(nour).createForType(
      'service',
      {
        name: 'Haircut',
        data: { price: 120, durationMinutes: 45, gender: 'men', available: true },
      },
    );
    const membership = await createTenantBusinessEntityService(fitness).createForType(
      'membership',
      {
        name: 'Monthly',
        data: { price: 350, durationMonths: 1, includesCoach: true },
      },
    );
    const nourServiceType = await createTenantBusinessCatalogService(nour).getByKey(
      'service',
    );

    expect(vehicle?.data).toMatchObject({ deposit: 2_000 });
    expect(service?.data).toMatchObject({ durationMinutes: 45 });
    expect(membership?.data).toMatchObject({ durationMonths: 1 });
    expect(nourServiceType?.fieldDefinitions.map(field => field.key)).not.toContain(
      'deposit',
    );
    await expect(
      createTenantBusinessEntityService(nour).getByType('vehicle', vehicle!.id),
    ).resolves.toBeNull();
  });

  it('preserves disabled historical values, archives safely, and assembles active preview data', async () => {
    const tenant = await createTenant('s4-preview', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(tenant);
    const catalog = createTenantBusinessCatalogService(tenant);
    const vehicleType = await catalog.getByKey('vehicle');
    const schema = createTenantBusinessSchemaService(tenant);
    const entities = createTenantBusinessEntityService(tenant);
    const deposit = await schema.addFieldDefinition({
      entityTypeId: vehicleType!.id,
      key: 'deposit',
      label: 'Deposit',
      type: 'NUMBER',
      displayOrder: 5,
    });
    const vehicle = await entities.createForType('vehicle', {
      name: 'Dacia Duster',
      data: {
        brand: 'Dacia',
        model: 'Duster',
        pricePerDay: 600,
        available: true,
        deposit: 2_500,
      },
    });
    await schema.updateFieldDefinition(deposit!.id, { enabled: false });
    const updated = await entities.update('vehicle', vehicle!.id, {
      name: 'Dacia Duster 2025',
      data: {
        brand: 'Dacia',
        model: 'Duster',
        pricePerDay: 650,
        available: true,
      },
    });
    await createTenantBusinessRuleService(tenant).create({
      category: 'BOOKING',
      name: 'Deposit',
      content: 'Deposit is required.',
    });
    const firstPreview = await createTenantBusinessUnderstandingService(
      tenant,
    ).getPreview();
    const secondPreview = await createTenantBusinessUnderstandingService(
      tenant,
    ).getPreview();

    expect(updated?.data).toMatchObject({ deposit: 2_500, pricePerDay: 650 });
    expect(firstPreview).toEqual(secondPreview);
    await expect(
      createTenantBusinessEntityQueryService(tenant).search({
        entityType: 'vehicle',
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: vehicle!.id })] });
    await entities.archive('vehicle', vehicle!.id);
    await expect(
      createTenantBusinessEntityQueryService(tenant).search({ entityType: 'vehicle' }),
    ).resolves.toMatchObject({ items: [] });
  });
});
