import { PinoLogger, type PinoLoggerOptions } from '@mastra/loggers';
import { env } from '../config/env';
import { currentCorrelation } from '../observability/correlation';
import { redactFields, redactText } from '../observability/redaction';

const secrets = [env.DATABASE_URL, env.OPENROUTER_API_KEY, env.BETTER_AUTH_SECRET,
  env.META_WHATSAPP_ACCESS_TOKEN, env.META_WHATSAPP_APP_SECRET,
  env.META_WHATSAPP_VERIFY_TOKEN, env.TURSO_AUTH_TOKEN].filter((value): value is string => Boolean(value));

class PrivateLogger extends PinoLogger {
  private bindings: Record<string, unknown> = {};
  override child(bindings: Record<string, unknown>): PinoLogger {
    const child = new PrivateLogger(loggerOptions);
    child.bindings = { ...this.bindings, ...bindings };
    return child;
  }
  override debug(message: string, args?: Record<string, unknown>): void { super.debug(redactText(message, secrets), { ...this.bindings, ...args }); }
  override info(message: string, args?: Record<string, unknown>): void { super.info(redactText(message, secrets), { ...this.bindings, ...args }); }
  override warn(message: string, args?: Record<string, unknown>): void { super.warn(redactText(message, secrets), { ...this.bindings, ...args }); }
  override error(message: string, args?: Record<string, unknown>): void { super.error(redactText(message, secrets), { ...this.bindings, ...args }); }
}

const loggerOptions: PinoLoggerOptions = {
  name: 'whatsapp-automation-server',
  level: env.NODE_ENV === 'test' ? 'warn' : 'info',
  prettyPrint: env.NODE_ENV === 'development',
  mixin: () => currentCorrelation(),
  formatters: { log: fields => redactFields(fields, secrets) as Record<string, unknown> },
  redact: {
    paths: [
      'authorization',
      'cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.token',
      '*.verify_token',
      'DATABASE_URL',
      'META_WHATSAPP_ACCESS_TOKEN',
      'META_WHATSAPP_APP_SECRET',
      'META_WHATSAPP_VERIFY_TOKEN',
    ],
    censor: '[REDACTED]',
  },
};

export const applicationLogger = new PrivateLogger(loggerOptions);
