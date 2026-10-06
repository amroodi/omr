import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service';
import { RequestContext } from '../tenant/tenant-context';

export const API_SCOPES_KEY = 'requiredApiScopes';
/** Require a server-to-server API key (x-api-key) holding all listed scopes. Combine with @Public(). */
export const RequireApiScopes = (...scopes: string[]) => SetMetadata(API_SCOPES_KEY, scopes);

/**
 * Authenticates a server-to-server request by `x-api-key`, resolves its tenant + scopes into the
 * request context, and enforces the scopes declared with @RequireApiScopes. Mark the route @Public
 * so the JWT guard steps aside; this guard is the authentication for partner endpoints.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];

    const req = context.switchToHttp().getRequest<Request>();
    const raw = (req.headers['x-api-key'] as string | undefined)?.trim();
    if (!raw) throw new UnauthorizedException('کلید API ارائه نشده است');

    const result = await this.apiKeys.verify(raw);
    if (!result) throw new UnauthorizedException('کلید API نامعتبر یا منقضی شده است');

    const missing = required.filter((s) => !result.scopes.includes(s));
    if (missing.length) throw new ForbiddenException(`کلید API فاقد دسترسی لازم است: ${missing.join(', ')}`);

    const ctx = (req as any).context as RequestContext;
    ctx.tenantId = result.tenantId;
    ctx.actorType = 'API';
    ctx.actorId = result.id;
    ctx.apiScopes = result.scopes;
    ctx.permissions = [];
    return true;
  }
}
