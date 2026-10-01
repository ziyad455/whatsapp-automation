import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { processDueCampaignRecipients } from '../../reactivation/campaign-worker';
import { withCorrelation } from '../../observability/correlation';
import { signalOperationalFailure } from '../../observability/operational-alerts';

const inputSchema = z.object({ trigger: z.literal('SCHEDULED') }).strict();
const outputSchema = z.object({ processed: z.number().int(), sent: z.number().int() });

const processDue = createStep({
  id: 'process-due-campaign-recipients',
  inputSchema,
  outputSchema,
  execute: async ({ runId }) => withCorrelation({ workflowRunId: runId }, async () => {
    try { return await processDueCampaignRecipients(); }
    catch (error) {
      signalOperationalFailure('WORKFLOW_FAILURE', { workflowRunId: runId });
      throw error;
    }
  }),
});

export const campaignWorkflow = createWorkflow({
  id: 'customer-reactivation-campaigns',
  inputSchema,
  outputSchema,
  schedule: {
    cron: '* * * * *',
    timezone: 'UTC',
    inputData: { trigger: 'SCHEDULED' },
  },
}).then(processDue).commit();
