import { config } from 'dotenv';

config({ quiet: true });

const { closeDatabaseConnection, verifyDatabaseConnection } = await import('./client');

try {
  await verifyDatabaseConnection();
  console.log('PostgreSQL connection successful.');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown PostgreSQL connection error.';
  console.error(message);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
