'use client';
import { useEffect, useRef, useState } from 'react';
import { WALL_KEY } from '../../lib/wallpaper';

/** Panel wallpapers (CSS in globals.css: html[data-wall] .pshell). Light and dark variants each. */
export const WALLPAPERS: { id: string; label: string }[] = [
  { id: 'default', label: 'پیش‌فرض' },
  { id: 'dots', label: 'نقطه‌ها' },
  { id: 'sand', label: 'شنی' },
  { id: 'mint', label: 'نعنایی' },
  { id: 'aurora', label: 'شفق' },
];
const KEY = WALL_KEY;

function apply(id: string) {
  const d = document.documentElement;
  if (id === 'default') d.removeAttribute('data-wall'); else d.setAttribute('data-wall', id);
  try { localStorage.setItem(KEY, id); } catch { /* storage may be unavailable */ }
}

/** «پس‌زمینه» — top-bar button that lets each user pick the panel wallpaper (kept in this browser). */
export function WallpaperPicker() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('default');
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setCur(document.documentElement.getAttribute('data-wall') || 'default'); }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="pback" title="انتخاب پس‌زمینهٔ پنل" aria-label="پس‌زمینه" aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3a9 9 0 100 18c.8 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.4-4-8-9-8z" />
          <circle cx="7.5" cy="10.5" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="16.5" cy="10.5" r="1.2" />
        </svg>
      </button>
      {open && (
        <div className="wall-pop" role="dialog" aria-label="پس‌زمینهٔ پنل">
          <div className="text-sm font-bold mb-2">پس‌زمینهٔ پنل</div>
          <div className="wall-grid">
            {WALLPAPERS.map((w) => (
              <button key={w.id} type="button" className={`wall-opt${cur === w.id ? ' is-on' : ''}`} aria-pressed={cur === w.id}
                onClick={() => { apply(w.id); setCur(w.id); }}>
                <span className={`wall-swatch w-${w.id}`} />
                {w.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>هر پس‌زمینه نسخهٔ روشن و تیرهٔ خود را دارد؛ با کلید روشن/تیره عوض می‌شود.</div>
        </div>
      )}
    </span>
  );
}
