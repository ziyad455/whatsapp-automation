import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { env } from '../config/env';
import { PrivateTraceProcessor } from '../observability/private-traces';
import { safeRequestPath } from '../observability/redaction';
import { mastraAuth } from '../auth/mastra-auth';
import { toErrorResponse } from '../http/errors';
import { applicationLogger } from '../http/logger';
import { readinessMiddleware, requestContextMiddleware } from '../http/middleware';
import { getOrCreateRequestId } from '../http/request-context';
import { securityMiddleware } from '../http/security-middleware';
import { applicationRoutes } from '../http/routes';
import { customerServiceAgent } from './agents/customer-service-agent';
import { leadSummaryWorker } from './agents/lead-summary-worker';
import { customerServiceBusinessTools } from './tools/business-information-tools';
import { followUpWorkflow } from './workflows/follow-up-workflow';
import { campaignWorkflow } from './workflows/campaign-workflow';

const observabilityStorage = env.MASTRA_OBSERVABILITY_DATABASE_PATH
  ? new DuckDBStore({ path: env.MASTRA_OBSERVABILITY_DATABASE_PATH })
  : new DuckDBStore();

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { customerServiceAgent, leadSummaryWorker },
  workflows: { followUpWorkflow, campaignWorkflow },
  tools: { ...customerServiceBusinessTools },
  logger: applicationLogger,
  server: {
    port: env.PORT,
    auth: mastraAuth,
    cors: {
      origin: env.DASHBOARD_URL,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'x-request-id',
        'x-business-id',
      ],
      exposeHeaders: ['x-request-id'],
      credentials: true,
    },
    apiRoutes: applicationRoutes,
    middleware: [requestContextMiddleware, securityMiddleware, readinessMiddleware],
    onError: (error, context) => {
      const requestId = getOrCreateRequestId(context.get('requestContext'));
      const path = safeRequestPath(context.req.path);

      applicationLogger.error('HTTP request failed', {
        requestId,
        method: context.req.method,
        path,
        errorName: error.name,
      });

      const response = toErrorResponse(error, requestId);
      context.header('x-request-id', requestId);
      if (response.status === 429) context.header('retry-after', '60');
      return context.json(response.body, response.status);
    },
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
      authToken: env.TURSO_AUTH_TOKEN,
    }),
    domains: {
      observability: await observabilityStorage.getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter(), new PrivateTraceProcessor()],
      },
    },
  }),
});
