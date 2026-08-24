import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const localEnvironment = config({
  path: resolve('.env'),
  quiet: true,
}).parsed;

const environment = {
  ...localEnvironment,
  ...process.env,
};

const parseDatabaseUrl = (value: string | undefined, name: string): URL => {
  if (!value) {
    throw new Error(`${name} is required to run database-backed tests.`);
  }

  try {
    const url = new URL(value);

    if (!/^postgres(?:ql)?:$/.test(url.protocol)) {
      throw new Error();
    }

    return url;
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }
};

const testDatabaseUrl = parseDatabaseUrl(environment.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
const developmentDatabaseUrl = parseDatabaseUrl(environment.DATABASE_URL, 'DATABASE_URL');
const testDatabaseName = testDatabaseUrl.pathname.slice(1);
const developmentDatabaseName = developmentDatabaseUrl.pathname.slice(1);
const sameDatabase =
  testDatabaseUrl.hostname === developmentDatabaseUrl.hostname &&
  (testDatabaseUrl.port || '5432') === (developmentDatabaseUrl.port || '5432') &&
  testDatabaseName === developmentDatabaseName;
const isExplicitlyEphemeral = environment.TEST_DATABASE_EPHEMERAL === 'true';

if (sameDatabase) {
  throw new Error('Tests refuse to use the configured development database.');
}

if (!testDatabaseName.endsWith('_test') && !isExplicitlyEphemeral) {
  throw new Error('The test database name must end with _test.');
}

const testEnvironment = {
  ...environment,
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl.toString(),
  MASTRA_OBSERVABILITY_DATABASE_PATH: ':memory:',
  TEST_DATABASE_URL: testDatabaseUrl.toString(),
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (arguments_: string[]): void => {
  const result = spawnSync(npmCommand, arguments_, {
    env: testEnvironment,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Unable to run npm ${arguments_.join(' ')}.`, {
      cause: result.error,
    });
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

console.log('Applying migrations to the isolated test database.');
run(['run', 'db:migrate']);
run(['run', 'test:run']);
