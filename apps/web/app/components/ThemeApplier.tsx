'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { client } from '../../lib/client';
import { lastPanel } from '../../lib/panel';
import { applyTheme } from '../../lib/theme';

/**
 * Applies the signed-in organization's theme on its panels (/org, /customer). Public pages and the
 * super-admin keep the platform design; the org login page themes itself from the chosen org.
 */
export function ThemeApplier() {
  const path = usePathname() || '/';
  const themed = (path.startsWith('/org') && path !== '/org/login') || (path.startsWith('/customer') && path !== '/customer/login');
  useEffect(() => {
    if (path === '/org/login') return;
    if (!themed) { applyTheme(null); return; }
    let active = true;
    // This panel's own look (پنل کارگزاری / بیمه‌گزار / نماینده / شعبه / ستاد / شورای فنی), over the org's.
    const panel = lastPanel(path.startsWith('/customer') ? 'customer' : 'org');
    client.get<{ theme?: Record<string, string> | null }>(`/tenant/branding${panel ? `?panel=${panel}` : ''}`)
      .then((b) => { if (active) applyTheme(b.theme ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [themed, path]);
  return null;
}
