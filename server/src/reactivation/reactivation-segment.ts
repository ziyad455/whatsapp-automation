import { z } from 'zod';
import { prisma } from '../db/prisma';
import type { CustomerLifecycleEventType } from '../generated/prisma/client';
import type { TenantScope } from '../tenancy/tenant-context';

const lifecycleTypeSchema = z.enum([
  'BOOKING_COMPLETED',
  'PURCHASE_COMPLETED',
  'MEMBERSHIP_STARTED',
  'MEMBERSHIP_EXPIRED',
  'SERVICE_COMPLETED',
]);

export const reactivationSegmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PRIOR_LIFECYCLE'),
    eventTypes: z.array(lifecycleTypeSchema).min(1).max(5),
  }).strict(),
  z.object({
    kind: z.literal('INACTIVE'),
    minimumInactiveDays: z.number().int().min(1).max(3_650),
    eventTypes: z.array(lifecycleTypeSchema).min(1).max(5).optional(),
  }).strict(),
  z.object({
    kind: z.literal('MEMBERSHIP_EXPIRING'),
    withinDays: z.number().int().min(1).max(365),
  }).strict(),
  z.object({ kind: z.literal('MEMBERSHIP_EXPIRED') }).strict(),
  z.object({
    kind: z.literal('SERVICE_DUE'),
    minimumDays: z.number().int().min(1).max(3_650),
    maximumDays: z.number().int().min(1).max(3_650).optional(),
  }).strict().refine(
    value => value.maximumDays === undefined || value.maximumDays >= value.minimumDays,
    { message: 'maximumDays must be greater than or equal to minimumDays' },
  ),
]);

export type ReactivationSegment = z.infer<typeof reactivationSegmentSchema>;

export interface SegmentMatch {
  readonly customerId: string;
  readonly whatsappPhone: string;
  readonly matchedReasons: readonly string[];
  readonly lastCustomerActivityAt: Date | null;
}

const dateFromMetadata = (metadata: unknown, key: string): Date | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const latestDate = (dates: readonly (Date | null | undefined)[]): Date | null => {
  const valid = dates.filter((date): date is Date => date instanceof Date);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map(date => date.getTime())));
};

const includesEventType = (
  events: readonly { type: CustomerLifecycleEventType }[],
  eventTypes: readonly CustomerLifecycleEventType[],
): boolean => events.some(event => eventTypes.includes(event.type));

export const previewReactivationSegment = async (
  tenant: TenantScope,
  input: ReactivationSegment,
  now = new Date(),
): Promise<SegmentMatch[]> => {
  const segment = reactivationSegmentSchema.parse(input);
  const customers = await prisma.customer.findMany({
    where: { businessId: tenant.businessId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1_000,
    select: {
      id: true,
      whatsappPhone: true,
      createdAt: true,
      lifecycleEvents: {
        where: { businessId: tenant.businessId, occurredAt: { lte: now } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { type: true, occurredAt: true, metadata: true },
      },
      conversations: {
        where: { businessId: tenant.businessId },
        select: {
          messages: {
            where: { businessId: tenant.businessId, senderType: 'CUSTOMER' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });

  return customers.flatMap(customer => {
    const lastCustomerActivityAt = latestDate([
      customer.createdAt,
      ...customer.conversations.map(conversation => conversation.messages[0]?.createdAt),
    ]);
    const reasons: string[] = [];

    switch (segment.kind) {
      case 'PRIOR_LIFECYCLE':
        if (includesEventType(customer.lifecycleEvents, segment.eventTypes)) {
          reasons.push(`Previous ${segment.eventTypes.join(' or ').toLowerCase().replaceAll('_', ' ')}`);
        }
        break;
      case 'INACTIVE': {
        const inactiveCutoff = new Date(now.getTime() - segment.minimumInactiveDays * 86_400_000);
        const hasRequiredOutcome = segment.eventTypes === undefined ||
          includesEventType(customer.lifecycleEvents, segment.eventTypes);
        if (lastCustomerActivityAt && lastCustomerActivityAt <= inactiveCutoff && hasRequiredOutcome) {
          reasons.push(`No customer message for at least ${segment.minimumInactiveDays} days`);
        }
        break;
      }
      case 'MEMBERSHIP_EXPIRING': {
        const limit = new Date(now.getTime() + segment.withinDays * 86_400_000);
        const membership = customer.lifecycleEvents.find(event => {
          if (event.type !== 'MEMBERSHIP_STARTED') return false;
          const expiresAt = dateFromMetadata(event.metadata, 'expiresAt');
          return expiresAt !== null && expiresAt >= now && expiresAt <= limit;
        });
        if (membership) reasons.push(`Membership expires within ${segment.withinDays} days`);
        break;
      }
      case 'MEMBERSHIP_EXPIRED':
        if (customer.lifecycleEvents.some(event => event.type === 'MEMBERSHIP_EXPIRED')) {
          reasons.push('Membership expired');
        }
        break;
      case 'SERVICE_DUE': {
        const service = customer.lifecycleEvents.find(event => event.type === 'SERVICE_COMPLETED');
        if (service) {
          const ageDays = Math.floor((now.getTime() - service.occurredAt.getTime()) / 86_400_000);
          if (ageDays >= segment.minimumDays &&
            (segment.maximumDays === undefined || ageDays <= segment.maximumDays)) {
            reasons.push(`Service completed ${ageDays} days ago`);
          }
        }
        break;
      }
    }

    return reasons.length === 0 ? [] : [{
      customerId: customer.id,
      whatsappPhone: customer.whatsappPhone,
      matchedReasons: reasons,
      lastCustomerActivityAt,
    }];
  });
};
