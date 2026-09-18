import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusiness } from '../src/businesses/business.repository';
import { createTenantConversationInboxService } from '../src/conversations/tenant-conversation-inbox.service';
import { resolveChannelConversation } from '../src/conversations/conversation.service';
import { createTenantConversationRepository } from '../src/conversations/tenant-conversation.repository';
import { resolveOrCreateWhatsAppCustomer } from '../src/customers/whatsapp-customer.service';
import { closeDatabaseConnection, prisma } from '../src/db/prisma';
import { createMembership } from '../src/memberships/business-user.repository';
import type { TenantContext } from '../src/tenancy/tenant-context';
import { createWhatsAppConnection } from '../src/whatsapp/whatsapp-connection.repository';
import {
  claimInboundWhatsAppMessage,
  markOutgoingWhatsAppMessageSent,
} from '../src/whatsapp/whatsapp-message.repository';
import { sendWhatsAppText } from '../src/whatsapp/whatsapp-send.service';
import { WhatsAppSendError } from '../src/whatsapp/whatsapp-send.types';
import type { WhatsAppTenantContext } from '../src/whatsapp/whatsapp-tenant-context';
import { assertIsolatedTestDatabase } from './helpers/assert-test-database';

assertIsolatedTestDatabase();

interface Fixture {
  readonly tenant: TenantContext;
  readonly whatsappTenant: WhatsAppTenantContext;
  readonly businessId: string;
  readonly membershipId: string;
  readonly userId: string;
}

let fixtureA: Fixture;
let fixtureB: Fixture;
let phoneSequence = 0;

const createFixture = async (label: string, phoneNumberId: string): Promise<Fixture> => {
  const user = await prisma.user.create({
    data: {
      name: `${label} Operator`,
      email: `s10-${label.toLowerCase()}-${randomUUID()}@example.test`,
      emailVerified: true,
    },
  });
  const business = await createBusiness({
    name: `${label} Business`,
    category: 'CAR_RENTAL',
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
    defaultLanguage: 'en',
    lifecycleStatus: 'ACTIVE',
  });
  const membership = await createMembership({
    userId: user.id,
    businessId: business.id,
    role: 'OWNER',
  });
  const connection = await createWhatsAppConnection({
    businessId: business.id,
    phoneNumberId,
    whatsappBusinessAccountId: `88${phoneNumberId}`,
    displayPhoneNumber: `+${phoneNumberId}`,
  });
  return {
    businessId: business.id,
    membershipId: membership.id,
    userId: user.id,
    tenant: {
      businessId: business.id,
      membershipId: membership.id,
      userId: user.id,
      role: membership.role,
    },
    whatsappTenant: {
      businessId: business.id,
      whatsappConnectionId: connection.id,
    },
  };
};

const createConversation = async (fixture: Fixture) => {
  phoneSequence += 1;
  const phone = `212611${String(phoneSequence).padStart(6, '0')}`;
  const customer = await resolveOrCreateWhatsAppCustomer(fixture.whatsappTenant, phone);
  const conversation = await resolveChannelConversation(
    { businessId: fixture.businessId },
    {
      channel: 'WHATSAPP',
      participantKey: customer.id,
      customerId: customer.id,
      whatsappConnectionId: fixture.whatsappTenant.whatsappConnectionId,
      createIfMissing: true,
    },
  );
  if (!conversation) throw new Error('Expected a WhatsApp conversation.');
  return { conversation, customer, phone };
};

const acceptedTransport = {
  sendText: async () => ({
    provider: 'WHATSAPP' as const,
    accepted: true as const,
    externalMessageId: `wamid.out.${randomUUID()}`,
  }),
};

