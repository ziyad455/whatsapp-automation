import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { processDueFollowUps } from '../../follow-ups/follow-up-worker';
import { withCorrelation } from '../../observability/correlation';
import { signalOperationalFailure } from '../../observability/operational-alerts';

const inputSchema = z.object({ trigger: z.literal('SCHEDULED') }).strict();
const outputSchema = z.object({ processed: z.number().int(), sent: z.number().int() });

const processDue = createStep({
  id: 'process-due-follow-ups',
  inputSchema,
  outputSchema,
  execute: async ({ runId }) => withCorrelation({ workflowRunId: runId }, async () => {
    try { return await processDueFollowUps(); }
    catch (error) {
      signalOperationalFailure('WORKFLOW_FAILURE', { workflowRunId: runId });
      throw error;
    }
  }),
});

export const followUpWorkflow = createWorkflow({
  id: 'due-follow-ups',
  inputSchema,
  outputSchema,
  schedule: {
    cron: '* * * * *',
    timezone: 'UTC',
    inputData: { trigger: 'SCHEDULED' },
  },
}).then(processDue).commit();
