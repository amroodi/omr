'use client';
import { useState } from 'react';

const norm = (t: string) => t.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').trim();

/**
 * A searchable list (an insurer's panel 1: «علت خسارت», «بیمه‌گزار (شرکت)»): type part of a name to find
 * it; ↑/↓ and Enter pick, Esc closes. `none` adds an empty choice at the top (e.g. «بدون شرکت بیمه‌گزار»).
 */
export function SearchPick({ options, value, onPick, placeholder, none, label, badge }: {
  options: { id: string; name: string }[]; value: string; onPick: (id: string) => void; placeholder: string;
  none?: string; label: string; badge?: (id: string) => string | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const picked = options.find((o) => o.id === value) ?? null;
  // While typing only the matches show, so Enter takes the first one.
  const list = [...(none && !q.trim() ? [{ id: '', name: none }] : []), ...options.filter((o) => !q.trim() || norm(o.name).includes(norm(q)))];
  const choose = (id: string) => { onPick(id); setQ(''); setOpen(false); };
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" role="combobox" aria-expanded={open} aria-label={label} title={picked?.name}
        value={open ? q : picked?.name ?? ''} placeholder={open && picked ? picked.name : placeholder}
        onFocus={() => { setOpen(true); setQ(''); setHi(0); }} onClick={() => setOpen(true)} onBlur={() => { setOpen(false); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && list[hi]) choose(list[hi].id); else setOpen(true); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      <span className="spick-caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="co-pick" role="listbox">
          {list.length === 0 ? <li className="is-empty">موردی با این نام نیست</li> : list.map((o, k) => (
            <li key={o.id || '__none'} role="option" aria-selected={o.id === value} className={`cause-opt${k === hi ? ' is-hi' : ''}${o.id === value ? ' is-on' : ''}${o.id ? '' : ' is-none'}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o.id); }} onMouseEnter={() => setHi(k)}>
              <span className="flex-1">{o.name}</span>
              {o.id && badge?.(o.id) && <span className="cause-has-note">{badge(o.id)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

