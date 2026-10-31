'use client';
import { useEffect, useState } from 'react';
import { client, Realm } from '../../lib/client';
import { UploadButton } from './upload';

/**
 * «ذینفع / وراث قانونی»: when the deceased filled a beneficiary (inheritance) form, the filer uploads
 * the form (into the checklist's «فرم تعیین ذینفع» slot) and types each person's name and شبا.
 * `HeirsFields` sits in every filing form; `HeirsCard` shows (and lets the right people edit) them on the case.
 */
export const BENEFICIARY_FORM = 'beneficiary_form'; // required document «اصل فرم تعیین ذینفع»
export const BENEFICIARY_KINDS = ['ذینفع قانونی', 'وراث قانونی'];
const FORM_ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx';

export interface HeirRow { fullName: string; iban: string }
export interface HeirsValue { beneficiaryType: string; hasForm: boolean; file: File | null; heirs: HeirRow[] }
export const EMPTY_HEIRS: HeirsValue = { beneficiaryType: '', hasForm: false, file: null, heirs: [{ fullName: '', iban: '' }] };

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
const filled = (rows: HeirRow[]) => rows.filter((h) => h.fullName.trim() || h.iban.trim());

/** Why the section can't be sent yet (null = fine). */
export function heirsProblem(v: HeirsValue, needFile = true): string | null {
  if (!v.hasForm) return null;
  if (needFile && !v.file) return 'فرم تعیین ذینفع / وراث را بارگذاری کنید.';
  const rows = filled(v.heirs);
  if (!rows.length) return 'نام و شماره شبای دست‌کم یک ذینفع / وارث را بنویسید.';
  for (const h of rows) {
    if (h.fullName.trim().length < 2) return 'نام هر ذینفع / وارث را بنویسید.';
    if (!ibanOk(h.iban)) return `شماره شبای «${h.fullName.trim()}» نامعتبر است (IR و ۲۴ رقم).`;
  }
  return null;
}

/** The part of the filing request: kind + people (only when the form was filled). */
export function heirsBody(v: HeirsValue): { beneficiaryType?: string; heirs?: HeirRow[] } {
  return {
    ...(v.beneficiaryType ? { beneficiaryType: v.beneficiaryType } : {}),
    ...(v.hasForm ? { heirs: filled(v.heirs).map((h) => ({ fullName: h.fullName.trim(), iban: normIban(h.iban) })) } : {}),
  };
}

/** After the case is created: upload the form into its «فایل ذینفع» slot. */
export async function uploadHeirsForm(v: HeirsValue, claimId: string, realm: Realm) {
  if (!v.hasForm || !v.file) return;
  const fd = new FormData(); fd.append('file', v.file);
  await client.upload(`${realm === 'customer' ? '/customer/claims' : '/claims'}/${claimId}/documents?docCode=${BENEFICIARY_FORM}`, fd, realm, () => {});
}

