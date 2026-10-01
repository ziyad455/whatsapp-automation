import { applicationLogger } from '../http/logger';

type AlertKind = 'META_AUTH' | 'META_SEND' | 'WEBHOOK_SIGNATURE' | 'WEBHOOK_PROCESSING' |
  'AI_FAILURE' | 'DATABASE_UNAVAILABLE' | 'WORKFLOW_FAILURE' | 'STALE_ATTEMPT';
type AlertContext = Partial<Record<'businessId' | 'conversationId' | 'messageId' | 'workflowRunId', string>>;
export type OperationalAlert = AlertContext & {
  event: 'operational.alert'; kind: AlertKind; count: number; windowMs: number;
};

export const createOperationalAlerts = (deliver: (event: OperationalAlert) => void) => {
  const windows = new Map<string, { count: number; since: number; emitted: boolean }>();
  return (kind: AlertKind, context: AlertContext = {}, now = Date.now()): void => {
    const key = `${kind}:${context.businessId ?? 'platform'}`;
    const windowMs = 300_000;
    let entry = windows.get(key);
    if (!entry || now - entry.since >= windowMs) {
      if (windows.size >= 10_000) {
        for (const [id, value] of windows) if (now - value.since >= windowMs) windows.delete(id);
        if (windows.size >= 10_000) return;
      }
      entry = { count: 0, since: now, emitted: false };
      windows.set(key, entry);
    }
    entry.count += 1;
    const threshold = kind === 'META_AUTH' || kind === 'DATABASE_UNAVAILABLE' || kind === 'STALE_ATTEMPT'
      ? 1 : kind === 'WEBHOOK_SIGNATURE' ? 20 : 5;
    if (entry.count < threshold || entry.emitted) return;
    entry.emitted = true;
    deliver({ event: 'operational.alert', kind, count: entry.count, windowMs, ...context });
  };
};

// Delivery hook for the deployment's log-based monitor. No external destination
// is configured in this repository; the runbook specifies the required rule.
export const signalOperationalFailure = createOperationalAlerts(event => {
  applicationLogger.error('Operational alert', event);
});
