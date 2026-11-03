'use client';
import { useEffect, useState } from 'react';
import { getLine, Line, LINE_FA, LINES, setLine } from '../../lib/line';

/**
 * «نوع بیمه‌نامه» on a panel-1 login: chosen before signing in, remembered for the next time. `onChange`
 * reports the choice so the login button can wait for it.
 */
export function LineSelect({ onChange }: { onChange?: (line: Line | null) => void }) {
  const [value, setValue] = useState<Line | ''>('');
  useEffect(() => { const l = getLine(); if (l) setValue(l); onChange?.(l); /* eslint-disable-next-line */ }, []);
  return (
    <div>
      <label className="label">نوع بیمه‌نامه</label>
      <select className="input" value={value} required aria-label="نوع بیمه‌نامه"
        onChange={(e) => { const l = e.target.value as Line; setValue(l); setLine(l); onChange?.(l); }}>
        <option value="" disabled>— انتخاب نوع بیمه‌نامه —</option>
        {LINES.map((l) => <option key={l} value={l}>{LINE_FA[l]}</option>)}
      </select>
    </div>
  );
}

/** The same choice in panel 1's top bar: switching reloads the panel in the other kind. */
export function LineSwitch() {
  const [value, setValue] = useState<Line | null>(null);
  useEffect(() => { setValue(getLine()); }, []);
  if (!value) return null;
  return (
    <label className="line-switch" title="نوع بیمه‌نامه">
      <span>نوع بیمه‌نامه:</span>
      <select value={value} onChange={(e) => { setLine(e.target.value as Line); window.location.reload(); }} aria-label="نوع بیمه‌نامه">
        {LINES.map((l) => <option key={l} value={l}>{LINE_FA[l]}</option>)}
      </select>
    </label>
  );
}
