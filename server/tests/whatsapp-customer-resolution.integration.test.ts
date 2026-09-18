import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import { resolveWhatsAppTenant } from '../src/whatsapp/whatsapp-tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

const createTestBusiness = (name: string) => createBusiness({
  name,
  category: 'CAR_RENTAL',
  timezone: 'Africa/Casablanca',
  currency: 'MAD',
  defaultLanguage: 'en',
  lifecycleStatus: 'ACTIVE',
});

const createTenant = async (name: string, phoneNumberId: string) => {
  const business = await createTestBusiness(name);
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId,
    whatsappBusinessAccountId: `9${phoneNumberId.slice(1)}`,
  });
  const tenant = await resolveWhatsAppTenant(connection.phoneNumberId);
  if (!tenant) throw new Error('Expected the WhatsApp tenant fixture to resolve.');
  return { business, tenant };
};

describe('tenant-scoped WhatsApp customer resolution', () => {
  beforeEach(async () => {
    await prisma.customer.deleteMany();
    await prisma.whatsAppConnection.deleteMany();
    await prisma.business.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('creates once and resolves the same customer for repeat messages', async () => {
    const { business, tenant } = await createTenant(
      'Customer Resolution Atlas',
      '111111111111111',
    );

    const first = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');
    const second = await resolveOrCreateWhatsAppCustomer(tenant, '212600000001');

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      businessId: business.id,
      whatsappPhone: '212600000001',
    });
    await expect(prisma.customer.count({
      where: { businessId: business.id, whatsappPhone: '212600000001' },
    })).resolves.toBe(1);
  });

  it('creates different tenant-owned customers for the same sender', async () => {
    const [atlas, barber] = await Promise.all([
      createTenant('Customer Isolation Atlas', '222222222222221'),
      createTenant('Customer Isolation Barber', '222222222222222'),
    ]);

    const [atlasCustomer, barberCustomer] = await Promise.all([
      resolveOrCreateWhatsAppCustomer(atlas.tenant, '212600000002'),
      resolveOrCreateWhatsAppCustomer(barber.tenant, '212600000002'),
    ]);

    expect(atlasCustomer.id).not.toBe(barberCustomer.id);
    expect(atlasCustomer.businessId).toBe(atlas.business.id);
    expect(barberCustomer.businessId).toBe(barber.business.id);
  });

  it('concurrently resolves one record for one tenant and sender', async () => {
    const { business, tenant } = await createTenant(
      'Concurrent Customer Resolution',
      '333333333333333',
    );

    const customers = await Promise.all(
      Array.from({ length: 8 }, () =>
        resolveOrCreateWhatsAppCustomer(tenant, '212600000003')),
    );

    expect(new Set(customers.map(customer => customer.id))).toHaveLength(1);
    await expect(prisma.customer.count({
      where: { businessId: business.id, whatsappPhone: '212600000003' },
    })).resolves.toBe(1);
  });

  it('enforces tenant-scoped uniqueness in PostgreSQL', async () => {
    const { business } = await createTenant(
      'Customer Database Constraint',
      '444444444444444',
    );
    const data = {
      businessId: business.id,
      whatsappPhone: '212600000004',
    };

    await prisma.customer.create({ data });
    await expect(prisma.customer.create({ data })).rejects.toThrow();
  });
});
