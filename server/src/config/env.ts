import { z } from 'zod';

const requiredEnvironmentVariable = (name: string) =>
  z.preprocess(
    value => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1, `${name} is required`),
  );

const optionalEnvironmentVariable = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const loopbackHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);

const requiredHttpOrigin = (name: string) =>
  requiredEnvironmentVariable(name).refine(value => {
    try {
      const url = new URL(value);
      const hasSafeProtocol =
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && loopbackHostnames.has(url.hostname));

      return hasSafeProtocol && url.origin === value;
    } catch {
      return false;
    }
  }, `${name} must be an HTTPS origin without a path, or an HTTP loopback origin for local development`);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MASTRA_DEV: z.enum(['true', 'false', '1', '0']).optional(),
  PORT: z.preprocess(
    value => (value === undefined || value === '' ? 4111 : Number(value)),
    z.number().int().min(1).max(65_535),
  ),
  DATABASE_URL: requiredEnvironmentVariable('DATABASE_URL').refine(
    value => value.length === 0 || /^postgres(?:ql)?:\/\//.test(value),
    'DATABASE_URL must be a PostgreSQL connection URL',
  ),
  OPENROUTER_API_KEY: requiredEnvironmentVariable('OPENROUTER_API_KEY'),
  BETTER_AUTH_SECRET: requiredEnvironmentVariable('BETTER_AUTH_SECRET').refine(
    value => value.length >= 32,
    'BETTER_AUTH_SECRET must contain at least 32 characters',
  ),
  BETTER_AUTH_URL: requiredHttpOrigin('BETTER_AUTH_URL'),
  DASHBOARD_URL: requiredHttpOrigin('DASHBOARD_URL'),
  META_WHATSAPP_API_VERSION: optionalEnvironmentVariable.refine(
    value => value === undefined || /^v\d+\.\d+$/.test(value),
    'META_WHATSAPP_API_VERSION must use a value such as v25.0',
  ),
  META_WHATSAPP_PHONE_NUMBER_ID: optionalEnvironmentVariable.refine(
    value => value === undefined || /^\d+$/.test(value),
    'META_WHATSAPP_PHONE_NUMBER_ID must contain digits only',
  ),
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: optionalEnvironmentVariable.refine(
    value => value === undefined || /^\d+$/.test(value),
    'META_WHATSAPP_BUSINESS_ACCOUNT_ID must contain digits only',
  ),
  META_WHATSAPP_ACCESS_TOKEN: optionalEnvironmentVariable,
  META_WHATSAPP_VERIFY_TOKEN: requiredEnvironmentVariable('META_WHATSAPP_VERIFY_TOKEN'),
  META_WHATSAPP_APP_SECRET: optionalEnvironmentVariable,
  MASTRA_OBSERVABILITY_DATABASE_PATH: optionalEnvironmentVariable,
  TURSO_DATABASE_URL: optionalEnvironmentVariable,
  TURSO_AUTH_TOKEN: optionalEnvironmentVariable,
});

const validation = serverEnvironmentSchema.safeParse(process.env);

if (!validation.success) {
  const issues = validation.error.issues
    .map(issue => {
      const variable = issue.path.map(String).join('.') || 'environment';
      return `- ${variable}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(`Invalid server environment configuration:\n${issues}`);
}

export const env = Object.freeze(validation.data);

// `mastra dev` runs the generated server bundle with NODE_ENV=production and
// exposes MASTRA_DEV=true to distinguish it from a production server.
export const isDevelopmentRuntime =
  env.NODE_ENV !== 'production' || env.MASTRA_DEV === 'true' || env.MASTRA_DEV === '1';
