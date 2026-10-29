import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/rbac/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Liveness / readiness for uptime monitoring and the load balancer: 200 when this API process can
 * reach the database, 503 otherwise. Says nothing about versions or configuration.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const t = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
    return { ok: true, db: 'up', dbMs: Date.now() - t };
  }
}
