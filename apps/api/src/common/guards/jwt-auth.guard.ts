import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../rbac/decorators';
import { RequestContext } from '../tenant/tenant-context';

/**
 * Authenticates org users, super-admins, and OTP-issued record tokens from a Bearer JWT, and
 * populates the request context. @Public routes skip auth. Record tokens (kind='record') carry
 * a single `caseId` and no broad permissions — used by the public inquiry after OTP.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const ctx = (req as any).context as RequestContext;
    ctx.tenantId = payload.tenantId;
    ctx.actorId = payload.sub;

    if (payload.kind === 'record') {
      ctx.actorType = 'INSURED';
      ctx.scopedCaseId = payload.caseId;
      ctx.scopedClaimId = payload.claimId;
      ctx.permissions = ['case:read'];
    } else if (payload.kind === 'customer') {
      ctx.actorType = 'CUSTOMER';
      ctx.customerNidHash = payload.nidHash;
      ctx.permissions = ['case:read'];
    } else if (payload.kind === 'super') {
      ctx.actorType = 'SUPER_ADMIN';
      ctx.permissions = payload.permissions ?? [];
    } else {
      ctx.actorType = 'ORG_USER';
      ctx.permissions = payload.permissions ?? [];
      ctx.branchId = payload.branchId ?? undefined;
      // Branch-bound users without an org-wide scope see only their branch.
      ctx.branchScoped = !!payload.branchId && !(payload.permissions ?? []).includes('branch:manage');
    }
    return true;
  }
}
