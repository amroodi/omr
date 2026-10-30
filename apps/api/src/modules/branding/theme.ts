import { BadRequestException } from '@nestjs/common';

/**
 * Per-organization panel theme. Insurers get their own look (their operators — شعبه / ستاد / شورای
 * فنی — sign in to it); a tenant with no theme (Damuon, the brokerage) keeps the default design.
 * Only colour tokens and one constrained gradient are accepted — never free CSS.
 */
export interface TenantTheme {
  brand?: string; // primary interactive colour (buttons, active tab, highlights)
  title?: string; // page-title colour in the top bar
  sidebar?: string; // sidebar background
  sidebarDeep?: string; // sidebar active row / header strip
  canvas?: string; // panel content background
  loginBg?: string; // login page backdrop: a hex colour or linear-gradient of hex stops
  loginButton?: string; // login button colour
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Headers for an uploaded branding file (logo/favicon/font). Logos may be SVG; opened directly on the
 * app's own origin an SVG could run script, so the response is sandboxed and never type-sniffed.
 */
export const ASSET_SAFE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};
const GRADIENT = /^linear-gradient\(\s*\d{1,3}deg(\s*,\s*#[0-9a-fA-F]{6}(\s+\d{1,3}%)?){2,5}\s*\)$/;
const COLOR_KEYS = ['brand', 'title', 'sidebar', 'sidebarDeep', 'canvas', 'loginButton'] as const;

export const THEME_PRESETS: Record<string, { label: string; theme: TenantTheme }> = {
  // Sampled from sinad.alborzinsurance.ir (docs/brand/alborz/README.md).
  alborz: {
    label: 'بیمه البرز',
    theme: {
      brand: '#00bd9c',
      title: '#00a386',
      sidebar: '#2f4358',
      sidebarDeep: '#263648',
      canvas: '#eff2f5',
      loginBg: 'linear-gradient(120deg, #4458d0 0%, #5a57cd 35%, #c150c1 100%)',
      loginButton: '#57b846',
    },
  },
};

/** The panels an organization designs: a brokerage's own and its customers', an insurer's desks. */
export const DESIGN_PANELS: Record<'BROKER' | 'INSURER', { key: string; label: string }[]> = {
  BROKER: [
    { key: 'BROKER', label: 'پنل کارگزاری' },
    { key: 'COMPANY', label: 'پنل بیمه‌گزار' },
    { key: 'REPRESENTATIVE', label: 'پنل نماینده' },
  ],
  INSURER: [
    { key: 'BRANCH', label: 'پنل شعبه' },
    { key: 'HQ', label: 'پنل ستاد' },
    { key: 'COUNCIL', label: 'پنل شورای فنی' },
  ],
};
export const ALL_PANELS = new Set([...DESIGN_PANELS.BROKER, ...DESIGN_PANELS.INSURER].map((p) => p.key));

/** A panel's effective theme: its own tokens over the organization's (either may be empty). */
export function panelTheme(orgTheme: unknown, panelThemes: unknown, panel?: string | null): TenantTheme | null {
  const base = (orgTheme && typeof orgTheme === 'object' ? orgTheme : {}) as TenantTheme;
  const own = panel && panelThemes && typeof panelThemes === 'object' ? ((panelThemes as Record<string, TenantTheme>)[panel] ?? {}) : {};
  const out = { ...base, ...own };
  return Object.keys(out).length ? out : null;
}

/** Validate a theme payload (or a preset name); returns null to clear the theme. */
export function normalizeTheme(input: unknown): TenantTheme | null {
  if (input === null || input === '' || input === undefined) return null;
  if (typeof input === 'string') {
    const p = THEME_PRESETS[input];
    if (!p) throw new BadRequestException('قالب رنگی نامعتبر است');
    return { ...p.theme };
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('قالب رنگی نامعتبر است');
  const src = input as Record<string, unknown>;
  const out: TenantTheme = {};
  for (const k of COLOR_KEYS) {
    const v = src[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !HEX.test(v)) throw new BadRequestException(`رنگ «${k}» باید به شکل #RRGGBB باشد`);
    out[k] = v.toLowerCase();
  }
  const bg = src.loginBg;
  if (typeof bg === 'string' && bg.trim()) {
    const v = bg.trim();
    if (!HEX.test(v) && !GRADIENT.test(v)) throw new BadRequestException('پس‌زمینهٔ صفحهٔ ورود باید یک رنگ یا linear-gradient از رنگ‌های #RRGGBB باشد');
    out.loginBg = v;
  }
  return Object.keys(out).length ? out : null;
}
