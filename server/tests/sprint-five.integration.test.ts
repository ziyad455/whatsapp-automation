import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTenantAuditQueryService,
} from '../src/audit/tenant-audit.service';
import { createAuth } from '../src/auth/auth';
import { applyBusinessTemplate } from '../src/business-data/business-type-templates';
import { createDatabaseBusinessDataProvider } from '../src/business-data/database-business-data-provider';
import { DynamicEntityValidationError } from '../src/business-data/dynamic-entity-validation';
import { createTenantBusinessCatalogService } from '../src/business-data/tenant-business-catalog.service';
import { createTenantBusinessEntityService } from '../src/business-data/tenant-business-entity.service';
import { createTenantBusinessSchemaService } from '../src/business-data/tenant-business-schema.service';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const setupAuth = createAuth({ signUpEnabled: true });
const fakePassword = 'fake-sprint-five-password-123';

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
  await prisma.auditEvent.deleteMany();
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

const fieldValue = (
  entity: Awaited<ReturnType<ReturnType<typeof createDatabaseBusinessDataProvider>['getEntity']>>,
  key: string,
) => entity?.fields.find(field => field.key === key)?.value;

describe('Sprint 5 current business-data architecture', () => {
  beforeEach(clearDatabase);

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('stores server-controlled MANUAL provenance and does not trust client source fields', async () => {
    const atlas = await createTenant('s5-provenance-atlas', 'Atlas Cars', 'CAR_RENTAL');
    const nour = await createTenant('s5-provenance-nour', 'Nour Beauty', 'SALON');
    await Promise.all([applyBusinessTemplate(atlas), applyBusinessTemplate(nour)]);
    const forgedInput = {
      name: 'Renault Clio',
      data: {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 400,
        available: true,
      },
      source: 'API',
      externalId: 'forged-external-record',
    };
    const entity = await createTenantBusinessEntityService(atlas).createForType(
      'vehicle',
      forgedInput,
    );

    expect(entity).toMatchObject({ source: 'MANUAL', externalId: null });
    expect(entity?.lastVerifiedAt).toBeInstanceOf(Date);
    await expect(
      createDatabaseBusinessDataProvider(nour).getEntity('vehicle', entity!.id),
    ).resolves.toBeNull();
    await expect(
      createTenantAuditQueryService(nour).list({ targetId: entity!.id }),
    ).resolves.toEqual([]);
  });

  it('keeps stable, changing, and real-time fields together in one generic schema', async () => {
    const atlas = await createTenant('s5-freshness-fields', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(atlas);
    const schema = await createTenantBusinessCatalogService(atlas).getByKey('vehicle');
    const classifications = Object.fromEntries(
      schema!.fieldDefinitions.map(field => [field.key, field.freshnessClass]),
    );

    expect(classifications.brand).toBe('STABLE');
    expect(classifications.pricePerDay).toBe('CHANGING');
    expect(classifications.available).toBe('REAL_TIME');
  });

  it('returns changed price and availability on the next provider read with an explanatory audit trail', async () => {
    const atlas = await createTenant('s5-request-time', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(atlas);
    const entities = createTenantBusinessEntityService(atlas);
    const provider = createDatabaseBusinessDataProvider(atlas);
    const vehicle = await entities.createForType('vehicle', {
      name: 'Renault Clio',
      data: {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 400,
        available: true,
      },
    });

    expect(fieldValue(await provider.getEntity('vehicle', vehicle!.id), 'pricePerDay')).toBe(400);
    expect(fieldValue(await provider.getEntity('vehicle', vehicle!.id), 'available')).toBe(true);

    await entities.update('vehicle', vehicle!.id, {
      name: 'Renault Clio',
      data: {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: false,
      },
    });

    const current = await provider.getEntity('vehicle', vehicle!.id);
    expect(fieldValue(current, 'pricePerDay')).toBe(450);
    expect(fieldValue(current, 'available')).toBe(false);

    const audit = await createTenantAuditQueryService(atlas).list({
      targetType: 'BUSINESS_ENTITY',
      targetId: vehicle!.id,
    });
    const update = audit.find(event => event.action === 'UPDATE');
    expect(update).toMatchObject({
      businessId: atlas.businessId,
      actorUserId: atlas.userId,
      actorKind: 'USER',
      targetType: 'BUSINESS_ENTITY',
      targetId: vehicle!.id,
      action: 'UPDATE',
    });
    expect(update?.before).toMatchObject({
      data: { pricePerDay: 400, available: true },
    });
    expect(update?.after).toMatchObject({
      data: { pricePerDay: 450, available: false },
    });
    expect(update?.createdAt).toBeInstanceOf(Date);
  });

  it('calculates stale, fresh, and unknown field metadata without wall-clock waits', async () => {
    const atlas = await createTenant('s5-staleness', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(atlas);
    const catalog = await createTenantBusinessCatalogService(atlas).getByKey('vehicle');
    const priceField = catalog!.fieldDefinitions.find(
      field => field.key === 'pricePerDay',
    );
    await createTenantBusinessSchemaService(atlas).updateFieldDefinition(
      priceField!.id,
      { staleAfterSeconds: 60 },
    );
    const entities = createTenantBusinessEntityService(atlas);
    const vehicle = await entities.createForType('vehicle', {
      name: 'Renault Clio',
      data: {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 450,
        available: true,
      },
    });
    const currentTime = new Date('2030-01-01T12:00:00.000Z');
    const provider = createDatabaseBusinessDataProvider(atlas, {
      now: () => currentTime,
    });

    await entities.verify(
      'vehicle',
      vehicle!.id,
      new Date('2030-01-01T11:58:00.000Z'),
    );
    const stale = await provider.getEntity('vehicle', vehicle!.id);
    expect(
      stale?.fields.find(field => field.key === 'pricePerDay')?.metadata,
    ).toMatchObject({ freshnessStatus: 'STALE', isStale: true });

    const oldUpdatedAt = new Date('2029-01-01T00:00:00.000Z');
    await prisma.businessEntity.update({
      where: { id: vehicle!.id },
      data: { updatedAt: oldUpdatedAt },
    });
    const verified = await entities.verify('vehicle', vehicle!.id, currentTime);
    const fresh = await provider.getEntity('vehicle', vehicle!.id);
    expect(verified?.data).toMatchObject({ pricePerDay: 450 });
    expect(verified?.updatedAt).toEqual(oldUpdatedAt);
    expect(verified?.lastVerifiedAt).toEqual(currentTime);
    expect(
      fresh?.fields.find(field => field.key === 'pricePerDay')?.metadata,
    ).toMatchObject({ freshnessStatus: 'FRESH', isStale: false });

    await prisma.businessEntity.update({
      where: { id: vehicle!.id },
      data: { lastVerifiedAt: null },
    });
    const unknown = await provider.getEntity('vehicle', vehicle!.id);
    expect(
      unknown?.fields.find(field => field.key === 'pricePerDay')?.metadata,
    ).toMatchObject({ freshnessStatus: 'UNKNOWN', isStale: null });
  });

  it('archives without deletion, preserves history, and restores current visibility', async () => {
    const atlas = await createTenant('s5-archive', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(atlas);
    const entities = createTenantBusinessEntityService(atlas);
    const provider = createDatabaseBusinessDataProvider(atlas);
    const vehicle = await entities.createForType('vehicle', {
      name: 'Dacia Sandero',
      data: {
        brand: 'Dacia',
        model: 'Sandero',
        pricePerDay: 350,
        available: true,
      },
    });

    await expect(provider.getEntity('vehicle', vehicle!.id)).resolves.not.toBeNull();
    await entities.archive('vehicle', vehicle!.id);
    await expect(provider.getEntity('vehicle', vehicle!.id)).resolves.toBeNull();
    await expect(provider.searchEntities({ entityType: 'vehicle' })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      prisma.businessEntity.count({ where: { id: vehicle!.id } }),
    ).resolves.toBe(1);
    const history = await createTenantAuditQueryService(atlas).list({
      targetId: vehicle!.id,
    });
    expect(history.some(event => event.action === 'ARCHIVE')).toBe(true);

    await entities.restore('vehicle', vehicle!.id);
    await expect(provider.getEntity('vehicle', vehicle!.id)).resolves.not.toBeNull();
    const restoredHistory = await createTenantAuditQueryService(atlas).list({
      targetId: vehicle!.id,
    });
    expect(restoredHistory.some(event => event.action === 'RESTORE')).toBe(true);
  });

  it('uses the same provider implementation for three verticals and preserves tenant isolation', async () => {
    const tenants = await Promise.all([
      createTenant('s5-provider-atlas', 'Atlas Cars', 'CAR_RENTAL'),
      createTenant('s5-provider-nour', 'Nour Beauty', 'SALON'),
      createTenant('s5-provider-fitness', 'Atlas Fitness', 'GYM'),
    ]);
    await Promise.all(tenants.map(applyBusinessTemplate));
    const providers = tenants.map(tenant => createDatabaseBusinessDataProvider(tenant));
    const profiles = await Promise.all(
      providers.map(provider => provider.getBusinessProfile()),
    );
    const entityTypes = await Promise.all(
      providers.map(provider => provider.listEntityTypes()),
    );

    expect(profiles.map(profile => profile?.name)).toEqual([
      'Atlas Cars',
      'Nour Beauty',
      'Atlas Fitness',
    ]);
    expect(entityTypes.map(types => types.map(type => type.key))).toEqual([
      ['vehicle'],
      ['service'],
      ['membership'],
    ]);
  });

  it('does not append an update audit event when entity validation aborts the transaction', async () => {
    const atlas = await createTenant('s5-transaction', 'Atlas Cars', 'CAR_RENTAL');
    await applyBusinessTemplate(atlas);
    const entities = createTenantBusinessEntityService(atlas);
    const vehicle = await entities.createForType('vehicle', {
      name: 'Renault Clio',
      data: {
        brand: 'Renault',
        model: 'Clio',
        pricePerDay: 400,
        available: true,
      },
    });
    const audit = createTenantAuditQueryService(atlas);
    const beforeCount = (await audit.list({ targetId: vehicle!.id })).length;

    await expect(
      entities.update('vehicle', vehicle!.id, {
        name: 'Invalid update',
        data: {
          brand: 'Renault',
          model: 'Clio',
          pricePerDay: 'not-a-number',
          available: true,
        },
      }),
    ).rejects.toBeInstanceOf(DynamicEntityValidationError);

    expect((await audit.list({ targetId: vehicle!.id })).length).toBe(beforeCount);
    await expect(
      prisma.businessEntity.findUnique({ where: { id: vehicle!.id } }),
    ).resolves.toMatchObject({ data: { pricePerDay: 400 } });
    expect(audit).not.toHaveProperty('update');
    expect(audit).not.toHaveProperty('delete');
  });

});
