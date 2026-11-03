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

export const BROKER_PANEL_KEY = 'brokerPanelOnly';
/** Only in the کارگزاری panel: refused for an insurer's شعبه / ستاد / شورای فنی sign-ins, whatever their role. */
export const BrokerPanelOnly = () => SetMetadata(BROKER_PANEL_KEY, true);

/**
 * Panel 1 (data entry) vs panel 2 (process). An org sign-in is one or the other (`mode` on the token):
 * - `@EntryOnly()` — creating cases (filing, ورود دسته‌ای, میز کار مستقل): refused on panel 2.
 * - `@EntryAllowed()` — a write both panels may make (a document upload, an Excel download).
 * On panel 1 every other write is refused (default deny); reads are open to both.
 */
export const ENTRY_KEY = 'entryPanel';
export const EntryOnly = () => SetMetadata(ENTRY_KEY, 'only');
export const EntryAllowed = () => SetMetadata(ENTRY_KEY, 'allowed');

/** Inject the current request context (actor, tenant, permissions). */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.context;
});
