import { WhatsAppSendError } from './whatsapp-send.types';

export type FailureCategory = 'TRANSIENT' | 'PERMANENT' | 'AUTH_CONFIGURATION' | 'RATE_LIMIT' | 'AMBIGUOUS';
export const MAX_SEND_ATTEMPTS = 3;

export const classifySendFailure = (error: unknown): FailureCategory => {
  if (!(error instanceof WhatsAppSendError)) return 'AMBIGUOUS';
  switch (error.code) {
    case 'AUTHENTICATION':
    case 'CONFIGURATION':
    case 'CONNECTION_UNAVAILABLE': return 'AUTH_CONFIGURATION';
    case 'RATE_LIMITED': return 'RATE_LIMIT';
    case 'PROVIDER_UNAVAILABLE': return 'TRANSIENT';
    case 'TIMEOUT':
    case 'NETWORK':
    case 'INVALID_RESPONSE': return 'AMBIGUOUS';
    default: return 'PERMANENT';
  }
};

export const nextSendAttempt = (
  error: unknown,
  attemptCount: number,
  now: Date,
): Date | null => {
  const category = classifySendFailure(error);
  if (attemptCount < 1 || attemptCount >= MAX_SEND_ATTEMPTS ||
      !(error instanceof WhatsAppSendError) || !error.retryable ||
      (category !== 'RATE_LIMIT' && category !== 'TRANSIENT')) return null;
  const backoff = Math.min(15 * 60_000, 60_000 * 2 ** attemptCount);
  return new Date(now.getTime() + Math.max(backoff, error.retryAfterMs ?? 0));
};
