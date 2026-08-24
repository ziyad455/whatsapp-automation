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

const serverEnvironmentSchema = z.object({
  DATABASE_URL: requiredEnvironmentVariable('DATABASE_URL').refine(
    value => value.length === 0 || /^postgres(?:ql)?:\/\//.test(value),
    'DATABASE_URL must be a PostgreSQL connection URL',
  ),
  GOOGLE_GENERATIVE_AI_API_KEY: requiredEnvironmentVariable('GOOGLE_GENERATIVE_AI_API_KEY'),
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
