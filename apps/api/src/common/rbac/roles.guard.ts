import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { RequestContext } from '../tenant/tenant-context';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, BROKER_PANEL_KEY, SUPER_ADMIN_KEY, ENTRY_KEY, REALMS_KEY, RealmKind } from './decorators';
import type { Permission } from './permissions';

/** The kind of sign-in behind the request (see @Realms). */
export function realmOf(ctx: RequestContext): RealmKind | 'API' | 'NONE' {
  switch (ctx.actorType) {
    case 'ORG_USER': return 'ORG';
    case 'SUPER_ADMIN': return 'SUPER';
    case 'CUSTOMER': return 'CUSTOMER';
    case 'INSURED': return ctx.insuredPhoneHash ? 'INSURED' : 'RECORD';
    case 'API': return 'API';
    default: return 'NONE';
  }
}

/**
 * Enforces @Realms(), @Permissions() and @SuperAdminOnly() against the request context populated by
 * JwtAuthGuard. Runs after it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = (req as any).context as RequestContext;

    // @Realms(): only these kinds of sign-in (a بیمه‌گزار route isn't a door for staff, nor the inquiry's code).
    const realms = this.reflector.getAllAndOverride<RealmKind[]>(REALMS_KEY, [context.getHandler(), context.getClass()]);
    if (realms?.length && !(realms as string[]).includes(realmOf(ctx))) {
      throw new ForbiddenException('این بخش برای این نوع ورود نیست');
    }

    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (superOnly && ctx.actorType !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super-admin only');
    }

    const brokerOnly = this.reflector.getAllAndOverride<boolean>(BROKER_PANEL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (brokerOnly && ctx.actorType === 'ORG_USER' && ctx.panel !== 'BROKER') {
      throw new ForbiddenException('این بخش فقط در پنل کارگزاری در دسترس است');
    }

    // Only panel 1 creates cases; only panel 2 processes them (see EntryOnly / EntryAllowed).
    if (ctx.actorType === 'ORG_USER' && !ctx.assistBy) { // level 5 (Super Admin) may create and process anywhere
      const entry = this.reflector.getAllAndOverride<'only' | 'allowed' | undefined>(ENTRY_KEY, [context.getHandler(), context.getClass()]);
      if (ctx.panelMode === 'ENTRY') {
        const open = entry || req.method === 'GET' || req.method === 'HEAD' || /\/(auth|security)\//.test(req.path);
        if (!open) throw new ForbiddenException({ statusCode: 403, code: 'ENTRY_PANEL', message: 'در پنل ورود داده فقط ثبت پرونده و بارگذاری مدارک ممکن است؛ رسیدگی از «ورود برای ارزیابی پرونده‌ها» انجام می‌شود.' });
      } else if (entry === 'only') {
        throw new ForbiddenException({ statusCode: 403, code: 'PROCESS_PANEL', message: 'ثبت پرونده فقط از «ورود برای بارگذاری مدارک» در صفحهٔ اصلی ممکن است.' });
      }
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    // @Permissions() are the ORG-USER trust domain only. Customer, record (inquiry) and API tokens
    // are issued with narrow permission sets that can overlap org permission strings (e.g.
    // 'case:read'); without this check such a token could reach org endpoints gated by that string
    // and read tenant-wide data. Those non-org callers use actorType-scoped routes, never @Permissions.
    if (ctx.actorType !== 'ORG_USER') {
      throw new ForbiddenException('این دسترسی مخصوص کاربران سازمان است');
    }

    const held = new Set(ctx.permissions ?? []);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
