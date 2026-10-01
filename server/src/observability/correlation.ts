import { AsyncLocalStorage } from 'node:async_hooks';

export type Correlation = Partial<Record<
  'requestId' | 'businessId' | 'conversationId' | 'messageId' | 'workflowRunId', string
>>;
const storage = new AsyncLocalStorage<Correlation>();
export const currentCorrelation = (): Correlation => storage.getStore() ?? {};
export const withCorrelation = <T>(context: Correlation, work: () => T): T =>
  storage.run({ ...currentCorrelation(), ...context }, work);
