import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { applyBusinessTemplate } from '../src/business-data/business-type-templates';
import { createTenantBusinessDataRepository } from '../src/business-data/tenant-business-data.repository';
import {
  DynamicEntityQueryError,
  createTenantBusinessEntityQueryService,
  type TenantBusinessEntityQueryService,
} from '../src/business-data/tenant-business-entity-query.service';
import { createTenantBusinessEntityService } from '../src/business-data/tenant-business-entity.service';
import {
  BusinessSchemaChangeError,
  createTenantBusinessSchemaService,
} from '../src/business-data/tenant-business-schema.service';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-sprint-three-architecture-password-123';

type TenantFixture = {
  name: string;
  tenant: TenantContext;
};

type Fixtures = {
  carDealer: TenantFixture;
  salon: TenantFixture;
  gym: TenantFixture;
};

let fixtures: Fixtures;

const createTestTenant = async (
  slug: string,
  name: string,
  category: string,
): Promise<TenantFixture> => {
  const business = await createBusiness({
    name,
    category,
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'fr',
    lifecycleStatus: 'ACTIVE',
  });
  const authResult = await setupAuth.api.signUpEmail({
    body: {
      email: `${slug}@example.test`,
      name: `${name} Owner`,
      password: fakePassword,
    },
  });
  const membership = await createMembership({
    userId: authResult.user.id,
    businessId: business.id,
    role: 'OWNER',
  });

  return {
    name,
    tenant: Object.freeze({
      userId: authResult.user.id,
      businessId: business.id,
      membershipId: membership.id,
      role: membership.role,
    }),
  };
};

