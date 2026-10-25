'use client';
import { useEffect, useState } from 'react';
import { toGregorian, toJalaali } from 'jalaali-js';
import { Overlay } from './ui';

const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEK = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // Saturday-first (RTL grid places index 0 on the right)
const FIRST_YEAR = 1300; // birth dates of insured people go back decades
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const asc = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
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

/**
 * Jalali (Persian) date picker. Emits/accepts "YYYY/MM/DD" (ASCII) like the forms expect.
 * The date can be typed (Persian or Latin digits) or picked; the header has year + month dropdowns so
 * far-away dates (e.g. a birth date decades back) take two clicks instead of hundreds of «ماه قبل».
 * Clicking the field opens the calendar in the middle of the screen (over a dimmed backdrop).
 */
export function JalaliDatePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const parsed = (() => {
    const p = asc(value || '').split('/').map((x) => parseInt(x, 10));
    return p.length === 3 && p.every((n) => !isNaN(n)) && p[1] >= 1 && p[1] <= 12 ? { jy: p[0], jm: p[1], jd: p[2] } : null;
  })();
  const t = todayJ();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: parsed?.jy ?? t.jy, m: parsed?.jm ?? t.jm });
  useEffect(() => { if (open && parsed && parsed.jy >= FIRST_YEAR) setView({ y: parsed.jy, m: parsed.jm }); /* eslint-disable-next-line */ }, [open]);

  const nDays = daysInJMonth(view.y, view.m);
  const lead = firstWeekday(view.y, view.m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  const prev = () => setView((v) => (v.m === 1 ? { y: Math.max(FIRST_YEAR, v.y - 1), m: v.y > FIRST_YEAR ? 12 : 1 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));
  const pick = (d: number) => { onChange(`${view.y}/${pad(view.m)}/${pad(d)}`); setOpen(false); };
  const isSel = (d: number) => parsed && parsed.jy === view.y && parsed.jm === view.m && parsed.jd === d;
  const isToday = (d: number) => t.jy === view.y && t.jm === view.m && t.jd === d;
  const years = Array.from({ length: t.jy + 2 - FIRST_YEAR + 1 }, (_, i) => t.jy + 2 - i); // newest first

  // Typing: keep digits + slashes; auto-insert slashes after the year and month.
  const onType = (raw: string) => {
    let s = asc(raw).replace(/[^\d/]/g, '');
    if (/^\d{5,}$/.test(s)) s = `${s.slice(0, 4)}/${s.slice(4, 6)}${s.length > 6 ? `/${s.slice(6, 8)}` : ''}`;
    onChange(s.slice(0, 10));
  };
  // When a typed date becomes complete, move the calendar to it.
  useEffect(() => { if (parsed && parsed.jy >= FIRST_YEAR && parsed.jy <= t.jy + 2) setView({ y: parsed.jy, m: parsed.jm }); /* eslint-disable-next-line */ }, [value]);

  const selectStyle = { padding: '6px 8px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' } as const;
  const navBtn = { width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 } as const;

  return (
    <div style={{ position: 'relative' }}>
      <input className="input" value={value ? fa(value) : ''} placeholder={placeholder || '۱۴۰۵/۰۷/۰۱'} inputMode="numeric"
        onChange={(e) => onType(e.target.value)} onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setOpen(false); if (e.key === 'ArrowDown') setOpen(true); }}
        style={{ direction: 'ltr', textAlign: 'right', cursor: 'pointer' }} aria-haspopup="dialog" aria-expanded={open} />
      {open && (
        <Overlay onClose={() => setOpen(false)}>
        <div className="card jdp-pop" role="dialog" aria-label="انتخاب تاریخ" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <b className="text-sm">{placeholder || 'انتخاب تاریخ'}</b>
            <input className="input jdp-type" value={value ? fa(value) : ''} onChange={(e) => onType(e.target.value)} inputMode="numeric" placeholder="۱۴۰۵/۰۷/۰۱" aria-label="تایپ تاریخ" />
            <button type="button" onClick={() => setOpen(false)} className="pmodal-x" aria-label="بستن">×</button>
          </div>
          {/* Header: ‹ month ▾ year ▾ › */}
          <div className="jdp-head mb-3">
            <button type="button" onClick={prev} className="jdp-nav" style={navBtn} aria-label="ماه قبل" title="ماه قبل">›</button>
            <select value={view.m} onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))} className="jdp-month" style={selectStyle} aria-label="ماه">
              {J_MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
            </select>
            <select value={view.y} onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))} className="jdp-year" style={selectStyle} aria-label="سال">
              {years.map((y) => <option key={y} value={y}>{fa(y)}</option>)}
            </select>
            <button type="button" onClick={next} className="jdp-nav" style={navBtn} aria-label="ماه بعد" title="ماه بعد">‹</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
            {WEEK.map((w) => <div key={w} className="text-sm font-bold" style={{ color: 'var(--muted)', padding: '4px 0' }}>{w}</div>)}
            {cells.map((d, i) => d === null ? <div key={i} /> : (
              <button type="button" key={i} onClick={() => pick(d)}
                style={{
                  height: 40, borderRadius: 10, fontSize: '0.95rem', fontWeight: isSel(d) || isToday(d) ? 800 : 500, cursor: 'pointer',
                  border: isToday(d) && !isSel(d) ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                  background: isSel(d) ? 'var(--brand)' : 'var(--surface-2)', color: isSel(d) ? '#fff' : 'var(--text)',
                }}>{fa(d)}</button>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 gap-2">
            <button type="button" onClick={() => { const n = todayJ(); onChange(`${n.jy}/${pad(n.jm)}/${pad(n.jd)}`); setOpen(false); }} className="btn btn-ghost btn-sm">امروز</button>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>می‌توانید تاریخ را تایپ هم کنید</span>
            {value ? <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>پاک کردن</button> : <span />}
          </div>
        </div>
        </Overlay>
      )}
    </div>
  );
}
