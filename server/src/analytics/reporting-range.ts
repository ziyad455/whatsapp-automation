import { z } from 'zod';

export const reportingRangeSchema = z.enum([
  'TODAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
]);

export type ReportingRangeKey = z.infer<typeof reportingRangeSchema>;

export interface BusinessReportingRange {
  readonly key: ReportingRangeKey;
  readonly timeZone: string;
  readonly localStartDate: string;
  readonly start: Date;
  readonly end: Date;
}

interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterFor = (timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const localParts = (instant: Date, timeZone: string): LocalDateTimeParts => {
  const values = Object.fromEntries(
    formatterFor(timeZone).formatToParts(instant)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
};

const localDateString = (parts: Pick<LocalDateTimeParts, 'year' | 'month' | 'day'>) =>
  `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

const addCalendarDays = (
  parts: Pick<LocalDateTimeParts, 'year' | 'month' | 'day'>,
  days: number,
) => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

const localMidnightToUtc = (
  date: Pick<LocalDateTimeParts, 'year' | 'month' | 'day'>,
  timeZone: string,
): Date => {
  const desired = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = desired;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = localParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = desired - observedAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(candidate);
};

const daysForRange: Record<ReportingRangeKey, number> = {
  TODAY: 1,
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
};

export const getBusinessReportingRange = (
  timeZone: string,
  key: ReportingRangeKey,
  now = new Date(),
): BusinessReportingRange => {
  const trustedKey = reportingRangeSchema.parse(key);
  const localNow = localParts(now, timeZone);
  const localStart = addCalendarDays(localNow, -(daysForRange[trustedKey] - 1));

  return {
    key: trustedKey,
    timeZone,
    localStartDate: localDateString(localStart),
    start: localMidnightToUtc(localStart, timeZone),
    end: now,
  };
};
