'use client';
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Progress callback: fraction 0–1 and the estimated seconds left (null until it can be estimated). */
export type OnProgress = (pct: number, eta: number | null) => void;
/** Does the work for one picked file. Resolve = done, reject = shown as an error notice in the dialog. */
export type UploadFn = (file: File, onProgress: OnProgress) => Promise<unknown> | void;

const faN = (n: number) => n.toLocaleString('fa-IR');

/** Telegram-style ring: fills as the file goes up, with the seconds left (or the percent) in the middle. */
export function ProgressRing({ pct, eta, size = 40 }: { pct: number; eta: number | null; size?: number }) {
  const r = 16; const c = 2 * Math.PI * r;
  return (
    <span className="up-ring" style={{ width: size, height: size }} title={eta != null ? `حدود ${faN(eta)} ثانیه تا پایان` : 'در حال بارگذاری…'} aria-label={`در حال بارگذاری ${faN(Math.round(pct * 100))}٪`}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <circle cx="20" cy="20" r={r} className="up-ring-track" />
        <circle cx="20" cy="20" r={r} className="up-ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="up-ring-t">{eta != null && pct < 1 ? `${faN(eta)}″` : `${faN(Math.round(pct * 100))}٪`}</span>
    </span>
  );
}

/** ".pdf,.jpg,image/*" → readable list for the hint line, e.g. «PDF، JPG، PNG». */
function acceptLabel(accept: string) {
  return accept.split(',').map((a) => a.trim()).filter(Boolean)
    .map((a) => (a === 'image/*' ? 'تصویر' : a.startsWith('.') ? a.slice(1).toUpperCase() : (a.split('/')[1] || a).toUpperCase()))
    .filter((v, i, all) => all.indexOf(v) === i).join('، ');
}
function accepts(accept: string, f: File) {
  const list = accept.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const name = f.name.toLowerCase(); const type = (f.type || '').toLowerCase();
  return list.some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
}

type Item = { id: number; name: string; pct: number; eta: number | null; state: 'up' | 'done' | 'error'; error?: string };

/**
 * «بارگذاری پرونده» pop-up: a dashed drop zone («پرونده‌ها را بکشید … یا گزینش پرونده‌ها»), the size and
 * type limits, then one row per file — a progress ring with the time left while it goes up, or a
 * red-edged notice («… بارگذاری نشد» + reason + «لغو») when it's refused. Files are checked against
 * `accept` and `maxMB` before anything is sent. Stays mounted while closed, so an upload keeps going
 * (and its owner keeps showing progress) if the user closes the dialog.
 */
