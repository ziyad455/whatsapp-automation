import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import {
  createWhatsAppConnection,
  findActiveWhatsAppConnectionForTenant,
} from '../src/whatsapp/whatsapp-connection.repository';
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

describe('WhatsApp phone number tenant resolution', () => {
  beforeEach(async () => {
    await prisma.whatsAppConnection.deleteMany();
    await prisma.businessUser.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.business.deleteMany();
  });

  afterAll(async () => {
    await closeDatabaseConnection();
  });

  it('maps each receiving phone number to its own business', async () => {
    const [atlas, barber] = await Promise.all([
      createTestBusiness('WhatsApp Atlas Cars'),
      createTestBusiness('WhatsApp Barber'),
    ]);
    const [atlasConnection, barberConnection] = await Promise.all([
      createWhatsAppConnection({
        businessId: atlas.id,
        phoneNumberId: '111111111111111',
        whatsappBusinessAccountId: '900000000000001',
      }),
      createWhatsAppConnection({
        businessId: barber.id,
        phoneNumberId: '222222222222222',
        whatsappBusinessAccountId: '900000000000002',
      }),
    ]);

    await expect(resolveWhatsAppTenant(atlasConnection.phoneNumberId)).resolves.toEqual({
      businessId: atlas.id,
      whatsappConnectionId: atlasConnection.id,
    });
    await expect(resolveWhatsAppTenant(barberConnection.phoneNumberId)).resolves.toEqual({
      businessId: barber.id,
      whatsappConnectionId: barberConnection.id,
    });
  });

  it('returns no tenant for unknown, malformed, or inactive numbers', async () => {
    const business = await createTestBusiness('Inactive WhatsApp Business');
    const connection = await createWhatsAppConnection({
      businessId: business.id,
      phoneNumberId: '333333333333333',
      whatsappBusinessAccountId: '900000000000003',
    });
    await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: { status: 'INACTIVE' },
    });

    await expect(resolveWhatsAppTenant('333333333333333')).resolves.toBeNull();
    await expect(resolveWhatsAppTenant('444444444444444')).resolves.toBeNull();
    await expect(resolveWhatsAppTenant('not-a-phone-number-id')).resolves.toBeNull();
  });

  it('enforces globally unique phoneNumberId values', async () => {
    const [businessA, businessB] = await Promise.all([
      createTestBusiness('Duplicate Number A'),
      createTestBusiness('Duplicate Number B'),
    ]);
    await createWhatsAppConnection({
      businessId: businessA.id,
      phoneNumberId: '555555555555555',
      whatsappBusinessAccountId: '900000000000004',
    });

    await expect(createWhatsAppConnection({
      businessId: businessB.id,
      phoneNumberId: '555555555555555',
      whatsappBusinessAccountId: '900000000000005',
    })).rejects.toThrow();
  });

  it('allows one business to own multiple WhatsApp connections', async () => {
    const business = await createTestBusiness('Multi-number Business');

    await Promise.all([
      createWhatsAppConnection({
        businessId: business.id,
        phoneNumberId: '666666666666661',
        whatsappBusinessAccountId: '900000000000006',
      }),
      createWhatsAppConnection({
        businessId: business.id,
        phoneNumberId: '666666666666662',
        whatsappBusinessAccountId: '900000000000006',
      }),
    ]);

    await expect(prisma.whatsAppConnection.count({
      where: { businessId: business.id },
    })).resolves.toBe(2);
  });

  it('uses the receiving number rather than a shared customer sender to select a tenant', async () => {
    const [atlas, barber] = await Promise.all([
      createTestBusiness('Same Customer Atlas'),
      createTestBusiness('Same Customer Barber'),
    ]);
    await Promise.all([
      createWhatsAppConnection({
        businessId: atlas.id,
        phoneNumberId: '777777777777771',
        whatsappBusinessAccountId: '900000000000007',
      }),
      createWhatsAppConnection({
        businessId: barber.id,
        phoneNumberId: '777777777777772',
        whatsappBusinessAccountId: '900000000000008',
      }),
    ]);
    const [atlasTenant, barberTenant] = await Promise.all([
      resolveWhatsAppTenant('777777777777771'),
      resolveWhatsAppTenant('777777777777772'),
    ]);

    expect(atlasTenant?.businessId).toBe(atlas.id);
    expect(barberTenant?.businessId).toBe(barber.id);
    expect(atlasTenant?.businessId).not.toBe(barberTenant?.businessId);
  });

  it('cannot be redirected by a customer or arbitrary business identifier', async () => {
    const findConnection = vi.fn(async (phoneNumberId: string) => {
      expect(phoneNumberId).toBe('888888888888888');
      return { id: randomUUID(), businessId: randomUUID() };
    });

    await resolveWhatsAppTenant('888888888888888', { findConnection });
    expect(findConnection).toHaveBeenCalledExactlyOnceWith('888888888888888');
  });

  it('binds an outbound connection to both trusted business and connection IDs', async () => {
    const [atlas, barber] = await Promise.all([
      createTestBusiness('Outbound Connection Atlas'),
      createTestBusiness('Outbound Connection Barber'),
    ]);
    const [atlasConnection, barberConnection] = await Promise.all([
      createWhatsAppConnection({
        businessId: atlas.id,
        phoneNumberId: '999999999999991',
        whatsappBusinessAccountId: '900000000000009',
      }),
      createWhatsAppConnection({
        businessId: barber.id,
        phoneNumberId: '999999999999992',
        whatsappBusinessAccountId: '900000000000010',
      }),
    ]);

    await expect(findActiveWhatsAppConnectionForTenant({
      businessId: atlas.id,
      whatsappConnectionId: atlasConnection.id,
    })).resolves.toMatchObject({
      id: atlasConnection.id,
      businessId: atlas.id,
      phoneNumberId: '999999999999991',
    });
    await expect(findActiveWhatsAppConnectionForTenant({
      businessId: atlas.id,
      whatsappConnectionId: barberConnection.id,
    })).resolves.toBeNull();
  });
});
