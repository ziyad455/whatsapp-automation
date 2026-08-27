import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { createTenantOpeningHoursService } from './tenant-opening-hours.service';

export interface TenantBusinessUnderstandingService {
  getPreview(): Promise<unknown>;
}

export const createTenantBusinessUnderstandingService = (
  tenant: TenantContext,
): TenantBusinessUnderstandingService => ({
  getPreview: async () => {
    const [business, openingHours, rules, entityTypes] = await Promise.all([
      prisma.business.findUnique({
        where: { id: tenant.businessId },
        select: {
          name: true,
          category: true,
          description: true,
          phone: true,
          address: true,
          timezone: true,
          currency: true,
          defaultLanguage: true,
          supportedLanguages: true,
        },
      }),
      createTenantOpeningHoursService(tenant).getWeek(),
      prisma.businessRule.findMany({
        where: { businessId: tenant.businessId, active: true },
        select: { category: true, name: true, content: true },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      prisma.businessEntityType.findMany({
        where: { businessId: tenant.businessId },
        select: {
          key: true,
          name: true,
          description: true,
          schemaVersion: true,
          fieldDefinitions: {
            where: { enabled: true },
            select: {
              key: true,
              label: true,
              type: true,
              required: true,
              options: true,
              displayOrder: true,
            },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
          entities: {
            where: { status: 'ACTIVE' },
            select: { name: true, data: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 3,
          },
          _count: {
            select: { entities: { where: { status: 'ACTIVE' } } },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      profile: business,
      openingHours,
      activeRules: rules,
      entityTypes: entityTypes.map(({ _count, entities, ...entityType }) => ({
        ...entityType,
        activeEntityCount: _count.entities,
        representativeEntities: entities,
      })),
    };
  },
});
