import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter keyed by arbitrary strings (IP, National-ID hash, etc.).
 *
 * Shared across every API process: the counters live in Postgres (`RateLimitBucket`, an UNLOGGED
 * table — fast, and limits need not survive a database crash), updated by one atomic upsert per hit.
 * So the limits hold when the API runs on several CPU cores or servers. `RATE_LIMIT_STORE=memory`
 * keeps them in this process only (tests / a single dev process); if the database can't be reached
 * a hit falls back to the in-memory counters rather than failing the request.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private buckets = new Map<string, Bucket>();
  private readonly useDb: boolean;
  private readonly timer: NodeJS.Timeout;

  constructor(@Optional() private readonly prisma?: PrismaService, @Optional() config?: ConfigService) {
    this.useDb = !!prisma && String(config?.get('RATE_LIMIT_STORE', 'db') ?? 'db').toLowerCase() !== 'memory';
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
