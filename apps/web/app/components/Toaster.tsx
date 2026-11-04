'use client';
import { useEffect, useState } from 'react';

/**
 * System messages («ذخیره شد», errors) as toasts: fixed at the top right of the screen, so they are seen
 * wherever the user has scrolled to, and gone by themselves after a few seconds (a click closes one early).
 * `toast()` can be called from anywhere; `<Toaster />` (in the root layout) shows them.
 */
export type ToastTone = 'ok' | 'error';
interface Toast { id: number; text: string; tone: ToastTone }

let seq = 0;
const listeners = new Set<(t: Toast) => void>();
const SHOW_MS: Record<ToastTone, number> = { ok: 3500, error: 6500 };

export function toast(text: string, tone: ToastTone = 'ok') {
  const t = text?.trim();
  if (!t) return;
  const item = { id: ++seq, text: t, tone };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      // the same text already showing: start it again instead of stacking a copy
      setItems((cur) => [...cur.filter((x) => x.text !== t.text), t].slice(-4));
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), SHOW_MS[t.tone]);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="toasts no-print" role="status" aria-live="polite">
      {items.map((t) => (
        <button key={t.id} type="button" className={`toast is-${t.tone}`} onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))} title="بستن">
          <span className="toast-ico" aria-hidden="true">{t.tone === 'ok' ? '✓' : '!'}</span>
          <span className="toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A page's «ذخیره شد / خطا» message, shown as a toast when it appears or changes (renders nothing in place).
 * `id` is what makes it new — the message object itself, so setting the same text again shows it again.
 */
export function Flash({ text, ok, id }: { text?: string | null; ok: boolean; id?: unknown }) {
  useEffect(() => { if (text) toast(text, ok ? 'ok' : 'error'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id ?? text]);
  return null;
}
