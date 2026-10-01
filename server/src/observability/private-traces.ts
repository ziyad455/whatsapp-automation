import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';

const allowedFields = new Set([
  'requestId', 'businessId', 'conversationId', 'messageId', 'leadId', 'followUpId',
  'campaignId', 'campaignRecipientId', 'workflowRunId', 'agentRunId', 'operation',
  'model', 'modelId', 'provider', 'inputTokens', 'outputTokens', 'totalTokens',
  'durationMs', 'finishReason', 'toolId', 'agentId', 'workflowId', 'statusCode',
]);
const safeFields = (fields?: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields ?? {}).filter(([key, value]) =>
    allowedFields.has(key) && (typeof value === 'number' ||
      (typeof value === 'string' && /^[a-zA-Z0-9_./: -]{1,150}$/.test(value)))));

// Runs for every span (including model/tool children), before any exporter.
export class PrivateTraceProcessor implements SpanOutputProcessor {
  name = 'private-application-traces';
  async shutdown(): Promise<void> {}
  process(span: AnySpan): AnySpan {
    span.input = undefined;
    span.output = undefined;
    span.requestContext = undefined;
    span.metadata = safeFields(span.metadata);
    span.attributes = safeFields(span.attributes);
    if (span.errorInfo) span.errorInfo = { message: 'Operation failed; inspect correlated application event.' };
    return span;
  }
}
