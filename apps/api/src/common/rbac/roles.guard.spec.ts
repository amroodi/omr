import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ENTRY_KEY, PERMISSIONS_KEY } from './decorators';

/** Panel 1 creates cases, panel 2 processes them: the guard enforces both directions. */
describe('RolesGuard — panel 1 / panel 2', () => {
  const run = (opts: { mode?: 'ENTRY' | 'PROCESS'; entry?: 'only' | 'allowed'; method?: string; path?: string; actorType?: string }) => {
    const meta: Record<string, unknown> = { [ENTRY_KEY]: opts.entry, [PERMISSIONS_KEY]: ['claim:read'] };
    const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
    const req = { method: opts.method ?? 'POST', path: opts.path ?? '/api/v1/claims/x/action', context: { actorType: opts.actorType ?? 'ORG_USER', panelMode: opts.mode ?? 'PROCESS', permissions: ['claim:read'] } };
    const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any;
    return () => new RolesGuard(reflector).canActivate(ctx);
  };

  it('refuses creating a case on panel 2', () => {
    expect(run({ mode: 'PROCESS', entry: 'only' })).toThrow(ForbiddenException);
  });
  it('allows creating a case on panel 1', () => {
    expect(run({ mode: 'ENTRY', entry: 'only' })()).toBe(true);
  });
  it('refuses a process write on panel 1 (default deny)', () => {
    expect(run({ mode: 'ENTRY' })).toThrow(ForbiddenException);
  });
  it('lets panel 1 read and use its own account pages', () => {
    expect(run({ mode: 'ENTRY', method: 'GET' })()).toBe(true);
    expect(run({ mode: 'ENTRY', path: '/api/v1/auth/change-password' })()).toBe(true);
  });
  it('lets both panels make a write marked for both', () => {
    expect(run({ mode: 'ENTRY', entry: 'allowed' })()).toBe(true);
    expect(run({ mode: 'PROCESS', entry: 'allowed' })()).toBe(true);
  });
  it('leaves panel 2 processing as it was', () => {
    expect(run({ mode: 'PROCESS' })()).toBe(true);
  });
});
