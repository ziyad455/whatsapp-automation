import { z } from 'zod';
import { prisma } from '../db/prisma';
import type { LeadStatus, Prisma } from '../generated/prisma/client';
import type { TenantContext } from '../tenancy/tenant-context';
import { ACTIVE_LEAD_STATUSES, LEAD_STATUS_ORDER } from './lead-status';
import {
  getBusinessReportingRange,
  type BusinessReportingRange,
  type ReportingRangeKey,
} from './reporting-range';

const MAX_OVERVIEW_ITEMS = 5;
const MAX_QUEUE_ITEMS = 50;
const MAX_CAMPAIGNS = 10;

export const followUpQueueFilterSchema = z.enum([
  'DUE',
  'PENDING',
  'FAILED',
  'RECENT',
]);
export type FollowUpQueueFilter = z.infer<typeof followUpQueueFilterSchema>;

const percentage = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 1_000) / 10;

const average = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : Math.round(values.reduce((total, value) => total + value, 0) / values.length);

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1]! + ordered[middle]!) / 2)
    : ordered[middle]!;
};

const reportingRangeDto = (range: BusinessReportingRange) => ({
  key: range.key,
  timeZone: range.timeZone,
  localStartDate: range.localStartDate,
  start: range.start.toISOString(),
  end: range.end.toISOString(),
});

const getTenantRange = async (
  tenant: TenantContext,
  key: ReportingRangeKey,
  now: Date,
): Promise<BusinessReportingRange> => {
  const business = await prisma.business.findUnique({
    where: { id: tenant.businessId },
    select: { timezone: true },
  });
  if (!business) throw new Error('Authorized business was not found.');
  return getBusinessReportingRange(business.timezone, key, now);
};

const attentionQueue = async (tenant: TenantContext, take: number) => {
  const conversations = await prisma.conversation.findMany({
    where: {
      businessId: tenant.businessId,
      channel: 'WHATSAPP',
      status: 'OPEN',
      mode: 'HUMAN',
      customerId: { not: null },
    },
    orderBy: [
      { attentionSince: { sort: 'asc', nulls: 'last' } },
      { lastActivityAt: 'asc' },
      { id: 'asc' },
    ],
    take,
    include: {
      customer: { select: { id: true, whatsappPhone: true } },
      assignedBusinessUser: {
        select: {
          id: true,
          user: { select: { name: true, email: true } },
        },
      },
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { content: true, senderType: true, createdAt: true },
      },
    },
  });

  return conversations.map(conversation => ({
    id: conversation.id,
    customer: {
      id: conversation.customer!.id,
      whatsappPhone: conversation.customer!.whatsappPhone,
    },
    latestMessage: conversation.messages[0]
      ? {
          content: conversation.messages[0].content,
          senderType: conversation.messages[0].senderType,
          createdAt: conversation.messages[0].createdAt.toISOString(),
        }
      : null,
    handoffReason: conversation.handoffReason,
    waitingSince: (conversation.attentionSince ?? conversation.lastActivityAt).toISOString(),
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    assignment: conversation.assignedBusinessUser
      ? {
          membershipId: conversation.assignedBusinessUser.id,
          name: conversation.assignedBusinessUser.user.name,
          email: conversation.assignedBusinessUser.user.email,
        }
      : null,
  }));
};