const getEntityType = (tenant: TenantContext, key: string) =>
  prisma.businessEntityType.findUniqueOrThrow({
    where: {
      businessId_key: {
        businessId: tenant.businessId,
        key,
      },
    },
    include: {
      fieldDefinitions: {
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });

const seedTemplates = async () => {
  await Promise.all([
    applyBusinessTemplate(fixtures.carDealer.tenant),
    applyBusinessTemplate(fixtures.salon.tenant),
    applyBusinessTemplate(fixtures.gym.tenant),
  ]);
};

const seedEntities = async () => {
  const [vehicleType, serviceType, membershipType] = await Promise.all([
    getEntityType(fixtures.carDealer.tenant, 'vehicle'),
    getEntityType(fixtures.salon.tenant, 'service'),
    getEntityType(fixtures.gym.tenant, 'membership'),
  ]);
  const carEntities = createTenantBusinessEntityService(fixtures.carDealer.tenant);
  const salonEntities = createTenantBusinessEntityService(fixtures.salon.tenant);
  const gymEntities = createTenantBusinessEntityService(fixtures.gym.tenant);

  const renaultClio = await carEntities.create({
    entityTypeId: vehicleType.id,
    name: 'Renault Clio',
    data: {
      brand: 'Renault',
      model: 'Clio',
      transmission: 'automatic',
      pricePerDay: 450,
      available: true,
    },
  });
  const daciaDuster = await carEntities.create({
    entityTypeId: vehicleType.id,
    name: 'Dacia Duster',
    data: {
      brand: 'Dacia',
      model: 'Duster',
      transmission: 'manual',
      pricePerDay: 600,
      available: true,
    },
  });
  const haircut = await salonEntities.create({
    entityTypeId: serviceType.id,
    name: 'Haircut',
    data: { price: 120, durationMinutes: 45, gender: 'men', available: true },
  });
  const facialTreatment = await salonEntities.create({
    entityTypeId: serviceType.id,
    name: 'Facial Treatment',
    data: { price: 300, durationMinutes: 60, gender: 'women', available: true },
  });
  const monthlyPremium = await gymEntities.create({
    entityTypeId: membershipType.id,
    name: 'Monthly Premium',
    data: { price: 350, durationMonths: 1, includesCoach: true },
  });
  const annualStandard = await gymEntities.create({
    entityTypeId: membershipType.id,
    name: 'Annual Standard',
    data: { price: 2_800, durationMonths: 12, includesCoach: false },
    status: 'ARCHIVED',
  });

  return {
    renaultClio,
    daciaDuster,
    haircut,
    facialTreatment,
    monthlyPremium,
    annualStandard,
  };
};

describe('complete dynamic business-data architecture', () => {
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
      createTestTenant('s3-atlas-cars', 'Atlas Cars', 'CAR_RENTAL'),
      createTestTenant('s3-nour-beauty', 'Nour Beauty', 'SALON'),
      createTestTenant('s3-atlas-fitness', 'Atlas Fitness', 'GYM'),
    ]);

    fixtures = { carDealer, salon, gym };
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('applies idempotent templates as tenant-owned generic schemas', async () => {
    await seedTemplates();

    const [vehicle, service, membership] = await Promise.all([
      getEntityType(fixtures.carDealer.tenant, 'vehicle'),
      getEntityType(fixtures.salon.tenant, 'service'),
      getEntityType(fixtures.gym.tenant, 'membership'),
    ]);

    expect(vehicle.fieldDefinitions.map(field => field.key)).toEqual([
      'brand',
      'model',
      'transmission',
      'pricePerDay',
      'available',
    ]);
    expect(service.fieldDefinitions.map(field => field.key)).toEqual([
      'price',
      'durationMinutes',
      'gender',
      'available',
    ]);
    expect(membership.fieldDefinitions.map(field => field.key)).toEqual([
      'price',
      'durationMonths',
      'includesCoach',
    ]);
    expect([vehicle, service, membership].every(entityType => entityType.schemaVersion === 1))
      .toBe(true);

    await expect(applyBusinessTemplate(fixtures.carDealer.tenant)).resolves.toEqual({
      category: 'CAR_RENTAL',
      createdEntityTypeKeys: [],
      skippedEntityTypeKeys: ['vehicle'],
    });
    await expect(prisma.businessEntityType.count()).resolves.toBe(3);
    await expect(prisma.businessFieldDefinition.count()).resolves.toBe(12);

    const forbiddenTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'vehicle', 'vehicles', 'salon_service', 'salon_services',
          'gym_membership', 'gym_memberships'
        )
    `;

    expect(forbiddenTables).toEqual([]);
  });

  it('keeps template customization tenant-local and schema versions independent', async () => {
    const secondCarDealer = await createTestTenant(
      's3-second-car-rental',
      'Sahara Cars',
      'CAR_RENTAL',
    );
    await Promise.all([
      applyBusinessTemplate(fixtures.carDealer.tenant),
      applyBusinessTemplate(secondCarDealer.tenant),
    ]);
    const atlasVehicle = await getEntityType(fixtures.carDealer.tenant, 'vehicle');
    const schemaService = createTenantBusinessSchemaService(fixtures.carDealer.tenant);

    await schemaService.addFieldDefinition({
      entityTypeId: atlasVehicle.id,
      key: 'deposit',
      label: 'Deposit',
      type: 'NUMBER',
      displayOrder: 5,
    });

    const [customized, unchanged] = await Promise.all([
      getEntityType(fixtures.carDealer.tenant, 'vehicle'),
      getEntityType(secondCarDealer.tenant, 'vehicle'),
    ]);

    expect(customized.fieldDefinitions.map(field => field.key)).toContain('deposit');
    expect(unchanged.fieldDefinitions.map(field => field.key)).not.toContain('deposit');
    expect(customized.schemaVersion).toBe(2);
    expect(unchanged.schemaVersion).toBe(1);
  });

  it('persists three different verticals only after schema validation', async () => {
    await seedTemplates();
    const entities = await seedEntities();

    expect(entities.renaultClio).toMatchObject({
      businessId: fixtures.carDealer.tenant.businessId,
      data: expect.objectContaining({ model: 'Clio', pricePerDay: 450 }),
    });
    expect(entities.haircut).toMatchObject({
      businessId: fixtures.salon.tenant.businessId,
      data: expect.objectContaining({ durationMinutes: 45, gender: 'men' }),
    });
    expect(entities.monthlyPremium).toMatchObject({
      businessId: fixtures.gym.tenant.businessId,
      data: expect.objectContaining({ durationMonths: 1, includesCoach: true }),
    });
    await expect(prisma.businessEntity.count()).resolves.toBe(6);

    const jsonColumns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string }>
    >`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'business_entities' AND column_name = 'data')
          OR
          (table_name = 'business_field_definitions' AND column_name = 'options')
        )
      ORDER BY table_name, column_name
    `;

    expect(jsonColumns).toEqual([
      {
        table_name: 'business_entities',
        column_name: 'data',
        data_type: 'jsonb',
      },
      {
        table_name: 'business_field_definitions',
        column_name: 'options',
        data_type: 'jsonb',
      },
    ]);
  });

  it('rejects malformed data before persistence and rejects foreign entity types', async () => {
    await seedTemplates();
    const vehicle = await getEntityType(fixtures.carDealer.tenant, 'vehicle');
    const service = await getEntityType(fixtures.salon.tenant, 'service');
    const carEntities = createTenantBusinessEntityService(fixtures.carDealer.tenant);
    const carSchema = createTenantBusinessSchemaService(fixtures.carDealer.tenant);

    await Promise.all([
      carSchema.addFieldDefinition({
        entityTypeId: vehicle.id,
        key: 'registrationDate',
        label: 'Registration date',
        type: 'DATE',
        displayOrder: 5,
      }),
      carSchema.addFieldDefinition({
        entityTypeId: vehicle.id,
        key: 'inspectionAt',
        label: 'Inspection time',
        type: 'DATETIME',
        displayOrder: 6,
      }),
      carSchema.addFieldDefinition({
        entityTypeId: vehicle.id,
        key: 'features',
        label: 'Features',
        type: 'MULTI_SELECT',
        options: ['wifi', 'air_conditioning'],
        displayOrder: 7,
      }),
    ]);

    const invalidInputs = [
      { brand: 'Renault', model: 'Clio', available: true },
      { brand: 123, model: 'Clio', pricePerDay: 450, available: true },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: '450',
        available: true,
      },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: 'true',
      },
      {
        brand: 'Renault',
        model: 'Clio',
        transmission: 'semi-automatic',
        pricePerDay: 450,
        available: true,
      },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: true,
        registrationDate: '2026-02-30',
      },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: true,
        inspectionAt: '2026-08-26 14:30',
      },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: true,
        features: ['wifi', 'spa'],
      },
      {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: true,
        secretField: 'not-defined',
      },
    ];

    for (const [index, data] of invalidInputs.entries()) {
      await expect(
        carEntities.create({
          entityTypeId: vehicle.id,
          name: `Invalid vehicle ${index}`,
          data,
        }),
      ).rejects.toMatchObject({ name: 'DynamicEntityValidationError' });
    }

    await expect(
      carEntities.create({
        entityTypeId: service.id,
        name: 'Foreign service',
        data: { price: 120 },
      }),
    ).resolves.toBeNull();
    await expect(prisma.businessEntity.count()).resolves.toBe(0);
  });

  it('queries all verticals generically with validated JSONB filters and bounded results', async () => {
    await seedTemplates();
    await seedEntities();
    const vehicle = await getEntityType(fixtures.carDealer.tenant, 'vehicle');
    const carSchema = createTenantBusinessSchemaService(fixtures.carDealer.tenant);
    const carEntities = createTenantBusinessEntityService(fixtures.carDealer.tenant);

    await carSchema.addFieldDefinition({
      entityTypeId: vehicle.id,
      key: 'features',
      label: 'Features',
      type: 'MULTI_SELECT',
      options: ['wifi', 'air_conditioning'],
      displayOrder: 5,
    });
    await carEntities.create({
      entityTypeId: vehicle.id,
      name: 'Connected Vehicle',
      data: {
        brand: 'Dacia',
        model: 'Jogger',
        transmission: 'manual',
        pricePerDay: 700,
        available: true,
        features: ['wifi'],
      },
    });
    const carQuery = createTenantBusinessEntityQueryService(fixtures.carDealer.tenant);
    const salonQuery = createTenantBusinessEntityQueryService(fixtures.salon.tenant);
    const gymQuery = createTenantBusinessEntityQueryService(fixtures.gym.tenant);

    expectTypeOf(carQuery).toEqualTypeOf<TenantBusinessEntityQueryService>();
    await expect(
      carQuery.search({ entityType: 'vehicle', search: 'Clio' }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Renault Clio' })] });
    await expect(
      carQuery.search({
        entityType: 'vehicle',
        filters: { transmission: 'automatic' },
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Renault Clio' })] });
    await expect(
      salonQuery.search({ entityType: 'service', filters: { gender: 'men' } }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Haircut' })] });
    await expect(
      gymQuery.search({
        entityType: 'membership',
        filters: { includesCoach: true },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Monthly Premium' })],
    });
    await expect(
      carQuery.search({ entityType: 'vehicle', filters: { features: 'wifi' } }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Connected Vehicle' })],
    });
    await expect(
      gymQuery.search({ entityType: 'membership', status: 'ARCHIVED' }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Annual Standard' })],
    });
    await expect(
      carQuery.search({ entityType: 'vehicle', limit: 1, offset: 1 }),
    ).resolves.toMatchObject({ items: [expect.any(Object)], limit: 1, offset: 1 });
    await expect(
      carQuery.search({ entityType: 'vehicle', search: `%' OR TRUE --` }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      carQuery.search({ entityType: 'vehicle', filters: { "x') OR TRUE --": true } }),
    ).rejects.toBeInstanceOf(DynamicEntityQueryError);
    await expect(
      carQuery.search({ entityType: 'vehicle', limit: 101 }),
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: 'INVALID_LIMIT' })],
    });
  });

  it('preserves data through safe schema changes and increments versions atomically', async () => {
    await seedTemplates();
    const vehicle = await getEntityType(fixtures.carDealer.tenant, 'vehicle');
    const carEntities = createTenantBusinessEntityService(fixtures.carDealer.tenant);
    const schemaService = createTenantBusinessSchemaService(fixtures.carDealer.tenant);
    const clioData = {
      brand: 'Renault',
      model: 'Clio',
      transmission: 'automatic',
      pricePerDay: 450,
      available: true,
    };
    const clio = await carEntities.create({
      entityTypeId: vehicle.id,
      name: 'Renault Clio',
      data: clioData,
    });
    const priceField = vehicle.fieldDefinitions.find(field => field.key === 'pricePerDay');
    const transmissionField = vehicle.fieldDefinitions.find(
      field => field.key === 'transmission',
    );

    expect(priceField).toBeDefined();
    expect(transmissionField).toBeDefined();

    const fuelType = await schemaService.addFieldDefinition({
      entityTypeId: vehicle.id,
      key: 'fuelType',
      label: 'Fuel type',
      type: 'TEXT',
      displayOrder: 5,
    });
    await schemaService.updateFieldDefinition(priceField?.id ?? '', {
      label: 'Daily rental price',
    });
    await schemaService.updateFieldDefinition(transmissionField?.id ?? '', {
      enabled: false,
    });

    await expect(prisma.businessEntity.findUnique({ where: { id: clio?.id ?? '' } }))
      .resolves.toMatchObject({ data: clioData });
    await expect(getEntityType(fixtures.carDealer.tenant, 'vehicle')).resolves.toMatchObject({
      schemaVersion: 4,
      fieldDefinitions: expect.arrayContaining([
        expect.objectContaining({ key: 'pricePerDay', label: 'Daily rental price' }),
        expect.objectContaining({ key: 'transmission', enabled: false }),
        expect.objectContaining({ key: 'fuelType', enabled: true }),
      ]),
    });

    await expect(
      carEntities.create({
        entityTypeId: vehicle.id,
        name: 'Invalid disabled-field vehicle',
        data: clioData,
      }),
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: 'DISABLED_FIELD', field: 'transmission' })],
    });

    await schemaService.updateFieldDefinition(transmissionField?.id ?? '', {
      enabled: true,
      options: ['manual', 'automatic', 'electric'],
    });
    await expect(
      carEntities.create({
        entityTypeId: vehicle.id,
        name: 'Electric vehicle',
        data: {
          brand: 'Dacia',
          model: 'Spring',
          transmission: 'electric',
          pricePerDay: 500,
          available: true,
        },
      }),
    ).resolves.toMatchObject({ name: 'Electric vehicle' });
    await expect(getEntityType(fixtures.carDealer.tenant, 'vehicle')).resolves.toMatchObject({
      schemaVersion: 5,
    });

    await expect(
      schemaService.updateFieldDefinition(transmissionField?.id ?? '', {
        options: ['manual', 'electric'],
      }),
    ).rejects.toMatchObject({ code: 'IN_USE_SELECT_OPTION_REMOVAL' });
    await expect(
      schemaService.updateFieldDefinition(priceField?.id ?? '', { type: 'TEXT' }),
    ).rejects.toMatchObject({ code: 'IN_USE_FIELD_TYPE_CHANGE' });
    await expect(
      schemaService.updateFieldDefinition(fuelType?.id ?? '', { required: true }),
    ).rejects.toMatchObject({ code: 'REQUIRED_FIELD_MISSING_IN_EXISTING_DATA' });

    const keyRename = { key: 'dailyPrice' };

    // @ts-expect-error Field keys are deliberately immutable in the update DTO.
    await expect(schemaService.updateFieldDefinition(priceField?.id ?? '', keyRename))
      .rejects.toMatchObject({ code: 'FIELD_KEY_IMMUTABLE' });
    await expect(getEntityType(fixtures.carDealer.tenant, 'vehicle')).resolves.toMatchObject({
      schemaVersion: 5,
    });
  });

  it('keeps query, schema mutation, exact reads, and entity creation tenant-isolated', async () => {
    await seedTemplates();
    const entities = await seedEntities();
    const serviceType = await getEntityType(fixtures.salon.tenant, 'service');
    const genderField = serviceType.fieldDefinitions.find(field => field.key === 'gender');
    const carQuery = createTenantBusinessEntityQueryService(fixtures.carDealer.tenant);
    const carSchema = createTenantBusinessSchemaService(fixtures.carDealer.tenant);
    const carEntities = createTenantBusinessEntityService(fixtures.carDealer.tenant);
    const gymRepository = createTenantBusinessDataRepository(fixtures.gym.tenant);

    await expect(carQuery.search({ entityType: 'service' })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      carSchema.updateFieldDefinition(genderField?.id ?? '', { label: 'Private field' }),
    ).resolves.toBeNull();
    await expect(
      carEntities.create({
        entityTypeId: serviceType.id,
        name: 'Foreign service',
        data: { price: 120 },
      }),
    ).resolves.toBeNull();
    await expect(
      gymRepository.findEntityById(entities.renaultClio?.id ?? ''),
    ).resolves.toBeNull();
    await expect(
      prisma.businessFieldDefinition.findUnique({ where: { id: genderField?.id ?? '' } }),
    ).resolves.toMatchObject({ label: 'Gender' });
    await expect(prisma.businessEntity.count()).resolves.toBe(6);
  });

  it('creates only the relational and generic JSONB indexes used by the query service', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'business_entities_business_id_entity_type_id_status_index',
          'business_entities_data_gin_index'
        )
      ORDER BY indexname
    `;

    expect(indexes).toHaveLength(2);
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexname: 'business_entities_business_id_entity_type_id_status_index',
          indexdef: expect.stringContaining('(business_id, entity_type_id, status)'),
        }),
        expect.objectContaining({
          indexname: 'business_entities_data_gin_index',
          indexdef: expect.stringMatching(/USING gin \(data jsonb_path_ops\)/i),
        }),
      ]),
    );

    const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN
      SELECT *
      FROM business_entities
      WHERE business_id = ${fixtures.carDealer.tenant.businessId}::uuid
        AND data @> ${JSON.stringify({ transmission: 'automatic' })}::jsonb
    `;

    expect(plan.map(row => row['QUERY PLAN']).join('\n')).toContain('business_entities');
  });

  it('keeps schema-change errors structured for future dashboard and tool callers', () => {
    const error = new BusinessSchemaChangeError(
      'FIELD_KEY_IMMUTABLE',
      'pricePerDay',
      'Field keys cannot be changed after creation.',
    );

    expect(error).toMatchObject({
      name: 'BusinessSchemaChangeError',
      code: 'FIELD_KEY_IMMUTABLE',
      field: 'pricePerDay',
    });
  });
});
