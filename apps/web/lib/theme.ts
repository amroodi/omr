/**
 * Per-organization theme at runtime. An insurer's operators see their organization's colours; a
 * tenant without a theme (Damuon) gets the default design. The API sends colour tokens
 * (apps/api/src/modules/branding/theme.ts); we derive shades here and set them as `--t-*` CSS
 * variables on <html>, which globals.css reads with the default design as fallback.
 */
export interface TenantTheme {
  brand?: string; title?: string; sidebar?: string; sidebarDeep?: string; canvas?: string;
  loginBg?: string; loginButton?: string;
}

const STORE_KEY = 'omr_theme_vars'; // last applied vars, re-applied before paint (see layout.tsx)

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex: string, withHex: string, amount: number): string {
  const a = rgb(hex); const b = rgb(withHex);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

/** CSS variables for a theme (empty for none). */
export function themeVars(t: TenantTheme | null | undefined): Record<string, string> {
  if (!t) return {};
  const v: Record<string, string> = {};
  if (t.brand) {
    v['--t-brand'] = t.brand;
    v['--t-brand-600'] = mix(t.brand, '#000000', 0.12);
    v['--t-brand-700'] = mix(t.brand, '#000000', 0.25);
    v['--t-brand-soft'] = mix(t.brand, '#ffffff', 0.88);
    v['--t-brand-soft-dark'] = mix(t.brand, '#0c1424', 0.82);
    v['--t-brand-rgb'] = rgb(t.brand).join(', ');
  }
  if (t.title) v['--t-title'] = t.title;
  if (t.sidebar) {
    v['--t-sidebar'] = t.sidebar;
    v['--t-sidebar-hover'] = mix(t.sidebar, '#ffffff', 0.08);
  }
  if (t.sidebarDeep) {
    v['--t-sidebar-deep'] = t.sidebarDeep;
    v['--t-sidebar-active'] = mix(t.sidebarDeep, '#000000', 0.18);
  }
  if (t.canvas) v['--t-canvas'] = t.canvas;
  return v;
}

let applied: string[] = [];

/** Apply (or clear, with null) the theme on <html> and remember it for the next page load. */
export function applyTheme(t: TenantTheme | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  const vars = themeVars(t);
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  applied = Object.keys(vars);
  try {
    if (applied.length) localStorage.setItem(STORE_KEY, JSON.stringify(vars));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage may be unavailable */ }
}

/** Inline <head> script: re-apply the last theme before first paint so a themed panel doesn't flash orange. */
export const THEME_BOOT_SCRIPT = `try{var p=location.pathname;if(p.indexOf('/org')===0||p.indexOf('/customer')===0){var v=JSON.parse(localStorage.getItem('${STORE_KEY}')||'{}');for(var k in v)document.documentElement.style.setProperty(k,v[k])}}catch(e){}`;
