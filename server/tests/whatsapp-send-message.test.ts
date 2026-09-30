import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMetaWhatsAppTransport } from '../src/whatsapp/meta-whatsapp-transport';
import { sendWhatsAppText } from '../src/whatsapp/whatsapp-send.service';
import {
  WhatsAppSendError,
  type WhatsAppTextTransport,
} from '../src/whatsapp/whatsapp-send.types';

const accessToken = 'fake-meta-access-token-for-tests-only';
const apiVersion = 'v25.0';

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Meta WhatsApp text transport', () => {
  it('sends the official text shape and returns an application-owned result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: '212600000001', wa_id: '212600000001' }],
      messages: [{ id: 'wamid.outbound-1' }],
    }));
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      fetch: fetchMock as typeof fetch,
    });

    const result = await transport.sendText({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'WhatsApp integration test',
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://graph.facebook.com/v25.0/111111111111111/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '212600000001',
          type: 'text',
          text: { body: 'WhatsApp integration test' },
        }),
      }),
    );
    expect(result).toEqual({
      provider: 'WHATSAPP',
      accepted: true,
      externalMessageId: 'wamid.outbound-1',
    });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it('sends an approved template reference with positional body parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      messages: [{ id: 'wamid.template-1' }],
    }));
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      fetch: fetchMock as typeof fetch,
    });

    await transport.sendTemplate({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      template: {
        name: 'customer_return_offer',
        languageCode: 'en',
        bodyParameters: ['Atlas Cars'],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/111111111111111/messages',
      expect.objectContaining({
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '212600000001',
          type: 'template',
          template: {
            name: 'customer_return_offer',
            language: { code: 'en' },
            components: [{
              type: 'body',
              parameters: [{ type: 'text', text: 'Atlas Cars' }],
            }],
          },
        }),
      }),
    );
  });

  it.each([
    [400, 'INVALID_REQUEST', false],
    [401, 'AUTHENTICATION', false],
    [403, 'AUTHENTICATION', false],
    [429, 'RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true],
  ] as const)('maps Meta status %i to %s', async (status, code, retryable) => {
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      fetch: vi.fn().mockResolvedValue(response(status, {
        error: { message: `provider payload containing ${accessToken}` },
      })) as typeof fetch,
    });

    const promise = transport.sendText({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'Test',
    });

    await expect(promise).rejects.toMatchObject({ code, retryable });
    await promise.catch(error => {
      expect(JSON.stringify(error)).not.toContain(accessToken);
    });
  });

  it('maps network failures without exposing the credential', async () => {
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      fetch: vi.fn().mockRejectedValue(new Error(`network ${accessToken}`)) as typeof fetch,
    });

    const error = await transport.sendText({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'Test',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(JSON.stringify(error)).not.toContain(accessToken);
  });

  it('classifies malformed successful provider responses without treating them as network failures', async () => {
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      fetch: vi.fn().mockResolvedValue(new Response('not-json', {
        status: 200,
      })) as typeof fetch,
    });

    await expect(transport.sendText({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'Test',
    })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      retryable: false,
      providerStatus: 200,
    });
  });

  it('aborts and classifies a hung request as a timeout', async () => {
    const fetchMock = vi.fn((_url: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }));
    const transport = createMetaWhatsAppTransport({
      accessToken,
      apiVersion,
      timeoutMs: 5,
      fetch: fetchMock as typeof fetch,
    });

    await expect(transport.sendText({
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'Test',
    })).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
});

