import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentResultSchema, type AgentResult } from '../src/ai/agent-result';
import { HISTORY_MESSAGE_LIMIT } from '../src/ai/conversation-context';
import { runCustomerServiceAgent, type CustomerServiceAgentInput } from '../src/ai/customer-service-agent';
import { BUSINESS_WEEKDAYS, createTenantOpeningHoursService } from '../src/business-configuration/tenant-opening-hours.service';
import { createBusiness } from '../src/businesses/business.repository';
import {
  handleDashboardAgentRequest,
  handleDashboardConversationRequest,
  type DashboardConversationRunner,
} from '../src/channels/dashboard-agent-channel';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { runCustomerServiceConversation } from '../src/conversations/customer-service-conversation';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { AUTHENTICATED_USER_KEY, initializeRequestContext } from '../src/http/request-context';
import { createMembership } from '../src/memberships/business-user.repository';
import { getOpeningHours, openingHoursOutputSchema } from '../src/mastra/tools/business-information-tools';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

interface Fixture {
  tenant: TenantContext;
  businessName: string;
}

let tenantA: Fixture;
let tenantB: Fixture;

const result = (reply: string): AgentResult => agentResultSchema.parse({
  reply,
  needsHuman: false,
  detectedIntent: 'BUSINESS_INFORMATION',
  reasonCode: 'NONE',
  detectedLanguage: 'en',
});

const createAuthenticatedContext = (userId?: string): RequestContext => {
  const requestContext = new RequestContext();
  initializeRequestContext(requestContext);
  if (userId) requestContext.setRaw(AUTHENTICATED_USER_KEY, { user: { id: userId } });
  return requestContext;
};

const createRequest = (message: string, conversationId?: string, extra?: object): Request =>
  new Request('http://dashboard.test/dashboard/agent-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}), ...extra }),
  });

const send = (
  fixture: Fixture,
  message: string,
  runConversation: DashboardConversationRunner,
  conversationId?: string,
) => handleDashboardAgentRequest({
  requestContext: createAuthenticatedContext(fixture.tenant.userId),
  selectedBusinessId: fixture.tenant.businessId,
  request: createRequest(message, conversationId),
}, { runConversation });

