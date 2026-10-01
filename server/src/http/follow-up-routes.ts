import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { createTenantFollowUpService } from '../follow-ups/follow-up.service';
import { followUpSettingsSchema } from '../follow-ups/follow-up-policy';
import { BUSINESS_SELECTOR_HEADER, resolveDashboardTenantContext } from '../tenancy/dashboard-tenant-context';
import { ApplicationError } from './errors';
import { requireBusinessPermission } from '../tenancy/business-permissions';

const identifierSchema = z.uuid();
const consentSchema = z.object({
  consent: z.boolean(),
  // Staff must affirm an independently obtained, explicit customer permission.
  staffAttestation: z.literal(true),
}).strict();

const badRequest = () => new ApplicationError({
  code: 'BAD_REQUEST', status: 400, message: 'Follow-up request validation failed.',
});

export const followUpRoutes = [
  registerApiRoute('/dashboard/follow-up-settings', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      return context.json({ settings: await createTenantFollowUpService(tenant).settings() });
    },
  }),
  registerApiRoute('/dashboard/follow-up-settings', {
    method: 'PUT', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      requireBusinessPermission(tenant, 'FOLLOW_UP_CONFIGURATION_WRITE');
      const parsed = followUpSettingsSchema.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success) throw badRequest();
      return context.json({ settings: await createTenantFollowUpService(tenant).updateSettings(parsed.data) });
    },
  }),
  registerApiRoute('/dashboard/leads/:leadId/follow-ups', {
    method: 'GET', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const id = identifierSchema.safeParse(context.req.param('leadId'));
      if (!id.success) throw badRequest();
      const service = createTenantFollowUpService(tenant);
      return context.json({ followUps: await service.listForLead(id.data) });
    },
  }),
  registerApiRoute('/dashboard/leads/:leadId/follow-up-consent', {
    method: 'POST', requiresAuth: true,
    handler: async context => {
      const tenant = await resolveDashboardTenantContext(
        context.get('requestContext'), context.req.header(BUSINESS_SELECTOR_HEADER));
      const id = identifierSchema.safeParse(context.req.param('leadId'));
      const input = consentSchema.safeParse(await context.req.json().catch(() => null));
      if (!id.success || !input.success) throw badRequest();
      const customer = await createTenantFollowUpService(tenant)
        .recordConsent(id.data, input.data.consent);
      if (!customer) throw new ApplicationError({
        code: 'NOT_FOUND', status: 404, message: 'Lead was not found.',
      });
      return context.json({ customer });
    },
  }),
];
