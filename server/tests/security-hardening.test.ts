import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnySpan } from '@mastra/core/observability';
import { readBoundedBody, RequestBodyTooLargeError } from '../src/http/bounded-body';
import { FixedWindowLimiter } from '../src/http/rate-limit';
import { applicationLogger } from '../src/http/logger';
import { currentCorrelation, withCorrelation } from '../src/observability/correlation';
import { createOperationalAlerts } from '../src/observability/operational-alerts';
import { PrivateTraceProcessor } from '../src/observability/private-traces';
import { REDACTED, redactFields, redactText, safeRequestPath } from '../src/observability/redaction';
import { providerError } from '../src/whatsapp/meta-whatsapp-transport';
import { classifySendFailure, MAX_SEND_ATTEMPTS, nextSendAttempt } from '../src/whatsapp/retry-policy';
import { WhatsAppSendError, type WhatsAppSendErrorCode } from '../src/whatsapp/whatsapp-send.types';

const { logLines } = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock('../src/config/env', () => ({ env: {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://fixture:password@localhost/fixture',
  OPENROUTER_API_KEY: 'fixture-openrouter-secret', BETTER_AUTH_SECRET: 'fixture-auth-secret',
  META_WHATSAPP_ACCESS_TOKEN: 'fixture-meta-secret', META_WHATSAPP_APP_SECRET: 'fixture-app-secret',
  META_WHATSAPP_VERIFY_TOKEN: 'fixture-verify-secret',
} }));
vi.mock('@mastra/loggers', async importOriginal => {
  const original = await importOriginal<typeof import('@mastra/loggers')>();
  const { Transform } = await import('node:stream');
  const { createCustomTransport } = await import('@mastra/core/logger');
  return { ...original, PinoLogger: class extends original.PinoLogger {
    constructor(options: import('@mastra/loggers').PinoLoggerOptions) {
      super({ ...options, overrideDefaultTransports: true, transports: {
        default: createCustomTransport(new Transform({ transform(chunk, _encoding, callback) { logLines.push(String(chunk)); callback(); } })),
      } });
    }
  } };
});

afterEach(() => { vi.useRealTimers(); logLines.length = 0; });

it('logs endpoint families without attacker-controlled path or query content', () => {
  expect(safeRequestPath('/dashboard/customers/private-customer/history')).toBe('/dashboard/customers');
  expect(safeRequestPath('/private-customer/secret')).toBe('/unmatched');
  expect(safeRequestPath('/webhooks/whatsapp')).toBe('/webhooks/whatsapp');
  expect(redactFields({ error: { message: 'customer text', responseBody: 'private' } }))
    .toEqual({ error: { message: REDACTED, responseBody: REDACTED } });
});

describe('bounded request bodies and rate limits', () => {
  const streamed = (chunks: string[], length?: string, cancel = vi.fn()) => new Request('https://example.test', {
    method: 'POST', headers: length === undefined ? {} : { 'content-length': length },
    body: new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); },
      cancel,
    }), duplex: 'half',
  } as RequestInit);

  it.each([undefined, '1', '-1', 'not-a-number'])('counts streamed bytes despite Content-Length %s', async length => {
    const cancel = vi.fn();
    await expect(readBoundedBody(streamed(['abc', 'def'], length, cancel), 5)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a declared oversized body before reading and accepts the exact byte limit', async () => {
    const request = new Request('https://example.test', { method: 'POST', body: 'abc', headers: { 'content-length': '999' } });
    const read = vi.spyOn(request.body!, 'getReader');
    await expect(readBoundedBody(request, 3)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(read).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(await readBoundedBody(new Request('https://example.test', { method: 'POST', body: 'é' }), 2))).toBe('é');
    expect(await readBoundedBody(new Request('https://example.test'))).toEqual(new Uint8Array());
  });

  it('isolates identities, expires windows and bounds attacker-controlled key growth', () => {
    const limiter = new FixedWindowLimiter(2);
    expect(limiter.consume('a', 2, 100, 0)).toBe(true);
    expect(limiter.consume('a', 2, 100, 1)).toBe(true);
    expect(limiter.consume('a', 2, 100, 2)).toBe(false);
    expect(limiter.consume('b', 1, 100, 2)).toBe(true);
    for (let i = 0; i < 50; i++) expect(limiter.consume(`attacker-${i}`, 1, 100, 3)).toBe(false);
    expect(limiter.consume('a', 2, 100, 100)).toBe(true);
    expect(limiter.consume('new', 1, 100, 102)).toBe(true);
    expect(limiter.consume('another', 1, 100, 103)).toBe(false);
  });
});

