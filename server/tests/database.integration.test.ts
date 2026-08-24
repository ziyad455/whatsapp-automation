import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const client = new Client({ connectionString: testDatabaseUrl });

describe('database migration foundation', () => {
  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('records the applied baseline migration', async () => {
    const result = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );

    expect(result.rows[0]?.count).toBeGreaterThanOrEqual(1);
  });
});