describe('WhatsApp send-message application service', () => {
  it('uses the trusted tenant connection and keeps provider details behind the transport', async () => {
    const businessA = randomUUID();
    const businessB = randomUUID();
    const connectionA = randomUUID();
    const connectionB = randomUUID();
    const sendText = vi.fn().mockResolvedValue({
      provider: 'WHATSAPP',
      accepted: true,
      externalMessageId: 'wamid.application-result',
    });
    const transport: WhatsAppTextTransport = { sendText };
    const connections = new Map<string, {
      id: string;
      businessId: string;
      phoneNumberId: string;
    }>([
      [connectionA, { id: connectionA, businessId: businessA, phoneNumberId: '111111111111111' }],
      [connectionB, { id: connectionB, businessId: businessB, phoneNumberId: '222222222222222' }],
    ]);
    const findConnection = vi.fn(async (tenant: {
      businessId: string;
      whatsappConnectionId: string;
    }) => {
      const connection = connections.get(tenant.whatsappConnectionId) ?? null;
      return connection?.businessId === tenant.businessId ? connection : null;
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const customer = {
      id: randomUUID(),
      businessId: businessA,
      whatsappPhone: '212600000001',
    };
    const resolveCustomer = vi.fn(async (tenant: { businessId: string }, phone: string) => ({
      ...customer,
      id: randomUUID(),
      businessId: tenant.businessId,
      whatsappPhone: phone,
    }));
    const createPendingMessage = vi.fn().mockResolvedValue({ id: randomUUID() });
    const markMessageSent = vi.fn().mockResolvedValue(undefined);

    await sendWhatsAppText({
      tenant: { businessId: businessA, whatsappConnectionId: connectionA },
      to: '212600000001',
      text: 'Business A reply',
    }, {
      findConnection,
      transport,
      logger,
      resolveCustomer,
      createPendingMessage,
      markMessageSent,
    });
    await sendWhatsAppText({
      tenant: { businessId: businessB, whatsappConnectionId: connectionB },
      to: '212600000002',
      text: 'Business B reply',
    }, {
      findConnection,
      transport,
      logger,
      resolveCustomer,
      createPendingMessage,
      markMessageSent,
    });

    expect(sendText).toHaveBeenNthCalledWith(1, {
      phoneNumberId: '111111111111111',
      to: '212600000001',
      text: 'Business A reply',
    });
    expect(sendText).toHaveBeenNthCalledWith(2, {
      phoneNumberId: '222222222222222',
      to: '212600000002',
      text: 'Business B reply',
    });
    expect(createPendingMessage).toHaveBeenCalledTimes(2);
    expect(markMessageSent).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the trusted connection does not belong to the tenant', async () => {
    const transport = { sendText: vi.fn() };

    await expect(sendWhatsAppText({
      tenant: { businessId: randomUUID(), whatsappConnectionId: randomUUID() },
      to: '212600000001',
      text: 'Do not send',
    }, {
      findConnection: vi.fn().mockResolvedValue(null),
      transport,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
      retryable: false,
    });
    expect(transport.sendText).not.toHaveBeenCalled();
  });

  it('sends an existing tenant-bound PENDING reservation without creating another row', async () => {
    const tenant = {
      businessId: randomUUID(),
      whatsappConnectionId: randomUUID(),
    };
    const pendingMessageId = randomUUID();
    const resolveCustomer = vi.fn();
    const createPendingMessage = vi.fn();
    const markMessageSent = vi.fn().mockResolvedValue(undefined);

    await expect(sendWhatsAppText({
      tenant,
      to: '212600000001',
      text: 'Reserved reply',
      reservedTransportMessageId: pendingMessageId,
    }, {
      findConnection: vi.fn().mockResolvedValue({
        id: tenant.whatsappConnectionId,
        businessId: tenant.businessId,
        phoneNumberId: '111111111111111',
      }),
      findPendingMessage: vi.fn().mockResolvedValue({ id: pendingMessageId }),
      resolveCustomer,
      createPendingMessage,
      markMessageSent,
      transport: { sendText: vi.fn().mockResolvedValue({
        provider: 'WHATSAPP',
        accepted: true,
        externalMessageId: 'wamid.reserved',
      }) },
      logger: { info: vi.fn(), warn: vi.fn() },
    })).resolves.toMatchObject({
      externalMessageId: 'wamid.reserved',
      transportMessageId: pendingMessageId,
    });

    expect(resolveCustomer).not.toHaveBeenCalled();
    expect(createPendingMessage).not.toHaveBeenCalled();
    expect(markMessageSent).toHaveBeenCalledWith(
      tenant,
      pendingMessageId,
      'wamid.reserved',
    );
  });

  it('persists a safe failed state when the provider rejects a pending send', async () => {
    const tenant = {
      businessId: randomUUID(),
      whatsappConnectionId: randomUUID(),
    };
    const pendingMessageId = randomUUID();
    const markMessageFailed = vi.fn().mockResolvedValue(undefined);
    const providerError = new WhatsAppSendError({
      code: 'RATE_LIMITED',
      message: 'Meta rate-limited the WhatsApp send request.',
      retryable: true,
      providerStatus: 429,
    });

    await expect(sendWhatsAppText({
      tenant,
      to: '212600000001',
      text: 'Test',
    }, {
      findConnection: vi.fn().mockResolvedValue({
        id: tenant.whatsappConnectionId,
        businessId: tenant.businessId,
        phoneNumberId: '111111111111111',
      }),
      resolveCustomer: vi.fn().mockResolvedValue({
        id: randomUUID(),
        businessId: tenant.businessId,
        whatsappPhone: '212600000001',
      }),
      createPendingMessage: vi.fn().mockResolvedValue({ id: pendingMessageId }),
      markMessageSent: vi.fn(),
      markMessageFailed,
      transport: { sendText: vi.fn().mockRejectedValue(providerError) },
      logger: { info: vi.fn(), warn: vi.fn() },
    })).rejects.toBe(providerError);

    expect(markMessageFailed).toHaveBeenCalledExactlyOnceWith(
      tenant,
      pendingMessageId,
      {
        code: 'RATE_LIMITED',
        title: 'Meta rate-limited the WhatsApp send request.',
        details: 'Meta HTTP status 429',
      },
    );
  });
});
