import { ApplicationError } from './errors';

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maximumKeys = 10_000) {}
  clear(): void { this.windows.clear(); }
  consume(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && this.windows.size >= this.maximumKeys) {
        for (const [id, value] of this.windows) if (value.resetAt <= now) this.windows.delete(id);
        if (this.windows.size >= this.maximumKeys) return false;
      }
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  }
}

// Single-process deployment. No untrusted proxy header is used as identity.
export const applicationRateLimiter = new FixedWindowLimiter();
export const enforceRateLimit = (key: string, limit: number, windowMs = 60_000): void => {
  if (!applicationRateLimiter.consume(key, limit, windowMs)) throw new ApplicationError({
    code: 'RATE_LIMITED', status: 429, message: 'Too many requests. Try again shortly.',
  });
};
