import { PinoLogger } from '@mastra/loggers';
import { env } from '../config/env';

export const applicationLogger = new PinoLogger({
  name: 'whatsapp-automation-server',
  level: env.NODE_ENV === 'test' ? 'warn' : 'info',
  prettyPrint: env.NODE_ENV === 'development',
  redact: {
    paths: [
      'authorization',
      'cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.token',
      'DATABASE_URL',
    ],
    censor: '[REDACTED]',
  },
});