describe('dashboard customer-service conversation channel', () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { name: 'Dashboard Conversation Owner A', email: 'dashboard-conversation-a@example.test', emailVerified: true } }),
      prisma.user.create({ data: { name: 'Dashboard Conversation Owner B', email: 'dashboard-conversation-b@example.test', emailVerified: true } }),
    ]);
    const [businessA, businessB] = await Promise.all([
      createBusiness({ name: 'Conversation Atlas Cars', category: 'CAR_RENTAL', timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'en', lifecycleStatus: 'ACTIVE' }),
      createBusiness({ name: 'Conversation Nour Beauty', category: 'SALON', timezone: 'Africa/Casablanca', currency: 'MAD', defaultLanguage: 'en', lifecycleStatus: 'ACTIVE' }),
    ]);
    const [membershipA, membershipB] = await Promise.all([
      createMembership({ userId: userA.id, businessId: businessA.id, role: 'OWNER' }),
      createMembership({ userId: userB.id, businessId: businessB.id, role: 'OWNER' }),
    ]);

    tenantA = { businessName: businessA.name, tenant: { userId: userA.id, businessId: businessA.id, membershipId: membershipA.id, role: membershipA.role } };
    tenantB = { businessName: businessB.name, tenant: { userId: userB.id, businessId: businessB.id, membershipId: membershipB.id, role: membershipB.role } };

    await createTenantOpeningHoursService(tenantA.tenant).replaceWeek(
      BUSINESS_WEEKDAYS.map(dayOfWeek => ({
        dayOfWeek,
        isOpen: true,
        opensAt: dayOfWeek === 'SATURDAY' ? '10:00' : '09:00',
        closesAt: dayOfWeek === 'SATURDAY' ? '14:00' : '18:00',
      })),
    );
  });

  beforeEach(async () => {
    await prisma.conversation.deleteMany({ where: { businessId: { in: [tenantA.tenant.businessId, tenantB.tenant.businessId] } } });
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: [tenantA.tenant.businessId, tenantB.tenant.businessId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [tenantA.tenant.userId, tenantB.tenant.userId] } } });
    await closeDatabaseConnection();
  });

  it('resolves authentication and rejects browser-supplied tenant selectors before running a conversation', async () => {
    const runConversation = vi.fn<DashboardConversationRunner>();

    await expect(handleDashboardAgentRequest({
      requestContext: createAuthenticatedContext(),
      selectedBusinessId: tenantA.tenant.businessId,
      request: createRequest('Hello'),
    }, { runConversation })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });

    await expect(handleDashboardAgentRequest({
      requestContext: createAuthenticatedContext(tenantA.tenant.userId),
      selectedBusinessId: tenantA.tenant.businessId,
      request: createRequest('Hello', undefined, { businessId: tenantB.tenant.businessId }),
    }, { runConversation })).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });

    expect(runConversation).not.toHaveBeenCalled();
  });

  it('persists second-turn references and reloads the same dashboard conversation', async () => {
    const observedInputs: CustomerServiceAgentInput[] = [];
    const runConversation: DashboardConversationRunner = input =>
      runCustomerServiceConversation(input, {
        runCustomerService: async agentInput => {
          observedInputs.push(agentInput);
          const reply = agentInput.message === 'when do you open'
            ? 'We open at 09:00 on weekdays.'
            : agentInput.message === 'use your tools to confirm'
              ? 'I will confirm the opening hours discussed above.'
              : 'On Saturday, we open from 10:00 to 14:00.';
          return result(reply);
        },
      });

    const first = await send(tenantA, 'when do you open', runConversation);
    const second = await send(tenantA, 'use your tools to confirm', runConversation, first.conversationId);
    await send(tenantA, 'what about Saturday?', runConversation, second.conversationId);

    expect(observedInputs[1]?.history?.messages.map(message => message.content)).toEqual([
      'when do you open',
      'We open at 09:00 on weekdays.',
    ]);
    expect(observedInputs[2]?.history?.messages.map(message => message.content)).toEqual([
      'when do you open',
      'We open at 09:00 on weekdays.',
      'use your tools to confirm',
      'I will confirm the opening hours discussed above.',
    ]);

    const reloaded = await handleDashboardConversationRequest({
      requestContext: createAuthenticatedContext(tenantA.tenant.userId),
      selectedBusinessId: tenantA.tenant.businessId,
    });
    expect(reloaded.conversation?.id).toBe(first.conversationId);
    expect(reloaded.conversation?.messages.map(message => message.content)).toEqual([
      'when do you open',
      'We open at 09:00 on weekdays.',
      'use your tools to confirm',
      'I will confirm the opening hours discussed above.',
      'what about Saturday?',
      'On Saturday, we open from 10:00 to 14:00.',
    ]);
  });

  it('persists application-owned pending actions and consumes an accepted action on the next turn', async () => {
    const observedInputs: CustomerServiceAgentInput[] = [];
    const runConversation: DashboardConversationRunner = input =>
      runCustomerServiceConversation(input, {
        runCustomerService: async agentInput => {
          observedInputs.push(agentInput);
          const firstTurn = observedInputs.length === 1;
          return {
            result: result(firstTurn
              ? 'The Clio is 300 MAD/day. I can also check the other available options.'
              : 'The Dacia Logan is also available.'),
            diagnostics: {
              scope: 'BUSINESS_RELATED',
              generationBypassed: false,
              partiallyRelated: false,
              toolCalls: [],
            },
            offeredActions: firstTurn
              ? [{ type: 'LIST_AVAILABLE_ENTITIES' as const, entityType: 'vehicle' }]
              : [],
          };
        },
      });

    const first = await send(tenantA, 'How much is the Clio?', runConversation);
    await send(tenantA, 'okay do that', runConversation, first.conversationId);

    expect(observedInputs[0]?.pendingActions).toEqual([]);
    expect(observedInputs[1]?.pendingActions).toEqual([
      { type: 'LIST_AVAILABLE_ENTITIES', entityType: 'vehicle' },
    ]);
    await expect(createTenantConversationRepository(tenantA.tenant).findById(first.conversationId))
      .resolves.toMatchObject({ pendingActions: [] });
  });

  it('loads only the bounded recent history into the shared agent runtime', async () => {
    const conversation = await resolveChannelConversation(tenantA.tenant, { channel: 'DASHBOARD', participantKey: tenantA.tenant.userId, createIfMissing: true });
    if (!conversation) throw new Error('Expected dashboard conversation.');

    const repository = createTenantConversationRepository(tenantA.tenant);
    for (let index = 0; index < 20; index++) {
      await repository.appendMessage(conversation.id, {
        senderType: 'CUSTOMER',
        content: `Question ${index}`,
      });
      await repository.appendMessage(conversation.id, {
        senderType: 'AI',
        content: `Answer ${index}`,
      });
    }

    let observedInput: CustomerServiceAgentInput | undefined;
    await runCustomerServiceConversation({ tenant: tenantA.tenant, conversation, message: 'Follow-up question' }, {
      runCustomerService: async input => {
        observedInput = input;
        return result('Bounded answer');
      },
    });

    expect(observedInput?.history?.messages).toHaveLength(HISTORY_MESSAGE_LIMIT);
    expect(observedInput?.history?.messages[0]?.content).toBe('Question 14');
    expect(observedInput?.history?.messages.at(-1)?.content).toBe('Answer 19');
    expect(observedInput?.history?.messages.some(message => message.content === 'Question 0')).toBe(false);
  });

  it('uses current tenant-bound tool data instead of stale facts in conversation history', async () => {
    const conversation = await resolveChannelConversation(tenantA.tenant, { channel: 'DASHBOARD', participantKey: tenantA.tenant.userId, createIfMissing: true });
    if (!conversation) throw new Error('Expected dashboard conversation.');

    const repository = createTenantConversationRepository(tenantA.tenant);
    await repository.appendMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: 'Are you open Saturday?',
    });
    await repository.appendMessage(conversation.id, {
      senderType: 'AI',
      content: 'We are closed on Saturday.',
    });

    const response = await runCustomerServiceConversation({ tenant: tenantA.tenant, conversation, message: 'Can you confirm that?' }, {
      runCustomerService: input => runCustomerServiceAgent(input, {
        executor: async execution => {
          const output = openingHoursOutputSchema.parse(await getOpeningHours.execute!(
            {},
            { requestContext: execution.requestContext, observe: noopObserve },
          ));
          const saturday = output.hours.find(hour => hour.dayOfWeek === 'SATURDAY');
          return saturday?.isOpen
            ? `Saturday hours are ${saturday.opensAt} to ${saturday.closesAt}.`
            : 'We are closed on Saturday.';
        },
      }),
    });

    expect(agentResultSchema.parse(response.result).reply).toContain('10:00 to 14:00');
    expect(response.result.reply).not.toContain('closed');
  });

  it('treats conversation IDs as tenant-scoped selectors rather than authorization', async () => {
    const tenantBRunner: DashboardConversationRunner = input =>
      runCustomerServiceConversation(input, { runCustomerService: async () => result(`Reply for ${tenantB.businessName}`) });
    const foreign = await send(tenantB, 'Start a private conversation', tenantBRunner);
    const deniedRunner = vi.fn<DashboardConversationRunner>();

    await expect(send(tenantA, 'Continue the other tenant conversation', deniedRunner, foreign.conversationId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(deniedRunner).not.toHaveBeenCalled();

    const foreignMessages = await createTenantConversationRepository(tenantB.tenant)
      .listRecentMessages(foreign.conversationId, 50);
    expect(foreignMessages).toHaveLength(2);
  });

  it('keeps concurrent dashboard conversations and persisted histories isolated by tenant', async () => {
    const runConversation: DashboardConversationRunner = input =>
      runCustomerServiceConversation(input, {
        runCustomerService: async () => {
          const businessName = input.tenant.businessId === tenantA.tenant.businessId
            ? tenantA.businessName
            : tenantB.businessName;
          return result(`Reply for ${businessName}`);
        },
      });

    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const fixture = index % 2 === 0 ? tenantA : tenantB;
      return send(fixture, `Message ${index}`, runConversation);
    }));

    const idsA = new Set(responses.filter((_, index) => index % 2 === 0).map(item => item.conversationId));
    const idsB = new Set(responses.filter((_, index) => index % 2 === 1).map(item => item.conversationId));
    expect(idsA.size).toBe(1);
    expect(idsB.size).toBe(1);
    expect([...idsA][0]).not.toBe([...idsB][0]);

    const [conversationAId] = idsA;
    const [conversationBId] = idsB;
    if (!conversationAId || !conversationBId) throw new Error('Expected tenant conversations.');
    const [messagesA, messagesB] = await Promise.all([
      createTenantConversationRepository(tenantA.tenant).listRecentMessages(conversationAId, 50),
      createTenantConversationRepository(tenantB.tenant).listRecentMessages(conversationBId, 50),
    ]);
    expect(messagesA).toHaveLength(12);
    expect(messagesB).toHaveLength(12);
    expect(JSON.stringify(messagesA)).not.toContain(tenantB.businessName);
    expect(JSON.stringify(messagesB)).not.toContain(tenantA.businessName);
  });
});