describe('Sprint 10 persistent conversation operations', () => {
  beforeAll(async () => {
    fixtureA = await createFixture('Atlas', '991000000001');
    fixtureB = await createFixture('Nour', '991000000002');
  });

  afterAll(async () => {
    if (!fixtureA || !fixtureB) {
      await closeDatabaseConnection();
      return;
    }
    await prisma.conversation.updateMany({
      where: { businessId: { in: [fixtureA.businessId, fixtureB.businessId] } },
      data: { assignedBusinessUserId: null },
    });
    await prisma.business.deleteMany({
      where: { id: { in: [fixtureA.businessId, fixtureB.businessId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [fixtureA.userId, fixtureB.userId] } },
    });
    await closeDatabaseConnection();
  });

  it('reuses one persistent WhatsApp conversation for the same business/customer', async () => {
    const first = await createConversation(fixtureA);
    const second = await resolveChannelConversation(
      { businessId: fixtureA.businessId },
      {
        channel: 'WHATSAPP',
        participantKey: first.customer.id,
        customerId: first.customer.id,
        whatsappConnectionId: fixtureA.whatsappTenant.whatsappConnectionId,
        createIfMissing: true,
      },
    );

    expect(second?.id).toBe(first.conversation.id);
    expect(second).toMatchObject({
      customerId: first.customer.id,
      mode: 'AI',
      status: 'OPEN',
    });
  });

  it('keeps inbox/detail reads and assignment tenant-bound', async () => {
    const own = await createConversation(fixtureA);
    const foreign = await createConversation(fixtureB);
    const serviceA = createTenantConversationInboxService(fixtureA.tenant);

    await expect(serviceA.getById(foreign.conversation.id)).resolves.toBeNull();
    await expect(serviceA.setMode(foreign.conversation.id, 'HUMAN'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(prisma.conversation.update({
      where: { id: own.conversation.id },
      data: { assignedBusinessUserId: fixtureB.membershipId, mode: 'HUMAN' },
    })).rejects.toBeDefined();

    const unchanged = await prisma.conversation.findUniqueOrThrow({
      where: { id: own.conversation.id },
    });
    expect(unchanged.assignedBusinessUserId).toBeNull();
    expect(unchanged.mode).toBe('AI');
  });

  it('links inbound and outbound transport records to canonical history', async () => {
    const { conversation, customer, phone } = await createConversation(fixtureA);
    const repository = createTenantConversationRepository({
      businessId: fixtureA.businessId,
    });
    const externalInboundId = `wamid.in.${randomUUID()}`;
    const claim = await claimInboundWhatsAppMessage(
      fixtureA.whatsappTenant,
      customer.id,
      {
        provider: 'WHATSAPP',
        externalMessageId: externalInboundId,
        phoneNumberId: '991000000001',
        customerPhone: phone,
        type: 'TEXT',
        content: { text: 'Hello from WhatsApp' },
        timestamp: new Date(),
      },
    );
    if (claim.outcome !== 'CLAIMED') throw new Error('Expected an inbound claim.');
    const inbound = await repository.appendMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: 'Hello from WhatsApp',
      whatsappMessageId: claim.messageId,
    });
    const outbound = await repository.appendMessage(conversation.id, {
      senderType: 'AI',
      content: 'Hello from Atlas Cars',
    });
    const send = await sendWhatsAppText({
      tenant: fixtureA.whatsappTenant,
      to: phone,
      text: outbound.content,
      conversationMessageId: outbound.id,
    }, { transport: acceptedTransport });

    const detail = await createTenantConversationInboxService(fixtureA.tenant)
      .getById(conversation.id);
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0]).toMatchObject({
      id: inbound.id,
      senderType: 'CUSTOMER',
      transport: { externalMessageId: externalInboundId },
    });
    expect(detail?.messages[1]).toMatchObject({
      id: outbound.id,
      senderType: 'AI',
      transport: {
        externalMessageId: send.externalMessageId,
        deliveryStatus: 'SENT',
      },
    });
    expect(detail?.lastActivityAt).toBeTruthy();
  });

  it('supports takeover, manual WhatsApp replies, pause, and a clean return to AI', async () => {
    const { conversation, phone } = await createConversation(fixtureA);
    const service = createTenantConversationInboxService(fixtureA.tenant);
    const taken = await service.setMode(conversation.id, 'HUMAN');
    expect(taken).toMatchObject({
      mode: 'HUMAN',
      handoffReason: 'MANUAL',
      assignment: { membershipId: fixtureA.membershipId },
    });

    const manual = await service.sendManualReply(
      conversation.id,
      'A staff member is helping you now.',
      {
        sendText: input => sendWhatsAppText(input, { transport: acceptedTransport }),
      },
    );
    expect(manual.message).toMatchObject({
      senderType: 'HUMAN',
      direction: 'OUTBOUND',
      sentBy: { membershipId: fixtureA.membershipId },
      transport: { deliveryStatus: 'SENT' },
    });
    expect(manual.outbound.accepted).toBe(true);
    expect(await prisma.whatsAppMessage.findFirst({
      where: {
        businessId: fixtureA.businessId,
        conversationMessageId: manual.message.id,
        recipientPhone: phone,
      },
    })).not.toBeNull();

    const paused = await service.setMode(conversation.id, 'PAUSED');
    expect(paused).toMatchObject({
      mode: 'PAUSED',
      handoffReason: null,
      assignment: null,
    });
    const returned = await service.setMode(conversation.id, 'AI');
    expect(returned).toMatchObject({
      mode: 'AI',
      handoffReason: null,
      assignment: null,
    });
  });

  it('persists failed human send attempts instead of losing history', async () => {
    const { conversation } = await createConversation(fixtureA);
    const service = createTenantConversationInboxService(fixtureA.tenant);
    await service.setMode(conversation.id, 'HUMAN');

    await expect(service.sendManualReply(
      conversation.id,
      'This send will fail safely.',
      {
        sendText: input => sendWhatsAppText(input, {
          transport: {
            sendText: async () => {
              throw new WhatsAppSendError({
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Meta unavailable',
                retryable: true,
              });
            },
          },
        }),
      },
    )).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const detail = await service.getById(conversation.id);
    expect(detail?.messages.at(-1)).toMatchObject({
      senderType: 'HUMAN',
      content: 'This send will fail safely.',
      transport: { deliveryStatus: 'FAILED' },
    });
  });

  it('orders takeover after an already-reserved AI transport attempt', async () => {
    const { conversation } = await createConversation(fixtureA);
    const repository = createTenantConversationRepository({
      businessId: fixtureA.businessId,
    });
    const committed = await repository.commitAutomatedReply({
      conversationId: conversation.id,
      expectedControlVersion: conversation.controlVersion,
      content: 'This reply has already been reserved for delivery.',
      pendingActions: [],
      handoffReason: null,
    });
    if (!committed) throw new Error('Expected the AI reply to be reserved.');
    const service = createTenantConversationInboxService(fixtureA.tenant);

    await expect(service.setMode(conversation.id, 'HUMAN')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'An outbound reply is still being sent. Reload and try again.',
    });
    await expect(repository.findById(conversation.id)).resolves.toMatchObject({
      mode: 'AI',
      controlVersion: conversation.controlVersion + 1,
    });

    await markOutgoingWhatsAppMessageSent(
      fixtureA.whatsappTenant,
      committed.transportMessageId,
      `wamid.out.${randomUUID()}`,
    );
    await expect(service.setMode(conversation.id, 'HUMAN')).resolves.toMatchObject({
      mode: 'HUMAN',
      handoffReason: 'MANUAL',
    });
  });

  it('orders tenant inbox results by activity and exposes persisted attention state', async () => {
    const older = await createConversation(fixtureA);
    const newer = await createConversation(fixtureA);
    const foreign = await createConversation(fixtureB);
    await prisma.conversation.update({
      where: { id: older.conversation.id },
      data: { lastActivityAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await prisma.conversation.update({
      where: { id: newer.conversation.id },
      data: { lastActivityAt: new Date('2026-01-02T00:00:00.000Z') },
    });
    await createTenantConversationInboxService(fixtureA.tenant)
      .setMode(newer.conversation.id, 'HUMAN');

    const list = await createTenantConversationInboxService(fixtureA.tenant).list();
    const relevant = list.filter(item =>
      [older.conversation.id, newer.conversation.id].includes(item.id));
    expect(relevant.map(item => item.id)).toEqual([
      newer.conversation.id,
      older.conversation.id,
    ]);
    expect(relevant[0]).toMatchObject({
      attentionRequired: true,
      handoffReason: 'MANUAL',
    });
    expect(list.some(item => item.id === foreign.conversation.id)).toBe(false);
  });

  it('persists application-owned escalation reason and audit history', async () => {
    const { conversation } = await createConversation(fixtureA);
    const repository = createTenantConversationRepository({
      businessId: fixtureA.businessId,
    });
    const committed = await repository.commitAutomatedReply({
      conversationId: conversation.id,
      expectedControlVersion: conversation.controlVersion,
      content: 'I will flag this for a person to review.',
      pendingActions: [],
      handoffReason: 'COMPLAINT',
    });

    expect(committed?.message.senderType).toBe('AI');
    if (!committed) throw new Error('Expected the AI reply to be reserved.');
    await expect(createTenantConversationInboxService(fixtureA.tenant)
      .setMode(conversation.id, 'AI'))
      .rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'An outbound reply is still being sent. Reload and try again.',
      });
    await markOutgoingWhatsAppMessageSent(
      fixtureA.whatsappTenant,
      committed.transportMessageId,
      `wamid.out.${randomUUID()}`,
    );
    await expect(repository.findById(conversation.id)).resolves.toMatchObject({
      mode: 'HUMAN',
      handoffReason: 'COMPLAINT',
    });
    await expect(prisma.auditEvent.findFirst({
      where: {
        businessId: fixtureA.businessId,
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        action: 'MODE_CHANGE',
      },
    })).resolves.toMatchObject({ actorKind: 'SYSTEM' });
  });
});