/** Name + شبا rows with add / remove. */
function HeirRows({ rows, onChange, disabled }: { rows: HeirRow[]; onChange: (rows: HeirRow[]) => void; disabled?: boolean }) {
  const set = (i: number, k: keyof HeirRow, x: string) => onChange(rows.map((h, j) => (j === i ? { ...h, [k]: x } : h)));
  return (
    <div className="space-y-2">
      {rows.map((h, i) => {
        const bad = h.iban.trim().length >= 10 && !ibanOk(h.iban);
        return (
          <div key={i} className="grid gap-2 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr) auto' }}>
            <input className="input" value={h.fullName} disabled={disabled} onChange={(e) => set(i, 'fullName', e.target.value)} placeholder={`نام و نام خانوادگی ذینفع ${(i + 1).toLocaleString('fa-IR')}`} maxLength={120} />
            <div>
              <input className="input latin-digits" value={h.iban} disabled={disabled} onChange={(e) => set(i, 'iban', e.target.value)} placeholder="شماره شبا: IR000000000000000000000000" maxLength={34}
                style={{ direction: 'ltr', textAlign: 'right', ...(bad ? { borderColor: 'var(--danger)' } : {}) }} />
              {bad && <div className="text-xs mt-1" style={{ color: 'var(--danger)' }}>شماره شبا نامعتبر است</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="حذف این ردیف" style={{ color: 'var(--danger)' }}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || rows.length >= 30} onClick={() => onChange([...rows, { fullName: '', iban: '' }])}>+ افزودن ذینفع / وارث</button>
    </div>
  );
}

/** Section of a filing form. `cameraOnly`: on a phone the form is photographed (بیمه‌گزار panel). */
export function HeirsFields({ value, onChange, cameraOnly = false }: { value: HeirsValue; onChange: (v: HeirsValue) => void; cameraOnly?: boolean }) {
  const [phone, setPhone] = useState(false);
  useEffect(() => { if (cameraOnly) setPhone(window.matchMedia('(max-width: 639px)').matches); }, [cameraOnly]);
  const set = (p: Partial<HeirsValue>) => onChange({ ...value, ...p });
  return (
    <div className="mt-6 rounded-xl p-4 md:p-5" style={{ border: '1px solid var(--border)' }}>
      <h3 className="font-extrabold mb-3">ذینفع / وراث قانونی</h3>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label">نوع ذینفع</label>
          <select className="input" value={value.beneficiaryType} onChange={(e) => set({ beneficiaryType: e.target.value })}>
            <option value="">— تعیین نشده —</option>
            {BENEFICIARY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold self-end pb-2 cursor-pointer">
          <input type="checkbox" checked={value.hasForm} onChange={(e) => set({ hasForm: e.target.checked })} />
          متوفی فرم تعیین ذینفع / وراث را تکمیل کرده است
        </label>
      </div>
      {value.hasForm && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">فرم تعیین ذینفع / وراث *</label>
            <input type="file" className="input" accept={phone ? 'image/*' : FORM_ACCEPT} {...(phone ? { capture: 'environment' as const } : {})}
              onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{phone ? 'از فرم با دوربین عکس بگیرید.' : 'PDF، تصویر یا Word؛ پس از ثبت، در ردیف «فرم تعیین ذینفع» مدارک پرونده قرار می‌گیرد.'}</p>
          </div>
          <div>
            <label className="label">نام و شماره شبای هر ذینفع / وارث *</label>
            <HeirRows rows={value.heirs} onChange={(heirs) => set({ heirs })} />
          </div>
        </div>
      )}
    </div>
  );
}

interface HeirsData { beneficiaryType: string | null; canEdit: boolean; form: { id: string; fileName: string } | null; heirs: { id: string; fullName: string; iban: string }[] }

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
    const bad = rows.find((h) => h.fullName.trim().length < 2 || !ibanOk(h.iban));
    if (bad) return setError(bad.fullName.trim().length < 2 ? 'نام هر ذینفع / وارث را بنویسید.' : `شماره شبای «${bad.fullName.trim()}» نامعتبر است.`);
    setBusy(true); setError('');
    try {
      setD(await client.put<HeirsData>(`${base}/heirs`, { beneficiaryType: edit.beneficiaryType || undefined, heirs: rows.map((h) => ({ fullName: h.fullName.trim(), iban: normIban(h.iban) })) }, realm));
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setEdit({ beneficiaryType: d.beneficiaryType ?? '', heirs: d.heirs.length ? d.heirs.map((h) => ({ fullName: h.fullName, iban: h.iban })) : [{ fullName: '', iban: '' }] }); }}>ویرایش ذینفعان</button>
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
            <thead><tr><th style={{ width: 40 }}>#</th><th>نام و نام خانوادگی</th><th>شماره شبا</th></tr></thead>
            <tbody>
              {d.heirs.map((h, i) => (
                <tr key={h.id}><td>{(i + 1).toLocaleString('fa-IR')}</td><td>{h.fullName}</td><td className="latin-digits" style={{ direction: 'ltr', textAlign: 'right' }}>{h.iban}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
