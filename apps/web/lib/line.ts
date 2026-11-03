'use client';
import { useEffect, useState } from 'react';
import { client, getTenantSlug, Realm } from './client';

/**
 * نوع بیمه‌نامه. Super Admin keeps the catalog (Super Admin › انواع بیمه‌نامه) and picks which kinds each
 * organization's panel 1 offers. Panel 1 works in one kind at a time: chosen on the login, switched in the
 * top bar; the dashboard, بیمه‌نامه list, filing form and case lists all follow it. Panel 2 sees every kind.
 */
export type Line = string;
export interface Kind { code: string; label: string }

const KEY = 'omr_line';

export function getLine(): Line | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setLine(line: Line): void {
  try { localStorage.setItem(KEY, line); } catch { /* ignore */ }
}

/** `?line=…` (or `&line=…`) for panel-1 requests; empty when no kind was chosen. */
export function lineQuery(prefix: '?' | '&' = '?'): string {
  const l = getLine();
  return l ? `${prefix}line=${encodeURIComponent(l)}` : '';
}

/**
 * The kinds one organization's panel 1 offers (`slug`, else the current one), or with `all` every active
 * kind of the catalog (panel 2's filters). null while loading.
 */
export function useKinds(opts: { slug?: string; all?: boolean } = {}): Kind[] | null {
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  useEffect(() => {
    const slug = opts.slug || getTenantSlug();
    fetch(`${client.base}/tenant/policy-kinds${opts.all ? '?all=1' : ''}`, { headers: { 'x-tenant-slug': slug } })
      .then((r) => (r.ok ? r.json() : [])).then((l: Kind[]) => setKinds(Array.isArray(l) ? l : [])).catch(() => setKinds([]));
  }, [opts.slug, opts.all]);
  return kinds;
}

/** Super Admin: the whole catalog (hidden kinds too), for contract and Model View screens. */
export function useCatalog(realm: Realm = 'super'): Kind[] {
  const [kinds, setKinds] = useState<Kind[]>([]);
  useEffect(() => {
    client.get<{ kinds: (Kind & { active: boolean })[] }>('/admin/policy-kinds', realm).then((d) => setKinds(d.kinds)).catch(() => setKinds([]));
  }, [realm]);
  return kinds;
}

/** Label of a kind code from a loaded list (the code itself when unknown). */
export const kindName = (kinds: Kind[] | null | undefined, code: string | null | undefined) => (code ? kinds?.find((k) => k.code === code)?.label ?? code : '');
