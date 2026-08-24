import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';

const databasePool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
});

databasePool.on('error', error => {
  throw new Error('PostgreSQL pool encountered an unexpected idle-client error.', {
    cause: error,
  });
});

export const database = drizzle({ client: databasePool });

export const verifyDatabaseConnection = async (): Promise<void> => {
  try {
    await databasePool.query('select 1');
  } catch (error) {
    throw new Error('Unable to connect to PostgreSQL using DATABASE_URL.', {
      cause: error,
    });
  }
};

export const closeDatabaseConnection = async (): Promise<void> => {
  await databasePool.end();
};
