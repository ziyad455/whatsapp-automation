import type {
  BusinessOpeningHour,
  BusinessWeekday,
} from '../generated/prisma/client';
import { appendTenantAuditEvent } from '../audit/tenant-audit.service';
import { prisma } from '../db/prisma';
import type { TenantContext } from '../tenancy/tenant-context';
import { requireBusinessPermission } from '../tenancy/business-permissions';

export const BUSINESS_WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const satisfies readonly BusinessWeekday[];

export interface OpeningHourInput {
  dayOfWeek: BusinessWeekday;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  businessId?: never;
}

export type WeeklyOpeningHour = Pick<
  BusinessOpeningHour,
  'dayOfWeek' | 'isOpen' | 'opensAt' | 'closesAt'
>;

export class OpeningHoursValidationError extends Error {
  readonly dayOfWeek: BusinessWeekday | null;

  constructor(message: string, dayOfWeek: BusinessWeekday | null = null) {
    super(message);
    this.name = 'OpeningHoursValidationError';
    this.dayOfWeek = dayOfWeek;
  }
}

export interface TenantOpeningHoursService {
  getWeek(): Promise<WeeklyOpeningHour[]>;
  getStoredWeek(): Promise<BusinessOpeningHour[]>;
  replaceWeek(hours: readonly OpeningHourInput[]): Promise<WeeklyOpeningHour[]>;
}

const emptyDay = (dayOfWeek: BusinessWeekday): WeeklyOpeningHour => ({
  dayOfWeek,
  isOpen: false,
  opensAt: null,
  closesAt: null,
});

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const validateWeek = (hours: readonly OpeningHourInput[]): void => {
  if (hours.length !== BUSINESS_WEEKDAYS.length) {
    throw new OpeningHoursValidationError('Opening hours must include all seven days.');
  }

  const providedDays = new Set(hours.map(hour => hour.dayOfWeek));

  if (
    providedDays.size !== BUSINESS_WEEKDAYS.length ||
    BUSINESS_WEEKDAYS.some(day => !providedDays.has(day))
  ) {
    throw new OpeningHoursValidationError(
      'Opening hours must include each weekday exactly once.',
    );
  }

  for (const hour of hours) {
    if (!hour.isOpen) {
      if (hour.opensAt !== null || hour.closesAt !== null) {
        throw new OpeningHoursValidationError(
          'Closed days cannot define opening or closing times.',
          hour.dayOfWeek,
        );
      }
      continue;
    }

    if (
      !hour.opensAt ||
      !hour.closesAt ||
      !timePattern.test(hour.opensAt) ||
      !timePattern.test(hour.closesAt) ||
      hour.opensAt >= hour.closesAt
    ) {
      throw new OpeningHoursValidationError(
        'Closing time must be later than opening time on the same day.',
        hour.dayOfWeek,
      );
    }
  }
};

export const createTenantOpeningHoursService = (
  tenant: TenantContext,
): TenantOpeningHoursService => {
  const getStoredWeek = (): Promise<BusinessOpeningHour[]> =>
    prisma.businessOpeningHour.findMany({
      where: { businessId: tenant.businessId },
      orderBy: { dayOfWeek: 'asc' },
    });

  const getWeek = async (): Promise<WeeklyOpeningHour[]> => {
    const stored = await getStoredWeek();
    const byDay = new Map(stored.map(hour => [hour.dayOfWeek, hour]));

    return BUSINESS_WEEKDAYS.map(day => byDay.get(day) ?? emptyDay(day));
  };

  return {
    getWeek,
    getStoredWeek,
    replaceWeek: async hours => {
      requireBusinessPermission(tenant, 'BUSINESS_CONFIGURATION_WRITE');
      validateWeek(hours);

      return prisma.$transaction(async transaction => {
        const before = await transaction.businessOpeningHour.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { dayOfWeek: 'asc' },
        });
        const verifiedAt = new Date();

        for (const hour of hours) {
          await transaction.businessOpeningHour.upsert({
            where: {
              businessId_dayOfWeek: {
                businessId: tenant.businessId,
                dayOfWeek: hour.dayOfWeek,
              },
            },
            create: {
              businessId: tenant.businessId,
              dayOfWeek: hour.dayOfWeek,
              isOpen: hour.isOpen,
              opensAt: hour.isOpen ? hour.opensAt : null,
              closesAt: hour.isOpen ? hour.closesAt : null,
              source: 'MANUAL',
              externalId: null,
              lastVerifiedAt: verifiedAt,
            },
            update: {
              isOpen: hour.isOpen,
              opensAt: hour.isOpen ? hour.opensAt : null,
              closesAt: hour.isOpen ? hour.closesAt : null,
              source: 'MANUAL',
              externalId: null,
              lastVerifiedAt: verifiedAt,
            },
          });
        }

        const after = await transaction.businessOpeningHour.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { dayOfWeek: 'asc' },
        });

        await appendTenantAuditEvent(transaction, tenant, {
          targetType: 'OPENING_HOURS',
          targetId: tenant.businessId,
          action: 'UPDATE',
          before,
          after,
        });

        const byDay = new Map(after.map(hour => [hour.dayOfWeek, hour]));
        return BUSINESS_WEEKDAYS.map(day => byDay.get(day) ?? emptyDay(day));
      });
    },
  };
};
