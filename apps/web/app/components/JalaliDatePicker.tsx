'use client';
import { useEffect, useRef, useState } from 'react';
import { toGregorian, toJalaali } from 'jalaali-js';
import { Overlay } from './ui';
import { moveField } from './FieldKeys';

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
 * The field is for typing (the slashes come by themselves); the calendar icon in it (or ↓) opens the
 * calendar in the middle of the screen, over a dimmed backdrop.
 */
export function JalaliDatePicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const parsed = (() => {
    const p = asc(value || '').split('/').map((x) => parseInt(x, 10));
    return p.length === 3 && p.every((n) => !isNaN(n)) && p[1] >= 1 && p[1] <= 12 ? { jy: p[0], jm: p[1], jd: p[2] } : null;
  })();
  const t = todayJ();
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Close the calendar; with a date chosen the cursor goes on to the next field, else back to this one.
  const close = (next = false) => { setOpen(false); setTimeout(() => { if (!(next && moveField(field.current))) field.current?.focus(); }, 0); };
  /** A whole, real date (year from 1300, month 1–12, a day of that month). */
  const whole = (v: string) => {
    const m = asc(v).match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) return false;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return y >= FIRST_YEAR && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInJMonth(y, mo);
  };
  const [view, setView] = useState({ y: parsed?.jy ?? t.jy, m: parsed?.jm ?? t.jm });
  useEffect(() => { if (open && parsed && parsed.jy >= FIRST_YEAR) setView({ y: parsed.jy, m: parsed.jm }); /* eslint-disable-next-line */ }, [open]);

  const nDays = daysInJMonth(view.y, view.m);
  const lead = firstWeekday(view.y, view.m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  const prev = () => setView((v) => (v.m === 1 ? { y: Math.max(FIRST_YEAR, v.y - 1), m: v.y > FIRST_YEAR ? 12 : 1 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));
  const pick = (d: number) => { onChange(`${view.y}/${pad(view.m)}/${pad(d)}`); close(true); };
  // Enter in the calendar's own typing box: a whole, real date is taken and the calendar closes.
  const complete = !!parsed && parsed.jy >= FIRST_YEAR && parsed.jd >= 1 && parsed.jd <= daysInJMonth(parsed.jy, parsed.jm) && /^\d{4}\/\d{2}\/\d{2}$/.test(asc(value || ''));
  const isSel = (d: number) => parsed && parsed.jy === view.y && parsed.jm === view.m && parsed.jd === d;
  const isToday = (d: number) => t.jy === view.y && t.jm === view.m && t.jd === d;
  const years = Array.from({ length: t.jy + 2 - FIRST_YEAR + 1 }, (_, i) => t.jy + 2 - i); // newest first

  // Typing: only digits count; the slashes are put in automatically — «14050805» or «1405/08/05» both
  // become «1405/08/05», and a slash appears as soon as the year (4 digits) or month (2 more) is typed.
  // Deleting works normally (no slash is re-added while the text is getting shorter).
  const onType = (raw: string) => {
    const d = asc(raw).replace(/\D/g, '').slice(0, 8);
    let s = d.slice(0, 4);
    if (d.length > 4) s += `/${d.slice(4, 6)}`;
    if (d.length > 6) s += `/${d.slice(6, 8)}`;
    const growing = asc(raw).length > (value || '').length;
    if (growing && (d.length === 4 || d.length === 6)) s += '/';
    onChange(s);
    // The last digit of a real date typed in the field itself: on to the next field.
    if (growing && d.length === 8 && whole(s) && !open && document.activeElement === field.current) setTimeout(() => moveField(field.current), 0);
  };
  // When a typed date becomes complete, move the calendar to it.
  useEffect(() => { if (parsed && parsed.jy >= FIRST_YEAR && parsed.jy <= t.jy + 2) setView({ y: parsed.jy, m: parsed.jm }); /* eslint-disable-next-line */ }, [value]);

  const selectStyle = { padding: '6px 8px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' } as const;
  const navBtn = { width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '1.1rem', cursor: 'pointer', flexShrink: 0 } as const;

  return (
    <div style={{ position: 'relative' }}>
      <input ref={field} className="input" value={value ? fa(value) : ''} placeholder={placeholder || '۱۴۰۵/۰۷/۰۱'} inputMode="numeric"
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setOpen(false); if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        style={{ direction: 'ltr', textAlign: 'right', paddingLeft: 40 }} aria-haspopup="dialog" aria-expanded={open} />
      <button type="button" className="jdp-ico" onClick={() => setOpen(true)} aria-label="باز کردن تقویم" title="انتخاب از تقویم">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" /></svg>
      </button>
      {open && (
        <Overlay onClose={() => setOpen(false)}>
        <div className="card jdp-pop" role="dialog" aria-label="انتخاب تاریخ" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <b className="text-sm">{placeholder || 'انتخاب تاریخ'}</b>
            <input className="input jdp-type" value={value ? fa(value) : ''} onChange={(e) => onType(e.target.value)} inputMode="numeric" placeholder="۱۴۰۵/۰۷/۰۱" aria-label="تایپ تاریخ" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (complete) close(true); else if (!value) close(); } }}
              style={value && !complete && asc(value).replace(/\D/g, '').length === 8 ? { borderColor: 'var(--danger)' } : undefined} title="تاریخ را تایپ کنید و Enter بزنید" />
            <button type="button" onClick={() => close()} className="pmodal-x" aria-label="بستن">×</button>
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
            <button type="button" onClick={() => { const n = todayJ(); onChange(`${n.jy}/${pad(n.jm)}/${pad(n.jd)}`); close(true); }} className="btn btn-ghost btn-sm">امروز</button>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>تاریخ را تایپ کنید و Enter بزنید</span>
            {value ? <button type="button" onClick={() => { onChange(''); close(); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>پاک کردن</button> : <span />}
          </div>
        </div>
        </Overlay>
      )}
    </div>
  );
}
