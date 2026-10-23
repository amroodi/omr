'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { client } from '../../lib/client';
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
    client.get<{ theme?: Record<string, string> | null }>('/tenant/branding')
      .then((b) => { if (active) applyTheme(b.theme ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [themed, path]);
  return null;
}
