'use client';
import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Form state that survives a page refresh (e.g. after the internet dropped and came back), so the
 * operator does not type everything again. It works like `useState`, and:
 *  - lives in sessionStorage: only this browser tab, gone when the tab is closed;
 *  - is tied to the signed-in user and the page; another user in the same tab never sees it;
 *  - expires after a few hours, and is dropped with `clear()` once the form has been sent;
 *  - only plain values come back, and only where they still match the form's fields (same keys and
 *    types as the initial value), so an old draft can never put something odd into a newer form.
 * Files and passwords are never kept (don't pass them to this hook).
 */
const TTL_MS = 3 * 60 * 60 * 1000;
const PREFIX = 'omr_draft:';
const TOKENS = ['omr_org_token', 'omr_customer_token', 'omr_super_token', 'omr_insured_token'];

/** The signed-in user (token key + user id from the panel's token); none = no draft at all. */
function who(): string {
  try {
    for (const k of TOKENS) {
      const t = localStorage.getItem(k);
      if (!t) continue;
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (p?.sub) return `${k}:${p.sub}`;
    }
  } catch { /* no storage / not a JWT */ }
  return '';
}

const PLAIN = ['string', 'number', 'boolean'];

/** Keep only what fits the shape of `init` (same keys, same kinds of values); undefined = nothing fits. */
function fit<T>(init: T, saved: unknown): T | undefined {
  if (Array.isArray(init)) return Array.isArray(saved) && saved.length <= 200 && saved.every((x) => PLAIN.includes(typeof x)) ? (saved as T) : undefined;
  if (init && typeof init === 'object') {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return undefined;
    const out: Record<string, unknown> = { ...(init as Record<string, unknown>) };
    for (const [k, v] of Object.entries(init as Record<string, unknown>)) {
      const s = (saved as Record<string, unknown>)[k];
      if (s === undefined) continue;
      const f = v && typeof v === 'object' ? fit(v, s) : PLAIN.includes(typeof v) && typeof s === typeof v ? s : undefined;
      if (f !== undefined) out[k] = f;
    }
    return out as T;
  }
  return PLAIN.includes(typeof init) && typeof saved === typeof init ? (saved as T) : undefined;
}

export function useDraft<T>(name: string, init: T): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(init);
  const [ready, setReady] = useState(false);
  const key = useRef('');
  const initRef = useRef(init);

  // Restore after the first render (the server-rendered page has no access to the tab's storage).
  useEffect(() => {
    try {
      const user = who();
      if (user) {
        key.current = `${PREFIX}${user}:${location.pathname}:${name}`;
        const raw = sessionStorage.getItem(key.current);
        if (raw) {
          const d = JSON.parse(raw) as { at: number; v: unknown };
          const v = typeof d?.at === 'number' && Date.now() - d.at < TTL_MS ? fit(initRef.current, d.v) : undefined;
          if (v !== undefined) setValue(v); else sessionStorage.removeItem(key.current);
        }
      }
    } catch { key.current = ''; }
    setReady(true);
  }, [name]);

  // Save while typing (a moment after the last change); back to the empty form = nothing kept.
  useEffect(() => {
    if (!ready || !key.current) return;
    const t = setTimeout(() => {
      try {
        if (!key.current) return;
        if (JSON.stringify(value) === JSON.stringify(initRef.current)) sessionStorage.removeItem(key.current);
        else sessionStorage.setItem(key.current, JSON.stringify({ at: Date.now(), v: value }));
      } catch { /* storage full / blocked: the form still works, it just isn't kept */ }
    }, 400);
    return () => clearTimeout(t);
  }, [value, ready]);

  /** The form was sent: forget the draft (and keep nothing more from this page). */
  const clear = useCallback(() => {
    try { if (key.current) sessionStorage.removeItem(key.current); } catch { /* ignore */ }
    key.current = '';
  }, []);
  return [value, setValue, clear];
}

/** Sign-out: forget every draft of this tab. */
export function clearDrafts() {
  try { Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k)); } catch { /* ignore */ }
}
