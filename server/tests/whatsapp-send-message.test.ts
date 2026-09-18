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

    await sendWhatsAppText({
      tenant: { businessId: businessA, whatsappConnectionId: connectionA },
      to: '212600000001',
      text: 'Business A reply',
    }, { findConnection, transport, logger });
    await sendWhatsAppText({
      tenant: { businessId: businessB, whatsappConnectionId: connectionB },
      to: '212600000002',
      text: 'Business B reply',
    }, { findConnection, transport, logger });

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
});
