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
import { mastraAuth } from '../auth/mastra-auth';
import { toErrorResponse } from '../http/errors';
import { applicationLogger } from '../http/logger';
import { readinessMiddleware, requestContextMiddleware } from '../http/middleware';
import { getOrCreateRequestId } from '../http/request-context';
import { applicationRoutes } from '../http/routes';
import { agent } from './agents/agent';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';

const observabilityStorage = env.MASTRA_OBSERVABILITY_DATABASE_PATH
  ? new DuckDBStore({ path: env.MASTRA_OBSERVABILITY_DATABASE_PATH })
  : new DuckDBStore();

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent },
  tools: { startScheduleTool, stopScheduleTool },
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
    middleware: [requestContextMiddleware, readinessMiddleware],
    onError: (error, context) => {
      const requestId = getOrCreateRequestId(context.get('requestContext'));
      const path = new URL(context.req.url).pathname;

      applicationLogger.error('HTTP request failed', {
        requestId,
        method: context.req.method,
        path,
        errorName: error.name,
      });

      const response = toErrorResponse(error, requestId);
      context.header('x-request-id', requestId);
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
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
