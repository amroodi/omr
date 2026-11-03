'use client';
import { useEffect, useState } from 'react';
import { getLine, Line, setLine, useKinds } from '../../lib/line';

/**
 * «نوع بیمه‌نامه» on a panel-1 login: the kinds Super Admin opened to this organization (`slug`), chosen
 * before signing in and remembered for the next time. `onChange` reports the choice so the login can wait.
 */
export function LineSelect({ slug, onChange }: { slug?: string; onChange?: (line: Line | null) => void }) {
  const kinds = useKinds({ slug });
  const [value, setValue] = useState<Line | ''>('');
  useEffect(() => {
    if (!kinds) return;
    const saved = getLine();
    // A remembered kind this organization doesn't offer is not kept; a single kind is picked for you.
    const l = saved && kinds.some((k) => k.code === saved) ? saved : kinds.length === 1 ? kinds[0].code : null;
    setValue(l ?? '');
    if (l) setLine(l);
    onChange?.(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds]);
  return (
    <div>
      <label className="label">نوع بیمه‌نامه</label>
      <select className="input" value={value} required aria-label="نوع بیمه‌نامه" disabled={!kinds?.length}
        onChange={(e) => { const l = e.target.value; setValue(l); setLine(l); onChange?.(l); }}>
        <option value="" disabled>{!kinds ? 'در حال دریافت…' : kinds.length ? '— انتخاب نوع بیمه‌نامه —' : 'نوع بیمه‌نامه‌ای فعال نیست'}</option>
        {kinds?.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
      </select>
    </div>
  );
}

/** The same choice in panel 1's top bar: switching reloads the panel in the other kind. */
export function LineSwitch() {
  const kinds = useKinds();
  const [value, setValue] = useState<Line | null>(null);
  useEffect(() => { setValue(getLine()); }, []);
  if (!value || !kinds?.length) return null;
  return (
    <label className="line-switch" title="نوع بیمه‌نامه">
      <span>نوع بیمه‌نامه:</span>
      <select value={value} onChange={(e) => { setLine(e.target.value); window.location.reload(); }} aria-label="نوع بیمه‌نامه">
        {!kinds.some((k) => k.code === value) && <option value={value}>{value}</option>}
        {kinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
      </select>
    </label>
  );
}
