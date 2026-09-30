import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { processDueFollowUps } from '../../follow-ups/follow-up-worker';

const inputSchema = z.object({ trigger: z.literal('SCHEDULED') });
const outputSchema = z.object({ processed: z.number().int(), sent: z.number().int() });

const processDue = createStep({
  id: 'process-due-follow-ups',
  inputSchema,
  outputSchema,
  execute: async () => processDueFollowUps(),
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
