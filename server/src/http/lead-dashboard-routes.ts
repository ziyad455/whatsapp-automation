import type { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { enforceRateLimit } from './rate-limit';
import { z } from 'zod';
import {
  createTenantLeadDashboardService,
  LeadOperationError,
} from '../leads/tenant-lead.service';
import {
  BUSINESS_SELECTOR_HEADER,
  resolveDashboardTenantContext,
} from '../tenancy/dashboard-tenant-context';
import type { TenantContext } from '../tenancy/tenant-context';
import { ApplicationError } from './errors';

const leadIdSchema = z.uuid();
const leadStatusSchema = z.enum(['NEW', 'INTERESTED', 'QUALIFIED', 'WON', 'LOST']);
const statusRequestSchema = z.object({ status: leadStatusSchema }).strict();

const badRequest = (message: string, details?: unknown) => new ApplicationError({
  code: 'BAD_REQUEST',
  message,
  status: 400,
  details,
});

const resolveTenant = (
  requestContext: RequestContext,
  selectedBusinessId?: string,
): Promise<TenantContext> => resolveDashboardTenantContext(requestContext, selectedBusinessId);

const parseLeadId = (value: string): string => {
  const parsed = leadIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Lead ID must be valid.');
  return parsed.data;
};

const parseBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must contain valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw badRequest('Request validation failed.', {
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || null,
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  return parsed.data;
};

const mapLeadOperationError = (error: unknown): never => {
  if (error instanceof LeadOperationError) {
    throw new ApplicationError({
      code: error.code,
      message: error.message,
      status: error.code === 'NOT_FOUND' ? 404 : 409,
    });
  }
  throw error;
};

const mapLeadSummaryError = (error: unknown): never => {
  if (error instanceof LeadOperationError) return mapLeadOperationError(error);
  throw new ApplicationError({
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'The Lead summary could not be refreshed. The existing Lead was not changed.',
    status: 503,
    cause: error,
  });
};

export const leadDashboardRoutes = [
  registerApiRoute('/dashboard/leads', {
    method: 'GET',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const rawStatus = context.req.query('status');
      const parsedStatus = rawStatus === undefined
        ? undefined
        : leadStatusSchema.safeParse(rawStatus);
      if (parsedStatus && !parsedStatus.success) {
        throw badRequest('Lead status filter is invalid.');
      }
      const leads = await createTenantLeadDashboardService(tenant)
        .list(parsedStatus?.data);
      return context.json({ leads });
    },
  }),
  registerApiRoute('/dashboard/leads/:leadId/status', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const leadId = parseLeadId(context.req.param('leadId'));
      const input = await parseBody(context.req.raw, statusRequestSchema);
      try {
        const lead = await createTenantLeadDashboardService(tenant)
          .setStatus(leadId, input.status);
        return context.json({ lead });
      } catch (error) {
        return mapLeadOperationError(error);
      }
    },
  }),
  registerApiRoute('/dashboard/leads/:leadId/summary', {
    method: 'POST',
    requiresAuth: true,
    handler: async context => {
      const tenant = await resolveTenant(
        context.get('requestContext'),
        context.req.header(BUSINESS_SELECTOR_HEADER),
      );
      const leadId = parseLeadId(context.req.param('leadId'));
      try {
        enforceRateLimit(`ai:${tenant.userId}`, 12);
        const lead = await createTenantLeadDashboardService(tenant)
          .refreshSummary(leadId);
        return context.json({ lead });
      } catch (error) {
        return mapLeadSummaryError(error);
      }
    },
  }),
];
