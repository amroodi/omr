import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// One atomic round trip: count the hit and start the window on the first one.
const REDIS_HIT = `local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c`;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter keyed by arbitrary strings (IP, National-ID hash, etc.).
 *
 * Shared across every API process, so the limits hold when the API runs on several CPU cores or
 * servers. Where the counters live (`RATE_LIMIT_STORE`):
 *  - `redis` — Redis (one INCR per hit); the default whenever `REDIS_URL` is set;
 *  - `db`    — Postgres (`RateLimitBucket`, an UNLOGGED table, one atomic upsert per hit); the default otherwise;
 *  - `memory` — this process only (tests / a single dev process).
 * If the chosen store can't be reached, a hit falls back to the next one (Redis → Postgres → memory)
 * rather than failing the request.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private buckets = new Map<string, Bucket>();
  private readonly useDb: boolean;
  private readonly useRedis: boolean;
  private readonly timer: NodeJS.Timeout;

  constructor(@Optional() private readonly prisma?: PrismaService, @Optional() config?: ConfigService, @Optional() private readonly redis?: RedisService) {
    const store = String(config?.get('RATE_LIMIT_STORE', '') ?? '').toLowerCase() || (redis?.configured ? 'redis' : 'db');
    this.useRedis = store === 'redis' && !!redis?.configured;
    this.useDb = !!prisma && store !== 'memory';
    // Evict expired buckets periodically to bound memory / table size.
    this.timer = setInterval(() => { this.sweep().catch(() => undefined); }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /**
   * Resolves true if the action is allowed, false if the limit is exceeded.
   * @param key    unique bucket key (namespace your keys, e.g. `otp:ip:1.2.3.4`)
   * @param limit  max actions per window
   * @param windowSeconds window length
   */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const r = this.useRedis ? this.redis!.client() : null;
    if (r) {
      try {
        const n = Number(await r.eval(REDIS_HIT, 1, `rl:${key}`, String(windowSeconds * 1000)));
        return n <= limit;
      } catch (e) {
        this.logger.error(`Redis rate-limit failed, using Postgres: ${String(e)}`);
      }
    }
    if (this.useDb) {
      try {
        const rows = await this.prisma!.$queryRaw<{ count: number }[]>`
          INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
          VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
          ON CONFLICT ("key") DO UPDATE SET
            "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
            "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
          RETURNING "count"`;
        return Number(rows[0]?.count ?? 1) <= limit;
      } catch (e) {
        this.logger.error(`Rate-limit store unavailable, using in-process counters: ${String(e)}`);
      }
    }
    return this.hitMemory(key, limit, windowSeconds);
  }

  private hitMemory(key: string, limit: number, windowSeconds: number): boolean {
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

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    if (this.useDb) await this.prisma!.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" <= now()`;
  }
}