export function UploadDialog({
  open, onClose, onUpload, accept, maxMB, title = 'بارگذاری پرونده', subtitle, multiple = false, camera = false, closeOnDone = true, note,
}: {
  open: boolean; onClose: () => void; onUpload: UploadFn; accept: string; maxMB: number;
  title?: string; subtitle?: ReactNode; multiple?: boolean; camera?: boolean; closeOnDone?: boolean; note?: ReactNode;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const tid = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { setMounted(true); }, []);

  // Fresh list each time it opens (finished rows from last time aren't news any more); focus the picker.
  useEffect(() => {
    if (!open) return;
    setItems((l) => l.filter((i) => i.state === 'up'));
    const t = setTimeout(() => pickRef.current?.focus(), 30);
    // Escape closes only this dialog, even when it sits on top of another pop-up.
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', k, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k, true); };
  }, [open]);

  const patch = (id: number, p: Partial<Item>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const run = async (files: File[]) => {
    const list = multiple ? files : files.slice(0, 1);
    if (!list.length) return;
    let allOk = true;
    const jobs = list.map(async (f) => {
      const id = ++seq.current;
      const bad = !accepts(accept, f) ? `این نوع پرونده مجاز نیست؛ فقط ${acceptLabel(accept)} پذیرفته می‌شود.`
        : f.size > maxMB * 1024 * 1024 ? `حجم پرونده بیش از ${faN(maxMB)} مگابایت است.` : '';
      const row: Item = { id, name: f.name, pct: 0, eta: null, state: bad ? 'error' : 'up', error: bad || undefined };
      setItems((l) => [row, ...(multiple ? l : l.filter((i) => i.state === 'up'))]);
      if (bad) { allOk = false; return; }
      try {
        await onUpload(f, (pct, eta) => patch(id, { pct, eta }));
        patch(id, { state: 'done', pct: 1, eta: 0 });
      } catch (e: any) {
        allOk = false;
        patch(id, { state: 'error', error: e?.message || 'بارگذاری انجام نشد؛ دوباره تلاش کنید.' });
      }
    });
    await Promise.all(jobs);
    if (allOk && closeOnDone) setTimeout(() => closeRef.current(), 650);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    run(Array.from(e.dataTransfer.files || []));
  };

  if (!mounted || !open) return null;
  return createPortal(
    <div className="pmodal-backdrop" onClick={onClose}>
      <div className="pmodal upd" role="dialog" aria-modal="true" aria-labelledby={tid} onClick={(e) => e.stopPropagation()}>
        <div className="pmodal-head">
          <div className="min-w-0">
            <div className="pmodal-title" id={tid}>{title}</div>
            {subtitle && <div className="upd-sub">{subtitle}</div>}
          </div>
          <button type="button" className="pmodal-x" onClick={onClose} aria-label="بستن">×</button>
        </div>
        <div className="pmodal-body">
          <div
            className={`upd-drop${drag ? ' is-drag' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
            onDrop={onDrop}
          >
            <svg className="upd-ico" viewBox="0 0 24 24" aria-hidden><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg>
            <div className="upd-big">برای بارگذاری، {multiple ? 'پرونده‌ها' : 'پرونده'} را اینجا بکشید</div>
            <div className="upd-or">یا</div>
            <div className="flex flex-wrap gap-2 justify-center">
              <button ref={pickRef} type="button" className="upd-pick" onClick={() => fileRef.current?.click()}>{multiple ? 'گزینش پرونده‌ها' : 'گزینش پرونده'}</button>
              {camera && <button type="button" className="upd-pick sm:hidden" onClick={() => camRef.current?.click()}>گرفتن عکس با دوربین</button>}
            </div>
            <input ref={fileRef} type="file" accept={accept} multiple={multiple} hidden
              onChange={(e) => { run(Array.from(e.target.files || [])); e.currentTarget.value = ''; }} />
            {camera && <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => { run(Array.from(e.target.files || [])); e.currentTarget.value = ''; }} />}
          </div>

          <p className="upd-hint">حداکثر اندازهٔ پرونده برای بارگذاری: {faN(maxMB)} مگابایت — قالب‌های مجاز: {acceptLabel(accept)}.</p>
          {note && <div className="upd-hint">{note}</div>}

          {items.length > 0 && (
            <div className="upd-list" aria-live="polite">
              {items.map((i) => i.state === 'error' ? (
                <div key={i.id} className="upd-notice">
                  <div className="min-w-0">
                    <div className="upd-notice-t">«<bdi>{i.name}</bdi>» بارگذاری نشد.</div>
                    <div className="upd-notice-r">{i.error}</div>
                  </div>
                  <button type="button" className="upd-dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))}>لغو</button>
                </div>
              ) : (
                <div key={i.id} className={`upd-row${i.state === 'done' ? ' is-done' : ''}`}>
                  {i.state === 'done'
                    ? <span className="upd-ok" aria-label="بارگذاری شد"><svg viewBox="0 0 24 24" aria-hidden><path d="M20 6L9 17l-5-5" /></svg></span>
                    : <ProgressRing pct={i.pct} eta={i.eta} />}
                  <div className="min-w-0">
                    <div className="upd-name"><bdi>{i.name}</bdi></div>
                    <div className="upd-state">{i.state === 'done' ? 'بارگذاری شد' : i.eta != null && i.pct < 1 ? `در حال بارگذاری — حدود ${faN(i.eta)} ثانیه مانده` : `در حال بارگذاری — ${faN(Math.round(i.pct * 100))}٪`}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CLIP = 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48';
const CHECK = 'M20 6L9 17l-5-5';

/**
 * One required document's upload control (مدارک مورد نیاز): an orange «?» with what to send, and a tile
 * with a paperclip and «افزودن تصویر مدارک» that opens the upload dialog. While the file goes up the
 * paperclip becomes the progress ring (with the time left); once uploaded it reads «جایگزینی فایل».
 */
export function DocUploadTile({
  label, onUpload, uploaded = false, rejected = false, required = true, help, accept = '.pdf,.jpg,.jpeg,.png', maxMB = 15,
  camera = true, disabled = false, compact = false, addText = 'افزودن تصویر مدارک',
}: {
  label: string; onUpload: UploadFn; uploaded?: boolean; rejected?: boolean; required?: boolean; help?: string;
  accept?: string; maxMB?: number; camera?: boolean; disabled?: boolean; compact?: boolean; addText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState<{ pct: number; eta: number | null } | null>(null);
  const [tip, setTip] = useState(false);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!tip) return;
    const off = (e: MouseEvent) => { if (!tipRef.current?.contains(e.target as Node)) setTip(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [tip]);

  const run: UploadFn = async (file, onP) => {
    setProg({ pct: 0, eta: null });
    try { await onUpload(file, (pct, eta) => { onP(pct, eta); setProg({ pct, eta }); }); }
    finally { setProg(null); }
  };

  const text = uploaded ? (rejected ? 'جایگزینی مدرک ردشده' : 'جایگزینی فایل') : addText;
  const helpText = help || `فایل PDF یا تصویر واضح (JPG، PNG) از «${label}» را بارگذاری کنید؛ حداکثر ${faN(maxMB)} مگابایت. روی گوشی می‌توانید مستقیم با دوربین عکس بگیرید.`;
  return (
    <span className={`dut${compact ? ' is-compact' : ''}`}>
      <span className="dut-help-w" ref={tipRef}>
        <button type="button" className="dut-help" aria-label={`راهنمای ${label}`} aria-expanded={tip} aria-controls={tipId} onClick={() => setTip((v) => !v)}>?</button>
        {tip && <span className="dut-tip" id={tipId} role="tooltip">{helpText}</span>}
      </span>
      <button type="button" className={`dut-tile${uploaded ? ' is-up' : ''}${rejected ? ' is-bad' : ''}`} disabled={disabled} onClick={() => setOpen(true)}
        aria-label={`${text} — ${label}`}>
        {prog ? <ProgressRing pct={prog.pct} eta={prog.eta} size={compact ? 30 : 36} />
          : <svg className="dut-ico" viewBox="0 0 24 24" aria-hidden><path d={uploaded && !rejected ? CHECK : CLIP} /></svg>}
        <span className="dut-t">{required && !uploaded && <span className="dut-req">* </span>}{prog ? 'در حال بارگذاری…' : text}</span>
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} onUpload={run} accept={accept} maxMB={maxMB} camera={camera}
        title={uploaded ? 'جایگزینی مدرک' : 'بارگذاری مدرک'} subtitle={label} />
    </span>
  );
}

/** A plain button that opens the upload dialog — for logos, import files, letters and other single uploads. */
export function UploadButton({ children, className = 'btn btn-ghost btn-sm', disabled, ...dialog }: {
  children: ReactNode; className?: string; disabled?: boolean;
  onUpload: UploadFn; accept: string; maxMB: number; title?: string; subtitle?: ReactNode; multiple?: boolean; camera?: boolean; note?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{children}</button>
      <UploadDialog {...dialog} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
