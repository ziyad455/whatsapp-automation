import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import {
  createTenantBusinessDataRepository,
  type CreateBusinessEntityInput,
  type CreateBusinessEntityTypeInput,
} from '../src/business-data/tenant-business-data.repository';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import type { BusinessFieldType } from '../src/generated/prisma/client';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-dynamic-business-data-password-123';

const fieldTypes = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTI_SELECT',
] as const satisfies readonly BusinessFieldType[];

type Fixtures = {
  carDealer: TenantContext;
  salon: TenantContext;
  gym: TenantContext;
};

let fixtures: Fixtures;

const createTestTenant = async (
  slug: string,
  businessName: string,
  category: string,
): Promise<TenantContext> => {
  const business = await createBusiness({
    name: businessName,
    category,
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'fr',
    lifecycleStatus: 'ACTIVE',
  });
  const authResult = await setupAuth.api.signUpEmail({
    body: {
      email: `${slug}@example.test`,
      name: `${businessName} Owner`,
      password: fakePassword,
    },
  });
  const membership = await createMembership({
    userId: authResult.user.id,
    businessId: business.id,
    role: 'OWNER',
  });

  return Object.freeze({
    userId: authResult.user.id,
    businessId: business.id,
    membershipId: membership.id,
    role: membership.role,
  });
};

