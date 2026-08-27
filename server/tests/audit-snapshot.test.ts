import { describe, expect, it } from 'vitest';
import { createSafeAuditSnapshot } from '../src/audit/audit-snapshot';

describe('audit snapshot serialization', () => {
  it('redacts secret-shaped keys recursively', () => {
    expect(
      createSafeAuditSnapshot({
        price: 450,
        apiKey: 'fake-secret-value',
        nested: { password: 'fake-password', available: true },
      }),
    ).toEqual({
      price: 450,
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]', available: true },
    });
  });
});
