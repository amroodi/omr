import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const IS_PUBLIC_KEY = 'isPublic';
/** Mark a route as reachable without an authenticated org/admin session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Require the caller's role to hold all listed permissions. */
export const Permissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);

export const SUPER_ADMIN_KEY = 'superAdminOnly';
/** Restrict a route to platform super-admins. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);

/** Inject the current request context (actor, tenant, permissions). */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.context;
});
