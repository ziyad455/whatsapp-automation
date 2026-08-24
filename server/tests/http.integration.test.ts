import { describe, expect, it } from 'vitest';
import { startMastraServer } from './helpers/mastra-server';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for HTTP integration tests.');
}

describe('Mastra application HTTP foundation', () => {
  it('serves the application, liveness, and ready endpoints', async () => {
    const server = await startMastraServer({
      databaseUrl: testDatabaseUrl,
      port: 4211,
    });

    try {
      const applicationResponse = await fetch(`${server.baseUrl}/version`, {
        headers: { 'x-request-id': 'integration-request' },
      });
      const healthResponse = await fetch(`${server.baseUrl}/health`);
      const readinessResponse = await fetch(`${server.baseUrl}/ready`);

      expect(applicationResponse.status).toBe(200);
      await expect(applicationResponse.json()).resolves.toEqual({
        name: 'whatsapp-automation-server',
        version: '1.0.0',
      });
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ success: true });
      expect(readinessResponse.status).toBe(200);
      await expect(readinessResponse.json()).resolves.toEqual({
        status: 'ready',
        dependencies: { postgresql: 'ready' },
      });
    } finally {
      await server.stop();
    }
  });

  it('keeps health live and reports readiness failure when PostgreSQL is unavailable', async () => {
    const server = await startMastraServer({
      databaseUrl: 'postgresql://127.0.0.1:1/unavailable',
      port: 4212,
    });

    try {
      const healthResponse = await fetch(`${server.baseUrl}/health`);
      const readinessResponse = await fetch(`${server.baseUrl}/ready`);
      const readinessBody = (await readinessResponse.json()) as {
        error: { code: string; message: string };
        requestId: string;
      };

      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ success: true });
      expect(readinessResponse.status).toBe(503);
      expect(readinessBody.error).toEqual({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'PostgreSQL is unavailable.',
      });
      expect(readinessBody.requestId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await server.stop();
    }
  });
});
