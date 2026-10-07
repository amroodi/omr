'use client';
import { useEffect, useRef, useState } from 'react';
import { toGregorian, toJalaali } from 'jalaali-js';

const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEK = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // Saturday-first (RTL grid places index 0 on the right)
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const asc = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const pad = (n: number) => String(n).padStart(2, '0');

function daysInJMonth(jy: number, jm: number): number {
  const a = toGregorian(jy, jm, 1);
  const ny = jm === 12 ? jy + 1 : jy;
  const nm = jm === 12 ? 1 : jm + 1;
  const b = toGregorian(ny, nm, 1);
  return Math.round((Date.UTC(b.gy, b.gm - 1, b.gd) - Date.UTC(a.gy, a.gm - 1, a.gd)) / 86400000);
}
function firstWeekday(jy: number, jm: number): number {
  const g = toGregorian(jy, jm, 1);
  const dow = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); // 0=Sun … 6=Sat
  return (dow + 1) % 7; // 0=شنبه
}
function todayJ() {
  const n = new Date();
  return toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** Lightweight Jalali (Persian) date picker. Emits/accepts "YYYY/MM/DD" (ASCII) like the forms expect. */
export function JalaliDatePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const parsed = (() => {
    const p = asc(value || '').split('/').map((x) => parseInt(x, 10));
    return p.length === 3 && p.every((n) => !isNaN(n)) ? { jy: p[0], jm: p[1], jd: p[2] } : null;
  })();
  const t = todayJ();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: parsed?.jy ?? t.jy, m: parsed?.jm ?? t.jm });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as any)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (open && parsed) setView({ y: parsed.jy, m: parsed.jm }); /* eslint-disable-next-line */ }, [open]);

  const nDays = daysInJMonth(view.y, view.m);
  const lead = firstWeekday(view.y, view.m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  const prev = () => setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));
  const pick = (d: number) => { onChange(`${view.y}/${pad(view.m)}/${pad(d)}`); setOpen(false); };
  const isSel = (d: number) => parsed && parsed.jy === view.y && parsed.jm === view.m && parsed.jd === d;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input className="input" readOnly value={value ? fa(value) : ''} placeholder={placeholder || '۱۴۰۵/۰۷/۰۱'} onClick={() => setOpen((o) => !o)} style={{ direction: 'ltr', textAlign: 'right', cursor: 'pointer' }} />
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 40, top: '110%', insetInlineStart: 0, width: 288, padding: 10 }}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prev} className="btn btn-ghost btn-sm">ماه قبل</button>
            <span className="font-bold text-sm">{J_MONTHS[view.m - 1]} {fa(view.y)}</span>
            <button type="button" onClick={next} className="btn btn-ghost btn-sm">ماه بعد</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center' }}>
            {WEEK.map((w) => <div key={w} className="text-xs" style={{ color: 'var(--muted)', padding: '4px 0' }}>{w}</div>)}
            {cells.map((d, i) => d === null ? <div key={i} /> : (
              <button type="button" key={i} onClick={() => pick(d)} className="text-sm" style={{ padding: '6px 0', borderRadius: 8, border: '1px solid var(--border)', background: isSel(d) ? 'var(--brand)' : 'var(--surface-2)', color: isSel(d) ? '#fff' : 'inherit', cursor: 'pointer' }}>{fa(d)}</button>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            <button type="button" onClick={() => { const n = todayJ(); onChange(`${n.jy}/${pad(n.jm)}/${pad(n.jd)}`); setOpen(false); }} className="btn btn-ghost btn-sm">امروز</button>
            {value && <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>پاک کردن</button>}
          </div>
        </div>
      )}
    </div>
  );
}