describe('tenant-scoped dynamic business data', () => {
  beforeEach(async () => {
    await prisma.businessFieldDefinition.deleteMany();
    await prisma.businessEntity.deleteMany();
    await prisma.businessEntityType.deleteMany();
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();

    const [carDealer, salon, gym] = await Promise.all([
      createTestTenant('atlas-cars', 'Atlas Cars', 'CAR_DEALERSHIP'),
      createTestTenant('nour-beauty', 'Nour Beauty', 'SALON'),
      createTestTenant('atlas-fitness', 'Atlas Fitness', 'GYM'),
    ]);

    fixtures = { carDealer, salon, gym };
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('stores tenant-owned entity types with tenant-local normalized keys', async () => {
    expectTypeOf(createTenantBusinessDataRepository)
      .parameter(0)
      .toEqualTypeOf<TenantContext>();
    expectTypeOf<CreateBusinessEntityTypeInput['businessId']>().toEqualTypeOf<
      undefined
    >();

    const carRepository = createTenantBusinessDataRepository(fixtures.carDealer);
    const salonRepository = createTenantBusinessDataRepository(fixtures.salon);
    const vehicle = await carRepository.createEntityType({
      key: ' Vehicle ',
      name: 'Vehicle',
      description: 'Vehicles available for sale',
    });
    const salonVehicle = await salonRepository.createEntityType({
      key: 'VEHICLE',
      name: 'Promotional Vehicle',
      schemaVersion: 2,
    });

    expect(vehicle).toMatchObject({
      businessId: fixtures.carDealer.businessId,
      key: 'vehicle',
      name: 'Vehicle',
      schemaVersion: 1,
    });
    expect(salonVehicle).toMatchObject({
      businessId: fixtures.salon.businessId,
      key: 'vehicle',
      schemaVersion: 2,
    });
    await expect(
      carRepository.createEntityType({ key: 'VEHICLE', name: 'Duplicate Vehicle' }),
    ).rejects.toThrow();
    await expect(carRepository.findEntityTypeById(salonVehicle.id)).resolves.toBeNull();
    await expect(carRepository.listEntityTypes()).resolves.toEqual([vehicle]);
  });

  it('stores ordered field definitions, all supported types, and JSONB options', async () => {
    const carRepository = createTenantBusinessDataRepository(fixtures.carDealer);
    const salonRepository = createTenantBusinessDataRepository(fixtures.salon);
    const [vehicle, service] = await Promise.all([
      carRepository.createEntityType({ key: 'vehicle', name: 'Vehicle' }),
      salonRepository.createEntityType({ key: 'service', name: 'Service' }),
    ]);

    for (const [displayOrder, type] of fieldTypes.entries()) {
      await carRepository.createFieldDefinition({
        entityTypeId: vehicle.id,
        key: type.toLowerCase(),
        label: type,
        type,
        required: type === 'TEXT',
        options:
          type === 'SELECT'
            ? ['sedan', 'suv']
            : type === 'MULTI_SELECT'
              ? [
                  { value: 'air-conditioning', label: 'Air conditioning' },
                  { value: 'navigation', label: 'Navigation' },
                ]
              : undefined,
        displayOrder,
      });
    }

    const fields = await carRepository.listFieldDefinitions(vehicle.id);

    expect(fields.map(field => field.type)).toEqual(fieldTypes);
    expect(fields.map(field => field.displayOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fields.find(field => field.type === 'SELECT')?.options).toEqual([
      'sedan',
      'suv',
    ]);
    expect(fields.find(field => field.type === 'MULTI_SELECT')?.options).toEqual([
      { value: 'air-conditioning', label: 'Air conditioning' },
      { value: 'navigation', label: 'Navigation' },
    ]);
    expect(fields.find(field => field.type === 'TEXT')).toMatchObject({ required: true });
    expect(fields.find(field => field.type === 'NUMBER')?.options).toBeNull();

    await expect(
      carRepository.createFieldDefinition({
        entityTypeId: vehicle.id,
        key: 'text',
        label: 'Duplicate text',
        type: 'TEXT',
        displayOrder: 8,
      }),
    ).rejects.toThrow();
    await expect(
      salonRepository.createFieldDefinition({
        entityTypeId: service.id,
        key: 'text',
        label: 'Service name',
        type: 'TEXT',
        displayOrder: 0,
      }),
    ).resolves.toMatchObject({ entityTypeId: service.id, key: 'text' });
    await expect(
      carRepository.createFieldDefinition({
        entityTypeId: service.id,
        key: 'crossTenant',
        label: 'Cross tenant',
        type: 'TEXT',
        displayOrder: 9,
      }),
    ).resolves.toBeNull();
    await expect(carRepository.listFieldDefinitions(service.id)).resolves.toEqual([]);
  });

  it('stores different business shapes in the same JSONB-backed entity model', async () => {
    const carRepository = createTenantBusinessDataRepository(fixtures.carDealer);
    const salonRepository = createTenantBusinessDataRepository(fixtures.salon);
    const gymRepository = createTenantBusinessDataRepository(fixtures.gym);
    const [vehicleType, serviceType, membershipType] = await Promise.all([
      carRepository.createEntityType({ key: 'vehicle', name: 'Vehicle' }),
      salonRepository.createEntityType({ key: 'service', name: 'Service' }),
      gymRepository.createEntityType({ key: 'membership', name: 'Membership' }),
    ]);
    const vehicleData = {
      make: 'Renault',
      model: 'Clio',
      year: 2024,
      available: true,
      features: ['navigation', 'air-conditioning'],
    };
    const serviceData = { durationMinutes: 45, price: 180, category: 'hair' };
    const membershipData = {
      durationMonths: 1,
      price: 350,
      benefits: ['gym', 'classes'],
    };
    const [vehicle, service, membership] = await Promise.all([
      carRepository.createEntity({
        entityTypeId: vehicleType.id,
        name: 'Renault Clio 2024',
        data: vehicleData,
      }),
      salonRepository.createEntity({
        entityTypeId: serviceType.id,
        name: 'Haircut',
        data: serviceData,
      }),
      gymRepository.createEntity({
        entityTypeId: membershipType.id,
        name: 'Monthly Premium',
        data: membershipData,
        status: 'ARCHIVED',
      }),
    ]);

    expect(vehicle).toMatchObject({ data: vehicleData, status: 'ACTIVE' });
    expect(service).toMatchObject({ data: serviceData, status: 'ACTIVE' });
    expect(membership).toMatchObject({ data: membershipData, status: 'ARCHIVED' });
    await expect(prisma.businessEntity.count()).resolves.toBe(3);
    await expect(carRepository.findEntityById(vehicle?.id ?? '')).resolves.toEqual(vehicle);
    await expect(
      gymRepository.listEntities({ entityTypeId: membershipType.id, status: 'ARCHIVED' }),
    ).resolves.toEqual([membership]);
  });

  it('denies cross-tenant entity access and enforces type ownership in PostgreSQL', async () => {
    const carRepository = createTenantBusinessDataRepository(fixtures.carDealer);
    const salonRepository = createTenantBusinessDataRepository(fixtures.salon);
    const salonServiceType = await salonRepository.createEntityType({
      key: 'service',
      name: 'Service',
    });
    const salonService = await salonRepository.createEntity({
      entityTypeId: salonServiceType.id,
      name: 'Haircut',
      data: { durationMinutes: 45 },
    });

    await expect(carRepository.findEntityById(salonService?.id ?? '')).resolves.toBeNull();
    await expect(
      carRepository.listEntities({ entityTypeId: salonServiceType.id }),
    ).resolves.toEqual([]);
    await expect(
      carRepository.createEntity({
        entityTypeId: salonServiceType.id,
        name: 'Cross-tenant entity',
        data: {},
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.businessEntity.create({
        data: {
          businessId: fixtures.carDealer.businessId,
          entityTypeId: salonServiceType.id,
          name: 'Database bypass attempt',
          data: {},
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.businessEntity.count({
        where: { businessId: fixtures.carDealer.businessId },
      }),
    ).resolves.toBe(0);
  });

  it('derives ownership from TenantContext even when an untyped caller spoofs it', async () => {
    const carRepository = createTenantBusinessDataRepository(fixtures.carDealer);
    const spoofedTypeInput = {
      key: 'vehicle',
      name: 'Vehicle',
      businessId: fixtures.salon.businessId,
    };

    // @ts-expect-error Tenant ownership is deliberately forbidden in create DTOs.
    const vehicleType = await carRepository.createEntityType(spoofedTypeInput);
    const spoofedEntityInput = {
      entityTypeId: vehicleType.id,
      name: 'Tenant-owned vehicle',
      data: { reference: randomUUID() },
      businessId: fixtures.salon.businessId,
    };

    // @ts-expect-error Tenant ownership is deliberately forbidden in create DTOs.
    const entity = await carRepository.createEntity(spoofedEntityInput);

    expect(vehicleType.businessId).toBe(fixtures.carDealer.businessId);
    expect(entity?.businessId).toBe(fixtures.carDealer.businessId);
    await expect(
      prisma.businessEntityType.count({
        where: { businessId: fixtures.salon.businessId },
      }),
    ).resolves.toBe(0);
  });

  it('keeps the entity create DTO tenant-ownership-free at compile time', () => {
    expectTypeOf<CreateBusinessEntityInput['businessId']>().toEqualTypeOf<undefined>();
  });
});
