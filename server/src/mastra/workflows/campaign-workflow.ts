import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { processDueCampaignRecipients } from '../../reactivation/campaign-worker';

const inputSchema = z.object({ trigger: z.literal('SCHEDULED') });
const outputSchema = z.object({ processed: z.number().int(), sent: z.number().int() });

const processDue = createStep({
  id: 'process-due-campaign-recipients',
  inputSchema,
  outputSchema,
  execute: async () => processDueCampaignRecipients(),
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
