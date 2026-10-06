import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from './tenant-context';

/**
 * Resolves the tenant for PUBLIC routes (the inquiry flow) from the `x-tenant-slug` header or the
 * request host's subdomain, and sets it in the request context so tenant-scoped queries work
 * without an authenticated session. Authenticated routes get their tenant from the JWT instead.
 */
@Injectable()
export class TenantResolverGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = (req as any).context as RequestContext;

    // Header first (browser fetch), then ?tenant=/?org= (iframe embeds can't set headers),
    // then the host subdomain (per-tenant domains).
    const q = req.query as Record<string, string | undefined>;
    const slug =
      (req.headers['x-tenant-slug'] as string | undefined)?.trim() ||
      (q.tenant || q.org)?.trim() ||
      this.subdomain(req.headers['host'] as string | undefined);

    if (!slug) throw new NotFoundException('Tenant not specified');

    const tenant = await this.prisma
      .unscoped()
      .tenant.findUnique({ where: { slug }, select: { id: true, isActive: true } });

    if (!tenant || !tenant.isActive) throw new NotFoundException('Tenant not found');

    ctx.tenantId = tenant.id;
    ctx.actorType = 'INSURED';
    return true;
  }

  private subdomain(host?: string): string | undefined {
    if (!host) return undefined;
    const name = host.split(':')[0];
    const parts = name.split('.');
    // e.g. damuon.omr.example.com -> "damuon"; ignore bare hosts / localhost
    return parts.length >= 3 ? parts[0] : undefined;
  }
}
