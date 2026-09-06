import { Agent } from '@mastra/core/agent';
import { customerServiceRequestContextSchema } from '../../ai/request-context';
import { CUSTOMER_SERVICE_AGENT_INSTRUCTIONS } from '../../ai/business-instructions';
import { customerServiceBusinessTools } from '../tools/business-information-tools';

export { customerServiceTenantContextSchema, customerServiceRequestContextSchema, type CustomerServiceRequestContext } from '../../ai/request-context';
export { CUSTOMER_SERVICE_AGENT_INSTRUCTIONS } from '../../ai/business-instructions';

export const CUSTOMER_SERVICE_AGENT_ID = 'customer-service' as const;

export const customerServiceAgent = new Agent({
  id: CUSTOMER_SERVICE_AGENT_ID,
  name: 'Customer Service',
  description: 'Shared tenant-safe customer-service agent for all businesses.',
  instructions: CUSTOMER_SERVICE_AGENT_INSTRUCTIONS,
  model: 'openrouter/openrouter/free',
  requestContextSchema: customerServiceRequestContextSchema,
  tools: customerServiceBusinessTools,
});
