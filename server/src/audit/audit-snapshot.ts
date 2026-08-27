import { Prisma } from '../generated/prisma/client';

const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|password|secret|token|api[_-]?key)/i;

const sanitizeValue = (value: unknown): Prisma.JsonValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item) ?? null);
  }

  if (typeof value === 'object') {
    const result: Record<string, Prisma.JsonValue> = {};

    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      const sanitized = sanitizeValue(item);

      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }

    return result;
  }

  return String(value);
};

export const createSafeAuditSnapshot = (
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === null
    ? Prisma.JsonNull
    : ((sanitizeValue(value) ?? Prisma.JsonNull) as
        | Prisma.InputJsonValue
        | typeof Prisma.JsonNull);
