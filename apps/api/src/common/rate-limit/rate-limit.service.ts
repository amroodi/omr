import { Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple fixed-window rate limiter keyed by arbitrary strings (IP, National-ID hash, etc.).
 *
 * In-memory only — fine for a single instance and for tests. For multi-instance production,
 * back this with Redis (INCR + EXPIRE) behind the same interface; call sites do not change.
 */
@Injectable()
export class RateLimitService {
  private buckets = new Map<string, Bucket>();

  constructor() {
    // Evict expired buckets periodically to bound memory.
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  /**
   * Returns true if the action is allowed, false if the limit is exceeded.
   * @param key    unique bucket key (namespace your keys, e.g. `otp:ip:1.2.3.4`)
   * @param limit  max actions per window
   * @param windowSeconds window length
   */
  hit(key: string, limit: number, windowSeconds: number): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (b.count >= limit) return false;
    b.count += 1;
    return true;
  }

  /** Seconds until the given key's window resets (0 if none). */
  retryAfter(key: string): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
