import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  pendingCustomerActionsSchema,
  requestedCustomerActionsSchema,
} from '../../ai/customer-capabilities';
import { customerServiceRequestContextSchema, requireCustomerServiceRun } from '../../ai/request-context';

export const offerCustomerServiceActionsInputSchema = z.object({
  actions: requestedCustomerActionsSchema,
}).strict();

export const offerCustomerServiceActionsOutputSchema = z.object({
  acceptedActions: pendingCustomerActionsSchema,
}).strict();

export const offerCustomerServiceActions = createTool({
  id: 'offer-customer-service-actions',
  description: 'Register up to two real read-only follow-up actions that the application may offer. This does not execute an action or create a customer-facing reply.',
  strict: true,
  inputSchema: offerCustomerServiceActionsInputSchema,
  outputSchema: offerCustomerServiceActionsOutputSchema,
  requestContextSchema: customerServiceRequestContextSchema,
  execute: async (input, context) => {
    const run = requireCustomerServiceRun(context?.requestContext);
    return offerCustomerServiceActionsOutputSchema.parse({
      acceptedActions: run.offerActions(input.actions),
    });
  },
});

export const customerServiceControlTools = {
  offerCustomerServiceActions,
} as const;
