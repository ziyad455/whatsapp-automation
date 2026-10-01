import { registerApiRoute } from '@mastra/core/server';
import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import {
  CampaignOperationError,
  campaignInputSchema,
  createTenantCampaignService,
} from '../reactivation/campaign.service';
import {
  CustomerLifecycleError,
  createCustomerLifecycleEvent,
  lifecycleEventInputSchema,
  listCustomerLifecycleHistory,
  listTenantCustomers,
  recordMarketingPreference,
} from '../reactivation/customer-lifecycle.service';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import { ApplicationError } from './errors';
import { enforceRateLimit } from './rate-limit';
import { requireBusinessPermission } from '../tenancy/business-permissions';

const identifierSchema = z.uuid();
const marketingPreferenceSchema = z.object({
  consent: z.boolean(),
  staffAttestation: z.literal(true),
  evidence: z.string().trim().min(1).max(500).optional(),
}).strict();

const badRequest = (message = 'Reactivation request validation failed.') =>
  new ApplicationError({ code: 'BAD_REQUEST', status: 400, message });

const asApplicationError = (error: unknown): never => {
  if (error instanceof CustomerLifecycleError) {
    throw new ApplicationError({
      code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
      status: error.code === 'NOT_FOUND' ? 404 : 409,
      message: error.message,
    });
  }
  if (error instanceof CampaignOperationError) {
    throw new ApplicationError({
      code: error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'INVALID_TEMPLATE'
          ? 'BAD_REQUEST'
          : 'CONFLICT',
      status: error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_TEMPLATE' ? 400 : 409,
      message: error.message,
    });
  }
  throw error;
};

const resolveTenant = (requestContext: RequestContext, businessId?: string) =>
  resolveDashboardTenantContext(requestContext, businessId);

export const reactivationRoutes = [
  registerApiRoute('/dashboard/customers', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      return context.json({ customers: await listTenantCustomers(tenant) });
    },
  }),
  registerApiRoute('/dashboard/customers/:customerId/history', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const customerId = identifierSchema.safeParse(context.req.param('customerId'));
      if (!customerId.success) throw badRequest();
      try {
        return context.json({
          customer: await listCustomerLifecycleHistory(tenant, customerId.data),
        });
      } catch (error) {
        return asApplicationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/customers/:customerId/lifecycle-events', {
    method: 'POST', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const customerId = identifierSchema.safeParse(context.req.param('customerId'));
      const input = lifecycleEventInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!customerId.success || !input.success) throw badRequest();
      try {
        return context.json({
          event: await createCustomerLifecycleEvent(tenant, customerId.data, input.data),
        }, 201);
      } catch (error) {
        return asApplicationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/customers/:customerId/marketing-preference', {
    method: 'POST', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const customerId = identifierSchema.safeParse(context.req.param('customerId'));
      const input = marketingPreferenceSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!customerId.success || !input.success) throw badRequest();
      try {
        return context.json({
          customer: await recordMarketingPreference(tenant, customerId.data, {
            consent: input.data.consent,
            source: 'STAFF',
            ...(input.data.evidence ? { evidence: input.data.evidence } : {}),
          }),
        });
      } catch (error) {
        return asApplicationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/campaigns', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      return context.json({ campaigns: await createTenantCampaignService(tenant).list() });
    },
  }),
  registerApiRoute('/dashboard/campaigns', {
    method: 'POST', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      requireBusinessPermission(tenant, 'CAMPAIGN_CREATE');
      const input = campaignInputSchema.safeParse(await context.req.json().catch(() => null));
      if (!input.success) throw badRequest();
      try {
        return context.json({
          campaign: await createTenantCampaignService(tenant).create(input.data),
        }, 201);
      } catch (error) {
        return asApplicationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/campaigns/:campaignId', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const campaignId = identifierSchema.safeParse(context.req.param('campaignId'));
      if (!campaignId.success) throw badRequest();
      try {
        return context.json({
          campaign: await createTenantCampaignService(tenant).get(campaignId.data),
        });
      } catch (error) {
        return asApplicationError(error);
      }
    },
  }),
  ...(['preview', 'prepare', 'launch', 'cancel'] as const).map(action =>
    registerApiRoute(`/dashboard/campaigns/:campaignId/${action}`, {
      method: 'POST', requiresAuth: true,
      handler: async context => {
        const tenant = await resolveTenant(context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
        const campaignId = identifierSchema.safeParse(context.req.param('campaignId'));
        if (!campaignId.success) throw badRequest();
        if (action !== 'preview') requireBusinessPermission(tenant, ({
          prepare: 'CAMPAIGN_PREPARE', launch: 'CAMPAIGN_LAUNCH', cancel: 'CAMPAIGN_CANCEL',
        } as const)[action]);
        if (action === 'launch') enforceRateLimit(`campaign-launch:${tenant.userId}`, 5);
        const service = createTenantCampaignService(tenant);
        try {
          const result = action === 'preview' ? await service.preview(campaignId.data)
            : action === 'prepare' ? await service.prepare(campaignId.data)
              : action === 'launch' ? await service.launch(campaignId.data)
                : await service.cancel(campaignId.data);
          return context.json({ [action]: result });
        } catch (error) {
          return asApplicationError(error);
        }
      },
    }),
  ),
];