describe('provider classification and bounded retries', () => {
  it.each([
    [400, 190, 'AUTHENTICATION', false, 'AUTH_CONFIGURATION'],
    [400, 130429, 'RATE_LIMITED', true, 'RATE_LIMIT'],
    [400, 132001, 'INVALID_REQUEST', false, 'PERMANENT'],
    [400, 131026, 'INVALID_REQUEST', false, 'PERMANENT'],
    [503, 131016, 'PROVIDER_UNAVAILABLE', true, 'TRANSIENT'],
    [500, undefined, 'INVALID_RESPONSE', false, 'AMBIGUOUS'],
    [502, 999999, 'INVALID_RESPONSE', false, 'AMBIGUOUS'],
  ] as const)('classifies HTTP %s Graph %s without provider content', (status, graphCode, code, retryable, category) => {
    const error = providerError(status, { error: { code: graphCode, message: 'private-provider-response' } });
    expect(error).toMatchObject({ code, retryable, providerStatus: status });
    expect(classifySendFailure(error)).toBe(category);
    expect(JSON.stringify(error)).not.toContain('private-provider-response');
  });

  it('honors Retry-After, exponential delay, and the three-attempt cap', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    vi.useFakeTimers(); vi.setSystemTime(now);
    const transient = providerError(503, { error: { code: 131016 } });
    expect(nextSendAttempt(transient, 1, now)?.getTime()).toBe(now.getTime() + 120_000);
    expect(nextSendAttempt(transient, 2, now)?.getTime()).toBe(now.getTime() + 240_000);
    expect(MAX_SEND_ATTEMPTS).toBe(3);
    expect(nextSendAttempt(transient, 3, now)).toBeNull();
    expect(nextSendAttempt(transient, 0, now)).toBeNull();
    const rate = providerError(429, {}, '600');
    expect(nextSendAttempt(rate, 1, now)?.getTime()).toBe(now.getTime() + 600_000);
    expect(providerError(429, {}, new Date(now.getTime() + 900_000).toUTCString()).retryAfterMs).toBe(900_000);
    expect(providerError(429, {}, '999999999').retryAfterMs).toBe(86_400_000);
    expect(providerError(429, {}, 'bad-date').retryAfterMs).toBeUndefined();
  });

  it.each(['NETWORK', 'TIMEOUT', 'INVALID_RESPONSE', 'AUTHENTICATION', 'CONFIGURATION', 'INVALID_REQUEST'] as WhatsAppSendErrorCode[])(
    'does not retry %s even if a caller marks it retryable', code => {
      expect(nextSendAttempt(new WhatsAppSendError({ code, message: 'failure', retryable: true }), 1, new Date())).toBeNull();
    },
  );
  it('does not retry unknown errors or explicitly permanent provider errors', () => {
    expect(classifySendFailure(new Error('unknown'))).toBe('AMBIGUOUS');
    expect(nextSendAttempt(new Error('unknown'), 1, new Date())).toBeNull();
    expect(nextSendAttempt(new WhatsAppSendError({ code: 'PROVIDER_UNAVAILABLE', message: 'failure', retryable: false }), 1, new Date())).toBeNull();
  });
});

