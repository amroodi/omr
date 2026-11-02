'use client';
import { useEffect, useState } from 'react';
import { client, Realm } from '../../lib/client';
import { UploadButton } from './upload';

/**
 * «فرم تعیین/تغییر ذینفع» on a case: دارد → the form and each ذینفع (name, کد ملی, شبا);
 * ندارد → the انحصار وراثت certificate. The choice is `beneficiaryType`, and the API takes the other
 * document off the checklist. `BeneficiaryChoice` sits in the بیمه‌گزار's checklist, `HeirsCard` on the staff case page.
 */
export const BENEFICIARY_FORM = 'beneficiary_form'; // required document «فرم تعیین/تغییر ذینفع»
export const INHERITANCE_CERT = 'inheritance_cert'; // required document «گواهی انحصار وراثت»
const HAS_FORM = 'ذینفع قانونی'; const NO_FORM = 'وراث قانونی';
export const BENEFICIARY_KINDS = [HAS_FORM, NO_FORM];
const FORM_ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx';

export interface HeirRow { fullName: string; nationalCode: string; iban: string }
const EMPTY_ROW: HeirRow = { fullName: '', nationalCode: '', iban: '' };

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** «IR06 2960 …», Persian digits or the 24 digits alone → «IR» + 24 digits. */
export const normIban = (s: string) => {
  const a = toAscii(s).replace(/[\s-]/g, '').toUpperCase();
  return /^\d{24}$/.test(a) ? `IR${a}` : a;
};
/** Iranian شبا: IR + 24 digits, ISO 13616 mod-97 checksum (the server checks it again). */
export function ibanOk(input: string): boolean {
  const s = normIban(input);
  if (!/^IR\d{24}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of r) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
/** کد ملی checksum (the server checks it again). */
export function nationalCodeOk(input: string): boolean {
  const c = toAscii(input).trim();
  if (!/^\d{10}$/.test(c) || /^(\d)\1{9}$/.test(c)) return false;
  const sum = c.slice(0, 9).split('').reduce((t, d, i) => t + Number(d) * (10 - i), 0);
  const r = sum % 11;
  return Number(c[9]) === (r < 2 ? r : 11 - r);
}
const filled = (rows: HeirRow[]) => rows.filter((h) => h.fullName.trim() || h.iban.trim() || h.nationalCode.trim());
/** Why these rows can't be saved (null = fine). */
function rowsProblem(rows: HeirRow[]): string | null {
  for (const h of rows) {
    if (h.fullName.trim().length < 2) return 'نام و نام خانوادگی هر ذینفع را بنویسید.';
    if (!nationalCodeOk(h.nationalCode)) return `کد ملی «${h.fullName.trim()}» نامعتبر است.`;
    if (!ibanOk(h.iban)) return `شماره شبای «${h.fullName.trim()}» نامعتبر است (IR و ۲۴ رقم).`;
  }
  return null;
}
const rowsBody = (rows: HeirRow[]) => rows.map((h) => ({ fullName: h.fullName.trim(), nationalCode: toAscii(h.nationalCode).trim(), iban: normIban(h.iban) }));

/** Name, کد ملی + شبا rows with add / remove. */
function HeirRows({ rows, onChange, disabled }: { rows: HeirRow[]; onChange: (rows: HeirRow[]) => void; disabled?: boolean }) {
  const set = (i: number, k: keyof HeirRow, x: string) => onChange(rows.map((h, j) => (j === i ? { ...h, [k]: x } : h)));
  return (
    <div className="space-y-2">
      {rows.map((h, i) => {
        const badIban = h.iban.trim().length >= 10 && !ibanOk(h.iban);
        const badCode = h.nationalCode.trim().length >= 10 && !nationalCodeOk(h.nationalCode);
        const ltr = { direction: 'ltr', textAlign: 'right' } as const;
        return (
          <div key={i} className="grid gap-2 items-start grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1.3fr)_auto]">
            <input className="input" value={h.fullName} disabled={disabled} onChange={(e) => set(i, 'fullName', e.target.value)} placeholder="نام و نام خانوادگی" maxLength={120} />
            <div>
              <input className="input latin-digits" value={h.nationalCode} disabled={disabled} onChange={(e) => set(i, 'nationalCode', e.target.value)} placeholder="کد ملی" inputMode="numeric" maxLength={10}
                style={{ ...ltr, ...(badCode ? { borderColor: 'var(--danger)' } : {}) }} />
              {badCode && <div className="text-xs mt-1" style={{ color: 'var(--danger)' }}>کد ملی نامعتبر است</div>}
            </div>
            <div>
              <input className="input latin-digits" value={h.iban} disabled={disabled} onChange={(e) => set(i, 'iban', e.target.value)} placeholder="شماره شبا: IR000000000000000000000000" maxLength={34}
                style={{ ...ltr, ...(badIban ? { borderColor: 'var(--danger)' } : {}) }} />
              {badIban && <div className="text-xs mt-1" style={{ color: 'var(--danger)' }}>شماره شبا نامعتبر است</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="حذف این ردیف" style={{ color: 'var(--danger)' }}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || rows.length >= 30} onClick={() => onChange([...rows, { ...EMPTY_ROW }])}>+ افزودن ذینفع</button>
    </div>
  );
}

interface HeirsData { beneficiaryType: string | null; canEdit: boolean; form: { id: string; fileName: string } | null; heirs: { id: string; fullName: string; nationalCode: string; iban: string }[] }

/**
 * In the checklist's beneficiary row: asks دارد / ندارد; on دارد also takes each ذینفع.
 * `onChosen` reloads the checklist, `onMissing` tells the page that دارد was chosen with nobody saved yet.
 */
export function BeneficiaryChoice({ claimId, realm, onChosen, onMissing }: { claimId: string; realm: Realm; onChosen: () => void; onMissing?: (missing: boolean) => void }) {
  const base = `${realm === 'customer' ? '/customer/claims' : '/claims'}/${claimId}`;
  const [d, setD] = useState<HeirsData | null>(null);
  const [rows, setRows] = useState<HeirRow[]>([{ ...EMPTY_ROW }]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const show = (x: HeirsData) => {
    setD(x); setDirty(false);
    setRows(x.heirs.length ? x.heirs.map((h) => ({ fullName: h.fullName, nationalCode: h.nationalCode, iban: h.iban })) : [{ ...EMPTY_ROW }]);
    onMissing?.(x.beneficiaryType === HAS_FORM && x.heirs.length === 0);
  };
  useEffect(() => { client.get<HeirsData>(`${base}/heirs`, realm).then(show).catch(() => setD(null)); /* eslint-disable-next-line */ }, [claimId]);
  if (!d) return null;

  const put = async (beneficiaryType: string, list: HeirRow[]) => {
    setBusy(true); setError('');
    try { show(await client.put<HeirsData>(`${base}/heirs`, { beneficiaryType, heirs: rowsBody(list) }, realm)); onChosen(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const choose = (kind: string) => {
    if (kind === d.beneficiaryType) return;
    if (kind === NO_FORM && d.heirs.length && !window.confirm('ذینفعان ثبت‌شده حذف می‌شوند. ادامه می‌دهید؟')) return;
    put(kind, kind === NO_FORM ? [] : filled(rows).filter((h) => !rowsProblem([h])));
  };
  const save = () => {
    const list = filled(rows);
    const problem = list.length ? rowsProblem(list) : 'مشخصات دست‌کم یک ذینفع را بنویسید.';
    if (problem) return setError(problem);
    put(HAS_FORM, list);
  };

  return (
    <div className="mt-3 space-y-3 text-sm">
      {error && <div className="alert-error">{error}</div>}
      {d.canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <b>فرم تعیین/تغییر ذینفع:</b>
          {[[HAS_FORM, 'دارد'], [NO_FORM, 'ندارد']].map(([k, l]) => (
            <button key={k} type="button" disabled={busy} onClick={() => choose(k)} className={`btn btn-sm ${d.beneficiaryType === k ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={d.beneficiaryType === k}>{l}</button>
          ))}
        </div>
      )}
      {d.beneficiaryType === HAS_FORM && (d.canEdit ? (
        <div className="space-y-2">
          <div className="font-bold">مشخصات ذینفعان *</div>
          <HeirRows rows={rows} onChange={(r) => { setRows(r); setDirty(true); onMissing?.(true); }} disabled={busy} />
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>{busy ? '…' : dirty ? 'ذخیرهٔ ذینفعان' : 'ذخیره شد'}</button>
        </div>
      ) : d.heirs.length > 0 && (
        <ul className="space-y-1">{d.heirs.map((h) => <li key={h.id}>{h.fullName} — <bdi className="latin-digits">{h.nationalCode}</bdi> — <bdi className="latin-digits">{h.iban}</bdi></li>)}</ul>
      ))}
    </div>
  );
}

/** On the case: kind, the form and the people; edit + re-upload for whoever may change them. */
export function HeirsCard({ claimId, realm, className = 'card p-4' }: { claimId: string; realm: Realm; className?: string }) {
  const base = `${realm === 'customer' ? '/customer/claims' : '/claims'}/${claimId}`;
  const [d, setD] = useState<HeirsData | null>(null);
  const [edit, setEdit] = useState<{ beneficiaryType: string; heirs: HeirRow[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => client.get<HeirsData>(`${base}/heirs`, realm).then(setD).catch(() => setD(null));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [claimId]);

  if (!d || (!d.beneficiaryType && !d.heirs.length && !d.form && !d.canEdit)) return null;
  const save = async () => {
    if (!edit) return;
    const rows = filled(edit.heirs);
    const problem = rowsProblem(rows);
    if (problem) return setError(problem);
    setBusy(true); setError('');
    try {
      setD(await client.put<HeirsData>(`${base}/heirs`, { beneficiaryType: edit.beneficiaryType || undefined, heirs: rowsBody(rows) }, realm));
      setEdit(null);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-extrabold">ذینفع / وراث قانونی{d.beneficiaryType ? <span className="badge badge-info mr-2">{d.beneficiaryType}</span> : null}</h3>
        {d.canEdit && !edit && (
          <div className="flex gap-2 no-print">
            <UploadButton accept={FORM_ACCEPT} maxMB={15} title="فرم تعیین ذینفع / وراث" camera cameraOnly={realm === 'customer'}
              onUpload={async (file, onP) => { const fd = new FormData(); fd.append('file', file); await client.upload(`${base}/documents?docCode=${BENEFICIARY_FORM}`, fd, realm, onP); await load(); }}>
              {d.form ? 'بارگذاری دوبارهٔ فرم' : 'بارگذاری فرم'}
            </UploadButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setEdit({ beneficiaryType: d.beneficiaryType ?? '', heirs: d.heirs.length ? d.heirs.map((h) => ({ fullName: h.fullName, nationalCode: h.nationalCode, iban: h.iban })) : [{ ...EMPTY_ROW }] }); }}>ویرایش ذینفعان</button>
          </div>
        )}
      </div>
      {error && <div className="alert-error mb-3 text-sm">{error}</div>}
      <div className="text-sm mb-3 flex items-center gap-2 flex-wrap">
        <b>فرم تعیین ذینفع / وراث:</b>
        {d.form
          ? <button type="button" className="underline" style={{ color: 'var(--brand)' }} onClick={() => client.view(`${base}/documents/${d.form!.id}/file`, realm).catch((e) => setError(e.message))}><bdi>{d.form.fileName}</bdi></button>
          : <span style={{ color: 'var(--muted)' }}>بارگذاری نشده</span>}
      </div>
      {edit ? (
        <div className="space-y-3">
          <div className="max-w-xs">
            <label className="label">نوع ذینفع</label>
            <select className="input" value={edit.beneficiaryType} onChange={(e) => setEdit({ ...edit, beneficiaryType: e.target.value })}>
              <option value="">— تعیین نشده —</option>
              {[...new Set([...BENEFICIARY_KINDS, ...(edit.beneficiaryType ? [edit.beneficiaryType] : [])])].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <HeirRows rows={edit.heirs} onChange={(heirs) => setEdit({ ...edit, heirs })} disabled={busy} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? '…' : 'ذخیره'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)} disabled={busy}>انصراف</button>
          </div>
        </div>
      ) : d.heirs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>ذینفع / وارثی ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table text-sm w-full">
            <thead><tr><th style={{ width: 40 }}>#</th><th>نام و نام خانوادگی</th><th>کد ملی</th><th>شماره شبا</th></tr></thead>
            <tbody>
              {d.heirs.map((h, i) => (
                <tr key={h.id}><td>{(i + 1).toLocaleString('fa-IR')}</td><td>{h.fullName}</td><td className="latin-digits" style={{ direction: 'ltr', textAlign: 'right' }}>{h.nationalCode || '—'}</td><td className="latin-digits" style={{ direction: 'ltr', textAlign: 'right' }}>{h.iban}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
