import { registerApiRoute } from '@mastra/core/server';
import {
  createTenantDashboardAnalyticsService,
  followUpQueueFilterSchema,
} from '../analytics/dashboard-analytics.service';
import { reportingRangeSchema } from '../analytics/reporting-range';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import { ApplicationError } from './errors';

const badRequest = (message: string) => new ApplicationError({
  code: 'BAD_REQUEST',
  status: 400,
  message,
});

const parseRange = (value?: string) => {
  const parsed = reportingRangeSchema.safeParse(value ?? 'TODAY');
  if (!parsed.success) throw badRequest('Reporting range is invalid.');
  return parsed.data;
};

export const dashboardAnalyticsRoutes = [
  registerApiRoute('/dashboard/analytics/overview', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const range = parseRange(context.req.query('range'));
      return context.json({
        overview: await createTenantDashboardAnalyticsService(tenant).overview(range),
      });
    },
  }),
  registerApiRoute('/dashboard/analytics/attention', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      return context.json({
        conversations: await createTenantDashboardAnalyticsService(tenant).attention(),
      });
    },
  }),
  registerApiRoute('/dashboard/analytics/follow-ups', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const filter = followUpQueueFilterSchema.safeParse(
        context.req.query('filter') ?? 'DUE',
      );
      if (!filter.success) throw badRequest('Follow-up queue filter is invalid.');
      return context.json({
        followUps: await createTenantDashboardAnalyticsService(tenant)
          .followUps(filter.data),
      });
    },
  }),
  registerApiRoute('/dashboard/analytics/campaigns', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      return context.json({
        campaigns: await createTenantDashboardAnalyticsService(tenant).campaigns(),
      });
    },
  }),
  registerApiRoute('/dashboard/analytics/conversations', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const range = parseRange(context.req.query('range'));
      return context.json({
        analytics: await createTenantDashboardAnalyticsService(tenant)
          .conversations(range),
      });
    },
  }),
];
