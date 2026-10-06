import { Controller, Get, NotFoundException, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../../common/rbac/decorators';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { EmbedService } from './embed.service';

@Controller('embed')
export class EmbedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embed: EmbedService,
  ) {}

  /**
   * The embeddable inquiry widget. Served with a per-tenant CSP `frame-ancestors` allowlist so only
   * the organization's own approved domains can frame it; X-Frame-Options is cleared because it
   * cannot express an allowlist. Tenant resolved from ?org=<slug> / x-tenant-slug / subdomain.
   */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('inquiry')
  async inquiry(@Res() res: Response): Promise<void> {
    const tenantId = getTenantIdOrThrow();
    const tenant = await this.prisma.unscoped().tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, name: true, primaryColor: true, embedOrigins: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const ancestors = this.frameAncestors(tenant.embedOrigins);
    const csp = [
      "default-src 'none'",
      "connect-src 'self'",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      "img-src 'self' data:",
      ancestors,
    ].join('; ');

    res.removeHeader('X-Frame-Options'); // helmet sets SAMEORIGIN; frame-ancestors governs instead
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(this.embed.render({ slug: tenant.slug, name: tenant.name, primaryColor: tenant.primaryColor }));
  }

  /** Build `frame-ancestors 'self' <approved https origins>`, ignoring anything malformed. */
  private frameAncestors(origins: string[]): string {
    const safe = (origins ?? []).filter((o) => /^https?:\/\/[a-zA-Z0-9.:-]+$/.test(o));
    return `frame-ancestors 'self' ${safe.join(' ')}`.trim();
  }
}
