import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../src/http/request-context';

describe('resolveRequestId', () => {
  it('preserves a safe caller correlation ID', () => {
    expect(resolveRequestId('request-abc_123')).toBe('request-abc_123');
  });

  it('replaces an unsafe correlation ID', () => {
    expect(resolveRequestId('contains spaces and unsafe data')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
