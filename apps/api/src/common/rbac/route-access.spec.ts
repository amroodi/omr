import { join } from 'path';
import { RouteInfo, routeInventory } from './route-inventory';

/**
 * The A/B/C access audit, run on every test: each route of the API against the panels' rules.
 *  A — creating a case: panel 1 only (staff in an ENTRY sign-in, بیمه‌گزار / نماینده / نماینده بیمه).
 *  B — processing: panel 2 only (staff in a PROCESS sign-in).
 *  C — viewing: panel 3 (the public inquiry's code-scoped token) reads one case and leaves a question.
 * Level 5 (Super Admin) is @SuperAdminOnly, or acts inside a panel through «ورود به پنل».
 * A new route fails here until it says who may call it — that is the point.
 */
const routes = routeInventory(join(__dirname, '..', '..', 'modules'));
const key = (r: RouteInfo) => `${r.method} ${r.path}`;
const list = (rs: RouteInfo[]) => rs.map(key).sort();

describe('A/B/C route access', () => {
  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(250);
  });

  it('every route says who may call it', () => {
    const bare = routes.filter((r) => !r.isPublic && !r.superOnly && !r.permissions.length && !r.realms.length);
    expect(list(bare)).toEqual([]);
  });

  it('public changes are only sign-in, sign-up, the inquiry and the document re-upload link', () => {
    expect(list(routes.filter((r) => r.isPublic && r.method !== 'GET'))).toEqual([
      'POST /auth/org/login', 'POST /auth/super/login',
      'POST /customer/login/company', 'POST /customer/login/direct', 'POST /customer/login/representative', 'POST /customer/login/request-otp', 'POST /customer/login/verify-otp',
      'POST /customer/signup/direct', 'POST /customer/signup/request-otp', 'POST /customer/signup/verify-otp',
      'POST /inquiry/claim-direct', 'POST /inquiry/direct', 'POST /inquiry/request-claim', 'POST /inquiry/request-otp', 'POST /inquiry/verify-otp',
      'POST /insured/login/request-otp', 'POST /insured/login/verify-otp',
      'POST /upload-link/:token/documents',
    ].sort());
  });

  it('A: staff create cases only from panel 1', () => {
    const creating = ['POST /claims', 'POST /claims/on-behalf', 'POST /import/preview', 'POST /import/commit', 'POST /spare', 'POST /spare/import/preview', 'POST /spare/import/commit'];
    for (const c of creating) expect(routes.find((r) => key(r) === c)?.entry).toBe('only');
    // the whole «میز کار مستقل» lives on panel 1
    expect(routes.filter((r) => r.path.startsWith('/spare')).every((r) => r.entry === 'only')).toBe(true);
  });

  it('A/B: the panel markers are exactly these (panel 1 default-denies every other staff write)', () => {
    expect(list(routes.filter((r) => r.entry === 'allowed'))).toEqual(['POST /claims/:id/documents', 'POST /exports/table.xlsx']);
    expect(list(routes.filter((r) => r.entry === 'only' && !r.path.startsWith('/spare')))).toEqual(['POST /claims', 'POST /claims/on-behalf', 'POST /import/commit', 'POST /import/preview']);
  });

  it('C: the inquiry token reads its case, leaves a question, and signs out — nothing else', () => {
    expect(list(routes.filter((r) => r.realms.includes('RECORD')))).toEqual(['GET /inquiry/case', 'GET /inquiry/messages', 'POST /inquiry/message', 'POST /security/logout']);
  });

  it('panel 1 (بیمه‌گزار, نماینده, نماینده بیمه) is reached only through its own routes', () => {
    const outside = routes.filter((r) => r.realms.includes('CUSTOMER') && !r.path.startsWith('/customer/') && !['/notifications', '/security/logout'].some((p) => r.path.startsWith(p)));
    expect(list(outside)).toEqual([]);
    // and no بیمه‌گزار route is also an org door
    expect(list(routes.filter((r) => r.realms.includes('CUSTOMER') && r.permissions.length))).toEqual([]);
  });

  it('پنل بیمه‌شده is reached only through its own routes', () => {
    const outside = routes.filter((r) => r.realms.includes('INSURED') && !r.path.startsWith('/insured/') && r.path !== '/security/logout');
    expect(list(outside)).toEqual([]);
  });

  it('org routes (@Permissions) are staff-only by construction', () => {
    // RolesGuard refuses @Permissions to any non-staff token; a Realms list beside it would be a second door.
    expect(list(routes.filter((r) => r.permissions.length && r.realms.length))).toEqual([]);
  });
});
