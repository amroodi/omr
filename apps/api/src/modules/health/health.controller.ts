import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/rbac/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

/**
 * Liveness / readiness for uptime monitoring and the load balancer: 200 when this API process can
 * reach the database, 503 otherwise. Also reports Redis and the read-replica ("off" when not
 * configured); those don't fail the check — the API falls back without them. Says nothing about
 * versions or configuration.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Public()
  @Get()
  async check() {
    const t = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
    const dbMs = Date.now() - t;
    const [redis, replica] = await Promise.all([this.redis.status(), this.prisma.replicaStatus()]);
    return { ok: true, db: 'up', dbMs, redis, replica };
  }
}
