import { RequestContext } from '@mastra/core/request-context';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentResultSchema } from '../src/ai/agent-result';
import type { CustomerServiceAgentInput } from '../src/ai/customer-service-agent';
import {
  handleAiPlaygroundConversation,
  handleAiPlaygroundMessage,
  handleAiPlaygroundReset,
} from '../src/channels/ai-playground-channel';
import { createBusiness } from '../src/businesses/business.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { AUTHENTICATED_USER_KEY, initializeRequestContext } from '../src/http/request-context';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

let tenantA: TenantContext;
let tenantB: TenantContext;

const authenticatedContext = (userId: string): RequestContext => {
  const context = new RequestContext();
  initializeRequestContext(context);
  context.setRaw(AUTHENTICATED_USER_KEY, { user: { id: userId } });
  return context;
};

const request = (message: string, conversationId?: string) => new Request(
  'http://dashboard.test/dashboard/ai-playground',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  },
);

const send = (
  tenant: TenantContext,
  message: string,
  runCustomerService: (input: CustomerServiceAgentInput) => Promise<{
    result: ReturnType<typeof agentResultSchema.parse>;
    diagnostics: {
      scope: 'BUSINESS_RELATED';
      generationBypassed: false;
      partiallyRelated: false;
      toolCalls: Array<{ tool: 'getOpeningHours'; outcome: 'FOUND'; freshness: 'FRESH' }>;
    };
  }>,
  conversationId?: string,
) => handleAiPlaygroundMessage({
  requestContext: authenticatedContext(tenant.userId),
  selectedBusinessId: tenant.businessId,
  request: request(message, conversationId),
}, { runCustomerService });

describe('Sprint 8 internal AI playground channel', () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { name: 'Playground owner A', email: 'playground-a@example.test', emailVerified: true } }),
      prisma.user.create({ data: { name: 'Playground owner B', email: 'playground-b@example.test', emailVerified: true } }),
    ]);
    const [businessA, businessB] = await Promise.all([
      createBusiness({ name: 'Playground Atlas Cars', category: 'CAR_RENTAL', timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'en', lifecycleStatus: 'ACTIVE' }),
      createBusiness({ name: 'Playground Nour Beauty', category: 'SALON', timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'fr', lifecycleStatus: 'ACTIVE' }),
    ]);
    const [membershipA, membershipB] = await Promise.all([
      createMembership({ userId: userA.id, businessId: businessA.id, role: 'OWNER' }),
      createMembership({ userId: userB.id, businessId: businessB.id, role: 'OWNER' }),
    ]);
    tenantA = { userId: userA.id, businessId: businessA.id, membershipId: membershipA.id, role: membershipA.role };
    tenantB = { userId: userB.id, businessId: businessB.id, membershipId: membershipB.id, role: membershipB.role };
  });

  beforeEach(async () => {
    await prisma.conversation.deleteMany({ where: { businessId: { in: [tenantA.businessId, tenantB.businessId] } } });
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: [tenantA.businessId, tenantB.businessId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [tenantA.userId, tenantB.userId] } } });
    await closeDatabaseConnection();
  });

  it('persists several turns and returns safe tool/result diagnostics', async () => {
    const inputs: CustomerServiceAgentInput[] = [];
    const runtime = vi.fn(async (input: CustomerServiceAgentInput) => {
      inputs.push(input);
      return {
        result: agentResultSchema.parse({
          reply: inputs.length === 1 ? 'We open at 09:00.' : 'Saturday is 10:00 to 14:00.',
          needsHuman: false,
          detectedIntent: 'BUSINESS_INFORMATION',
          reasonCode: 'NONE',
          detectedLanguage: 'en',
        }),
        diagnostics: { scope: 'BUSINESS_RELATED' as const, generationBypassed: false as const, partiallyRelated: false as const, toolCalls: [{ tool: 'getOpeningHours' as const, outcome: 'FOUND' as const, freshness: 'FRESH' as const }] },
      };
    });

    const first = await send(tenantA, 'When do you open?', runtime);
    const second = await send(tenantA, 'What about Saturday?', runtime, first.conversationId);

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.diagnostics.toolCalls).toEqual([{ tool: 'getOpeningHours', outcome: 'FOUND', freshness: 'FRESH' }]);
    expect(inputs[1]?.history?.messages.map(message => message.content)).toEqual([
      'When do you open?',
      'We open at 09:00.',
    ]);

    const transcript = await handleAiPlaygroundConversation({
      requestContext: authenticatedContext(tenantA.userId),
      selectedBusinessId: tenantA.businessId,
    });
    expect(transcript.conversation?.id).toBe(first.conversationId);
    expect(transcript.conversation?.messages).toHaveLength(4);
  });

  it('rejects a foreign conversation selector before invoking the runtime', async () => {
    const runtime = vi.fn(async () => ({
      result: agentResultSchema.parse({ reply: 'Okay.', needsHuman: false, detectedIntent: 'UNKNOWN', reasonCode: 'NONE', detectedLanguage: 'other' }),
      diagnostics: { scope: 'BUSINESS_RELATED' as const, generationBypassed: false as const, partiallyRelated: false as const, toolCalls: [{ tool: 'getOpeningHours' as const, outcome: 'FOUND' as const, freshness: 'FRESH' as const }] },
    }));
    const foreign = await send(tenantB, 'Hello', runtime);
    runtime.mockClear();

    await expect(send(tenantA, 'Continue this conversation', runtime, foreign.conversationId))
      .rejects.toMatchObject({ status: 404 });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('resets only the authorized tenant playground conversation', async () => {
    const runtime = async () => ({
      result: agentResultSchema.parse({ reply: 'Okay.', needsHuman: false, detectedIntent: 'UNKNOWN', reasonCode: 'NONE', detectedLanguage: 'other' }),
      diagnostics: { scope: 'BUSINESS_RELATED' as const, generationBypassed: false as const, partiallyRelated: false as const, toolCalls: [{ tool: 'getOpeningHours' as const, outcome: 'FOUND' as const, freshness: 'FRESH' as const }] },
    });
    await send(tenantA, 'A message', runtime);
    await send(tenantB, 'B message', runtime);

    await handleAiPlaygroundReset({
      requestContext: authenticatedContext(tenantA.userId),
      selectedBusinessId: tenantA.businessId,
    });
    const [a, b] = await Promise.all([
      handleAiPlaygroundConversation({ requestContext: authenticatedContext(tenantA.userId), selectedBusinessId: tenantA.businessId }),
      handleAiPlaygroundConversation({ requestContext: authenticatedContext(tenantB.userId), selectedBusinessId: tenantB.businessId }),
    ]);
    expect(a.conversation).toBeNull();
    expect(b.conversation?.messages).toHaveLength(2);
  });
});
