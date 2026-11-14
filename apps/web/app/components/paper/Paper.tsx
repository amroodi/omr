'use client';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { client, getTenantSlug } from '../../../lib/client';

/**
 * A paper form on screen, laid out like the insurer's printed sheet: bordered page, a vertical label down the
 * side of each section, dotted blanks typed into in place, tick boxes, and «نام و امضاء» stamped with the
 * signer's name and date. Which blanks the caller may type into is decided by `can(key)`.
 */
export type Values = Record<string, string>;
interface Ctx { v: Values; set: (k: string, val: string) => void; can: (k: string) => boolean }
const PaperCtx = createContext<Ctx>({ v: {}, set: () => {}, can: () => false });

export function PaperFields({ values, onChange, can, children }: { values: Values; onChange?: (v: Values) => void; can: (k: string) => boolean; children: ReactNode }) {
  return <PaperCtx.Provider value={{ v: values, set: (k, val) => onChange?.({ ...values, [k]: val }), can: (k) => !!onChange && can(k) }}>{children}</PaperCtx.Provider>;
}

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** The sheet: logo, title, sub-title, and the form number down the left margin. */
export function Paper({ title, sub, formNo, children }: { title: string; sub?: string; formNo?: string; children: ReactNode }) {
  const [logo, setLogo] = useState(true);
  const slug = typeof window !== 'undefined' ? getTenantSlug() : '';
  return (
    <div className="paper">
      <div className="paper-top">
        {logo && slug ? <img className="paper-logo" src={`${client.base}/tenant/assets/logo?tenant=${slug}`} alt="" onError={() => setLogo(false)} /> : <span />}
        <div className="paper-title"><b>{title}</b>{sub && <span>{sub}</span>}</div>
        <span />
      </div>
      <div className="paper-sheet">{children}</div>
      {formNo && <div className="paper-no">شماره فرم: {formNo}</div>}
    </div>
  );
}

/** One section: its vertical side label and its body (tinted while it is the caller's to fill). */
export function Band({ side, active, children, dashedTop }: { side: ReactNode; active?: boolean; children: ReactNode; dashedTop?: boolean }) {
  return (
    <div className={`paper-band${active ? ' is-active' : ''}${dashedTop ? ' is-dashed' : ''}`}>
      <div className="paper-side"><span>{side}</span></div>
      <div className="paper-body">{children}</div>
    </div>
  );
}

/** An inline dotted blank. `w` = width in characters; `amount` keeps digits and shows them grouped. */
export function B({ k, w = 12, amount, ltr, ph }: { k: string; w?: number; amount?: boolean; ltr?: boolean; ph?: string }) {
  const { v, set, can } = useContext(PaperCtx);
  const raw = v[k] ?? '';
  const shown = amount && raw ? Number(raw).toLocaleString('fa-IR') : raw;
  const style = { width: `${w}ch` };
  if (!can(k)) return <span className={`paper-blank is-ro${raw ? ' has' : ''}${ltr ? ' ltr' : ''}`} style={style}>{shown}</span>;
  return (
    <input className={`paper-blank${ltr ? ' ltr' : ''}`} style={style} value={shown} placeholder={ph}
      onChange={(e) => set(k, amount ? toAscii(e.target.value).replace(/\D/g, '').slice(0, 15) : e.target.value.slice(0, 300))} />
  );
}

/** Ruled lines to write on (a textarea). */
export function Lines({ k, rows = 3, ph }: { k: string; rows?: number; ph?: string }) {
  const { v, set, can } = useContext(PaperCtx);
  const style = { height: `${rows * 2}em` };
  if (!can(k)) return <div className="paper-lines is-ro" style={style}>{v[k] ?? ''}</div>;
  return <textarea className="paper-lines" style={style} value={v[k] ?? ''} placeholder={ph} maxLength={2000} onChange={(e) => set(k, e.target.value)} />;
}

/** A tick box. With `opt`, a choice of `k` (several may be ticked when `multi`); without it, a yes/no of `k`. */
export function Box({ k, opt, multi, label }: { k: string; opt?: string; multi?: boolean; label?: ReactNode }) {
  const { v, set, can } = useContext(PaperCtx);
  const cur = v[k] ?? '';
  const list = cur ? cur.split('،') : [];
  const on = opt == null ? cur === '1' : multi ? list.includes(opt) : cur === opt;
  const toggle = () => {
    if (opt == null) return set(k, on ? '' : '1');
    if (multi) return set(k, (on ? list.filter((x) => x !== opt) : [...list, opt]).join('،'));
    set(k, on ? '' : opt);
  };
  const ro = !can(k);
  return (
    <label className={`paper-box${on ? ' is-on' : ''}${ro ? ' is-ro' : ''}`}>
      {label != null && <span>{label}</span>}
      <button type="button" disabled={ro} onClick={toggle} aria-pressed={on}>{on ? '✓' : ''}</button>
    </label>
  );
}

/** Printed alternatives «خانم / آقای», «گروهی / انفرادی»: the chosen one stands out, the others are struck through. */
export function Alt({ k, opts }: { k: string; opts: string[] }) {
  const { v, set, can } = useContext(PaperCtx);
  const cur = v[k] ?? '';
  const ro = !can(k);
  return (
    <span className="paper-alt">
      {opts.map((o, i) => (
        <span key={o}>
          {i > 0 && ' / '}
          <button type="button" disabled={ro} className={cur === o ? 'is-on' : cur ? 'is-off' : ''} onClick={() => set(k, cur === o ? '' : o)}>{o}</button>
        </span>
      ))}
    </span>
  );
}

/** «نام و امضاء» / «مهر و امضاء»: the signer's name and date once the section is registered. */
export function Sign({ label, sign, showDate = true }: { label: string; sign?: { name: string; at: string } | null; showDate?: boolean }) {
  return (
    <div className="paper-sign">
      {showDate && <div><b>تاریخ :</b> <span className="paper-stamp">{sign?.at ?? ''}</span></div>}
      <div className="paper-sign-who"><b>{label}</b><span className="paper-stamp">{sign?.name ?? ''}</span></div>
    </div>
  );
}

/** Print only the sheet. */
export function printPaper() {
  document.body.classList.add('printing-paper');
  const done = () => { document.body.classList.remove('printing-paper'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/** The sheet over the page, with its title, «چاپ» and «بستن»; `actions` sit under the sheet. */
export function PaperModal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  // On <body>: a page's own transformed container would otherwise hold the fixed layer.
  return createPortal(
    <div className="paper-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="paper-modal-bar"><b>{title}</b><button type="button" onClick={printPaper}>چاپ</button><button type="button" onClick={onClose}>بستن</button></div>
        {children}
        {actions && <div className="paper-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
