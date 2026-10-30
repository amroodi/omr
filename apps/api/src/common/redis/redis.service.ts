import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis-protocol connection — Valkey (recommended, the open-source Redis fork) or Redis; both
 * speak the same protocol. OFF unless `REDIS_URL` is set (e.g. redis://127.0.0.1:6379/0, or
 * rediss://… for TLS). Every user falls back to its non-Redis path when this returns null or the
 * server is unreachable, so the API keeps working on a server without Redis.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis | null;
  private warned = false;

  constructor(config: ConfigService) {
    const url = String(config.get('REDIS_URL', '') ?? '').trim();
    this.redis = url
      ? new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000 })
      : null;
    this.redis?.on('error', (e) => {
      if (!this.warned) { this.logger.error(`Redis unavailable (${String(e)}); falling back where possible`); this.warned = true; }
    });
    this.redis?.on('ready', () => { this.warned = false; this.logger.log('Redis connected'); });
  }

  /** The client when configured and connected, else null (callers use their fallback). */
  client(): Redis | null {
    return this.redis && this.redis.status === 'ready' ? this.redis : null;
  }

  get configured(): boolean {
    return !!this.redis;
  }

  /** For /health: 'off' (not configured), 'up' or 'down'. */
  async status(): Promise<'off' | 'up' | 'down'> {
    if (!this.redis) return 'off';
    try { return (await this.redis.ping()) === 'PONG' ? 'up' : 'down'; } catch { return 'down'; }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
