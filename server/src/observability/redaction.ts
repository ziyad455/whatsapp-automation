const sensitiveKeys = new Set([
  'authorization', 'cookie', 'setcookie', 'password', 'passwordhash', 'token',
  'accesstoken', 'refreshtoken', 'secret', 'apikey', 'verifytoken', 'headers',
  'request', 'response', 'requestbodyvalues', 'responsebody', 'responseheaders',
  'body', 'payload', 'content', 'messages', 'prompt', 'instructions', 'input',
  'output', 'phone', 'customerphone', 'recipientphone', 'whatsappphone', 'email',
  'customername', 'stack', 'cause', 'details', 'requestcontext',
  'text', 'reply', 'message', 'arguments', 'result', 'data', 'query', 'params',
]);
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
export const REDACTED = '[REDACTED]';

const loggedPathPrefixes = new Set([
  '/health', '/ready', '/version', '/account', '/businesses', '/tenant-context',
  '/auth/api', '/webhooks/whatsapp', '/dashboard/agent-chat', '/dashboard/ai-playground',
  '/dashboard/business-profile', '/dashboard/opening-hours', '/dashboard/business-rules',
  '/dashboard/entity-types', '/dashboard/entities', '/dashboard/business-understanding',
  '/dashboard/conversations', '/dashboard/leads', '/dashboard/customers', '/dashboard/campaigns',
  '/dashboard/analytics', '/dashboard/follow-up-settings',
]);
export const safeRequestPath = (path: string): string => {
  const prefix = path.split('/').slice(0, 3).join('/');
  return loggedPathPrefixes.has(prefix) ? prefix : '/unmatched';
};

export const redactText = (text: string, secrets: readonly string[] = []): string => {
  let result = text;
  for (const secret of secrets) if (secret.length >= 4) result = result.replaceAll(secret, REDACTED);
  return result
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, '[URL REDACTED]')
    .replace(/\b(?:Bearer\s+\S+|sk-(?:or-v1-)?[a-zA-Z0-9_-]{12,})/gi, REDACTED)
    .slice(0, 500);
};

export const redactFields = (
  value: unknown,
  secrets: readonly string[] = [],
  seen = new WeakSet<object>(),
  depth = 0,
): unknown => {
  if (depth > 8) return REDACTED;
  if (value instanceof Error) return { name: value.name, message: '[Error details suppressed]' };
  if (typeof value === 'string') return redactText(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactFields(item, secrets, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => {
    const normalized = normalizeKey(key);
    const sensitive = sensitiveKeys.has(normalized) ||
      ['secret', 'token', 'apikey', 'databaseurl'].some(suffix => normalized.endsWith(suffix));
    return [key, sensitive ? REDACTED : redactFields(item, secrets, seen, depth + 1)];
  }));
};
