import { randomUUID } from 'node:crypto';
import type { BusinessDataProvider, CurrentFactMetadata } from '../../src/business-data/business-data-provider';
import type { TenantContext, TenantScope } from '../../src/tenancy/tenant-context';

export const fakeTenant = (): TenantContext => ({
  userId: randomUUID(), businessId: randomUUID(), membershipId: randomUUID(), role: 'OWNER',
});
export const fakeMetadata = (overrides: Partial<CurrentFactMetadata> = {}): CurrentFactMetadata => ({
  source: 'MANUAL', externalId: 'private-provider-id', freshnessClass: 'STABLE',
  freshnessStatus: 'FRESH', lastVerifiedAt: new Date('2026-09-01T12:00:00Z'),
  staleAfterSeconds: null, isStale: false, ...overrides,
});
export const fakeProvider = (tenant: TenantScope, name = 'Atlas Cars'): BusinessDataProvider => ({
  getBusinessProfile: async () => ({
    id: tenant.businessId, name, category: 'EXAMPLE', description: 'Local customer service.',
    phone: 'private-phone', address: 'private-address', timezone: 'Africa/Casablanca', currency: 'MAD',
    defaultLanguage: 'fr', supportedLanguages: ['darija', 'ar', 'fr', 'en'], metadata: fakeMetadata(),
  }),
  getOpeningHours: async () => [{
    id: randomUUID(), dayOfWeek: 'MONDAY', isOpen: true, opensAt: '09:00', closesAt: '18:00',
    metadata: fakeMetadata(),
  }],
  getBusinessRules: async () => [{ id: randomUUID(), category: 'DEPOSIT', name: 'Deposit', content: 'Deposit required: 3000 MAD', metadata: fakeMetadata() }],
  listEntityTypes: async () => [{
    id: randomUUID(), key: 'vehicle', name: 'Vehicles', description: null, schemaVersion: 1, fieldCount: 3,
    fields: [
      { key: 'price', label: 'Daily price', type: 'NUMBER' },
      { key: 'weeklyRate', label: 'Weekly rate', type: 'NUMBER' },
      { key: 'available', label: 'Available', type: 'BOOLEAN' },
    ],
  }],
  searchEntities: async () => ({ items: [], limit: 5, offset: 0 }),
  getEntity: async () => null,
});