const leadStatusCounts = async (tenant: TenantContext): Promise<Record<LeadStatus, number>> => {
  const groups = await prisma.lead.groupBy({
    by: ['status'],
    where: { businessId: tenant.businessId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(
    LEAD_STATUS_ORDER.map(status => [status, 0]),
  ) as Record<LeadStatus, number>;
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
};

const followUpCounts = async (tenant: TenantContext, now: Date) => {
  const [pending, due, failed] = await Promise.all([
    prisma.followUp.count({
      where: {
        businessId: tenant.businessId,
        status: 'PENDING',
        scheduledAt: { gt: now },
      },
    }),
    prisma.followUp.count({
      where: {
        businessId: tenant.businessId,
        status: 'PENDING',
        scheduledAt: { lte: now },
      },
    }),
    prisma.followUp.count({
      where: { businessId: tenant.businessId, status: 'FAILED' },
    }),
  ]);
  return { pending, due, failed };
};

const followUpWhere = (
  filter: FollowUpQueueFilter,
  now: Date,
): Prisma.FollowUpWhereInput => {
  if (filter === 'DUE') return { status: 'PENDING' as const, scheduledAt: { lte: now } };
  if (filter === 'PENDING') return { status: 'PENDING' as const, scheduledAt: { gt: now } };
  if (filter === 'FAILED') return { status: 'FAILED' as const };
  return { status: { in: ['SENT', 'CANCELLED'] } };
};

const followUpQueue = async (
  tenant: TenantContext,
  filter: FollowUpQueueFilter,
  now: Date,
  take = MAX_QUEUE_ITEMS,
) => {
  const items = await prisma.followUp.findMany({
    where: {
      businessId: tenant.businessId,
      ...followUpWhere(filter, now),
    },
    orderBy: filter === 'RECENT'
      ? [{ updatedAt: 'desc' }, { id: 'desc' }]
      : [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take,
    include: {
      customer: { select: { id: true, whatsappPhone: true } },
      lead: { select: { id: true, status: true, summary: true } },
      conversation: { select: { id: true, mode: true } },
    },
  });
  return items.map(item => ({
    id: item.id,
    type: item.type,
    status: item.status === 'PENDING' && item.scheduledAt <= now ? 'DUE' as const : item.status,
    scheduledAt: item.scheduledAt.toISOString(),
    attemptCount: item.attemptCount,
    reasonCode: item.reasonCode,
    lastAttemptAt: item.lastAttemptAt?.toISOString() ?? null,
    customer: item.customer,
    lead: item.lead,
    conversation: item.conversation,
  }));
};

const overview = async (
  tenant: TenantContext,
  key: ReportingRangeKey,
  now: Date,
) => {
  const range = await getTenantRange(tenant, key, now);
  const period = { gte: range.start, lte: range.end };
  const [
    activeConversations,
    newLeads,
    attentionCount,
    attention,
    followUps,
    convertedCustomers,
    statuses,
    recentLeads,
    recentOutcomes,
  ] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: {
        businessId: tenant.businessId,
        createdAt: period,
        senderType: { not: 'SYSTEM' },
        conversation: { channel: 'WHATSAPP' },
      },
      distinct: ['conversationId'],
      select: { conversationId: true },
    }),
    prisma.lead.count({
      where: { businessId: tenant.businessId, createdAt: period },
    }),
    prisma.conversation.count({
      where: {
        businessId: tenant.businessId,
        channel: 'WHATSAPP',
        status: 'OPEN',
        mode: 'HUMAN',
      },
    }),
    attentionQueue(tenant, MAX_OVERVIEW_ITEMS),
    followUpCounts(tenant, now),
    prisma.campaignRecipient.findMany({
      where: {
        businessId: tenant.businessId,
        convertedAt: period,
      },
      distinct: ['customerId'],
      select: { customerId: true },
    }),
    leadStatusCounts(tenant),
    prisma.lead.findMany({
      where: { businessId: tenant.businessId, createdAt: period },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_OVERVIEW_ITEMS,
      include: {
        customer: { select: { whatsappPhone: true } },
        conversation: { select: { id: true } },
      },
    }),
    prisma.customerLifecycleEvent.findMany({
      where: { businessId: tenant.businessId, occurredAt: period },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: MAX_OVERVIEW_ITEMS,
      include: { customer: { select: { whatsappPhone: true } } },
    }),
  ]);

  return {
    range: reportingRangeDto(range),
    summary: {
      conversations: activeConversations.length,
      newLeads,
      needsAttention: attentionCount,
      followUpsDue: followUps.due,
      campaignConversions: convertedCustomers.length,
    },
    leads: {
      statuses,
      active: ACTIVE_LEAD_STATUSES.reduce(
        (count, status) => count + statuses[status],
        0,
      ),
      recent: recentLeads.map(lead => ({
        id: lead.id,
        status: lead.status,
        intent: lead.intent,
        summary: lead.summary,
        createdAt: lead.createdAt.toISOString(),
        lastActivityAt: lead.lastActivityAt.toISOString(),
        customer: lead.customer,
        conversationId: lead.conversation.id,
      })),
    },
    attention,
    followUps,
    outcomes: recentOutcomes.map(outcome => ({
      id: outcome.id,
      type: outcome.type,
      occurredAt: outcome.occurredAt.toISOString(),
      customer: outcome.customer,
    })),
  };
};

const campaignPerformance = async (tenant: TenantContext) => {
  const campaigns = await prisma.campaign.findMany({
    where: { businessId: tenant.businessId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_CAMPAIGNS,
    include: {
      recipients: {
        select: {
          status: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          repliedAt: true,
          convertedAt: true,
        },
      },
    },
  });

  return campaigns.map(campaign => {
    const metrics = {
      recipients: campaign.recipients.length,
      sent: campaign.recipients.filter(item => item.sentAt !== null).length,
      delivered: campaign.recipients.filter(item => item.deliveredAt !== null).length,
      read: campaign.recipients.filter(item => item.readAt !== null).length,
      replied: campaign.recipients.filter(item => item.repliedAt !== null).length,
      failed: campaign.recipients.filter(item => item.status === 'FAILED').length,
      converted: campaign.recipients.filter(item => item.convertedAt !== null).length,
    };
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdAt: campaign.createdAt.toISOString(),
      launchedAt: campaign.launchedAt?.toISOString() ?? null,
      metrics,
      rates: {
        delivery: percentage(metrics.delivered, metrics.sent),
        reply: percentage(metrics.replied, metrics.sent),
        conversion: percentage(metrics.converted, metrics.sent),
      },
    };
  });
};