describe('private logs, traces, and correlated operational alerts', () => {
  it('redacts nested errors, normalized credential keys, configured secrets and keyed PII', () => {
    const fields = redactFields({ businessId: 'business-a', nested: {
      'access_token': 'credential', customerPhone: '212600000001', customerName: 'Private Name',
      email: 'private@example.test', requestContext: { tenant: 'private' },
      err: new Error('credential private@example.test'), notes: 'contains custom-credential',
    } }, ['custom-credential']);
    expect(fields).toEqual({ businessId: 'business-a', nested: {
      access_token: REDACTED, customerPhone: REDACTED, customerName: REDACTED,
      email: REDACTED, requestContext: REDACTED,
      err: { name: 'Error', message: '[Error details suppressed]' }, notes: `contains ${REDACTED}`,
    } });
    expect(redactText('Bearer hidden https://host.test/private postgresql://name:pass@host/db')).not.toMatch(/hidden|host|pass/);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(redactFields(circular)).toEqual({ self: '[Circular]' });
  });

  it('redacts emitted application logger records while retaining safe correlation', () => {
    withCorrelation({ businessId: 'business-a', requestId: 'request-a' }, () => {
      applicationLogger.error('Failure fixture-meta-secret', {
        phone: '212600000001', nested: { authorization: 'Bearer private', error: new Error('private provider response') },
        messageId: 'message-a',
      });
    });
    expect(logLines).toHaveLength(1);
    const emitted = JSON.parse(logLines[0]);
    expect(emitted).toMatchObject({ businessId: 'business-a', requestId: 'request-a', messageId: 'message-a', phone: REDACTED });
    expect(logLines.join('')).not.toMatch(/fixture-meta-secret|212600000001|Bearer private|private provider response/);
  });

  it('keeps child logger messages and bindings inside the same redaction boundary', () => {
    applicationLogger.child({ token: 'private-token', businessId: 'business-a' })
      .error('Failure fixture-meta-secret', { cookie: 'private-cookie' });
    expect(logLines.join('')).not.toMatch(/fixture-meta-secret|private-token|private-cookie/);
    expect(JSON.parse(logLines[0])).toMatchObject({ businessId: 'business-a', token: REDACTED, cookie: REDACTED });
  });

  it.each(['agent', 'model', 'tool'])('strips private payloads from %s spans', kind => {
    const span = {
      type: kind, input: 'private-input', output: 'private-output', requestContext: { tenant: 'private-context' },
      metadata: { businessId: 'business-a', requestId: 'request-a', customerPhone: '212600000001', requestContext: { secret: 'private' } },
      attributes: { model: 'openrouter/free', inputTokens: 10, prompt: 'private-prompt', output: 'private-output' },
      errorInfo: { message: 'private-error', stack: 'private-stack' },
    } as unknown as AnySpan;
    const result = new PrivateTraceProcessor().process(span);
    expect(result.input).toBeUndefined(); expect(result.output).toBeUndefined(); expect(result.requestContext).toBeUndefined();
    expect(result.metadata).toEqual({ businessId: 'business-a', requestId: 'request-a' });
    expect(result.attributes).toEqual({ model: 'openrouter/free', inputTokens: 10 });
    expect(JSON.stringify(result)).not.toMatch(/private-|212600000001/);
  });

  it('isolates concurrent request correlation and restores nested context', async () => {
    const results = await Promise.all(['a', 'b'].map(businessId => withCorrelation({ businessId }, async () => {
      await Promise.resolve();
      expect(currentCorrelation()).toEqual({ businessId });
      withCorrelation({ requestId: `request-${businessId}` }, () => expect(currentCorrelation()).toEqual({ businessId, requestId: `request-${businessId}` }));
      return currentCorrelation();
    })));
    expect(results).toEqual([{ businessId: 'a' }, { businessId: 'b' }]);
    expect(currentCorrelation()).toEqual({});
  });

  it('applies alert thresholds, tenant isolation, and one alert per five-minute window', () => {
    const deliver = vi.fn(); const alert = createOperationalAlerts(deliver);
    for (let n = 0; n < 4; n++) alert('AI_FAILURE', { businessId: 'a' }, 0);
    expect(deliver).not.toHaveBeenCalled();
    alert('AI_FAILURE', { businessId: 'b' }, 0);
    alert('AI_FAILURE', { businessId: 'a' }, 1);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'AI_FAILURE', count: 5, businessId: 'a' }));
    alert('AI_FAILURE', { businessId: 'a' }, 100);
    expect(deliver).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 5; n++) alert('AI_FAILURE', { businessId: 'a' }, 300_000);
    expect(deliver).toHaveBeenCalledTimes(2);
    alert('META_AUTH', {}, 0); alert('DATABASE_UNAVAILABLE', {}, 0); alert('STALE_ATTEMPT', {}, 0);
    expect(deliver).toHaveBeenCalledTimes(5);
    for (let n = 0; n < 19; n++) alert('WEBHOOK_SIGNATURE', {}, 0);
    expect(deliver).toHaveBeenCalledTimes(5);
    alert('WEBHOOK_SIGNATURE', {}, 0);
    expect(deliver).toHaveBeenCalledTimes(6);
  });
});