const conversationAnalytics = async (
  tenant: TenantContext,
  key: ReportingRangeKey,
  now: Date,
) => {
  const range = await getTenantRange(tenant, key, now);
  const messages = await prisma.conversationMessage.findMany({
    where: {
      businessId: tenant.businessId,
      createdAt: { gte: range.start, lte: range.end },
      conversation: { channel: 'WHATSAPP' },
      OR: [
        { direction: 'INBOUND', senderType: 'CUSTOMER' },
        {
          direction: 'OUTBOUND',
          senderType: { in: ['AI', 'HUMAN'] },
          followUp: null,
          campaignRecipient: null,
        },
      ],
    },
    orderBy: [
      { conversationId: 'asc' },
      { sequence: 'asc' },
    ],
    select: {
      conversationId: true,
      sequence: true,
      direction: true,
      senderType: true,
      createdAt: true,
    },
  });

  const inboundConversations = new Set<string>();
  const aiConversations = new Set<string>();
  const humanConversations = new Set<string>();
  const responseTimes: number[] = [];
  const humanResponseTimes: number[] = [];
  const pendingInbound = new Map<string, Date>();

  for (const message of messages) {
    if (message.direction === 'INBOUND' && message.senderType === 'CUSTOMER') {
      inboundConversations.add(message.conversationId);
      pendingInbound.set(message.conversationId, message.createdAt);
      continue;
    }
    if (message.direction !== 'OUTBOUND') continue;
    if (message.senderType === 'AI') aiConversations.add(message.conversationId);
    if (message.senderType === 'HUMAN') humanConversations.add(message.conversationId);
    const startedAt = pendingInbound.get(message.conversationId);
    if (!startedAt) continue;
    const seconds = Math.max(0, Math.round(
      (message.createdAt.getTime() - startedAt.getTime()) / 1_000,
    ));
    responseTimes.push(seconds);
    if (message.senderType === 'HUMAN') humanResponseTimes.push(seconds);
    pendingInbound.delete(message.conversationId);
  }

  const handoffEvents = await prisma.auditEvent.findMany({
    where: {
      businessId: tenant.businessId,
      targetType: 'CONVERSATION',
      action: 'MODE_CHANGE',
      createdAt: { gte: range.start, lte: range.end },
      after: { path: ['mode'], equals: 'HUMAN' },
      targetId: { in: [...inboundConversations] },
    },
    distinct: ['targetId'],
    select: { targetId: true },
  });
  const handoffIds = new Set(handoffEvents.map(event => event.targetId));
  const fullyAiHandled = [...inboundConversations].filter(conversationId =>
    aiConversations.has(conversationId)
    && !humanConversations.has(conversationId)
    && !handoffIds.has(conversationId),
  ).length;

  return {
    range: reportingRangeDto(range),
    conversationsWithCustomerMessages: inboundConversations.size,
    conversationsWithAiResponses: aiConversations.size,
    conversationsWithHumanResponses: humanConversations.size,
    conversationsRequiringHandoff: handoffIds.size,
    fullyAiHandled,
    handoffRate: percentage(handoffIds.size, inboundConversations.size),
    firstResponseTimeSeconds: {
      median: median(responseTimes),
      average: average(responseTimes),
      sampleSize: responseTimes.length,
    },
    humanResponseTimeSeconds: {
      median: median(humanResponseTimes),
      average: average(humanResponseTimes),
      sampleSize: humanResponseTimes.length,
    },
  };
};

export const createTenantDashboardAnalyticsService = (tenant: TenantContext) => ({
  overview: (key: ReportingRangeKey = 'TODAY', now = new Date()) =>
    overview(tenant, key, now),
  attention: () => attentionQueue(tenant, MAX_QUEUE_ITEMS),
  followUps: (filter: FollowUpQueueFilter, now = new Date()) =>
    followUpQueue(tenant, filter, now),
  campaigns: () => campaignPerformance(tenant),
  conversations: (key: ReportingRangeKey = 'TODAY', now = new Date()) =>
    conversationAnalytics(tenant, key, now),
});

export type TenantDashboardAnalyticsService = ReturnType<
  typeof createTenantDashboardAnalyticsService
>;
