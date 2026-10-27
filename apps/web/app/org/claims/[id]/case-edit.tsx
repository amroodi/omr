'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../../lib/client';
import { Icon } from '../../../components/Shell';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';
import { FieldRow, FieldsData, notesTone } from '../../../components/case-ui';
import { DocUploadTile, OnProgress } from '../../../components/upload';

/**
 * «ویرایش» of a case, after the operator forms (to-ui-editing 1–3): three columns (بیمه‌شده / بیمه‌نامه /
 * فوت) and then «مراحل اجرایی» in a three-wide grid. Values typed here are kept as drafts and stored
 * together with «ذخیره ویرایش»; fields filled by import or OCR arrive pre-filled from the server.
 */
const COLUMNS: { title: string; keys: string[] }[] = [
  { title: 'اطلاعات بیمه‌شده', keys: ['national_code', 'birth_date', 'full_name', 'company_name'] },
  { title: 'اطلاعات بیمه‌نامه', keys: ['policy_number', 'policy_start_date', 'death_capital', 'accident_capital', 'payable_amount'] },
  { title: 'اطلاعات فوت', keys: ['death_kind', 'death_date', 'cause_of_death', 'beneficiary_type', 'beneficiaries', 'beneficiary_iban'] },
];
const STEPS = [
  'case_stage', 'death_notice_date', 'death_notice_status', 'broker_to_insurer_date',
  'broker_to_insurer_status', 'docs_request_date', 'docs_request_status',
  'docs_receive_date', 'docs_receive_status', 'missing_docs_request_date',
  'missing_docs_request_status', 'case_complete', 'case_complete_date',
  'case_complete_status', 'send_to_hq_date', 'send_to_hq_status',
  'council_approve_date', 'council_approve_status', 'return_to_branch_date',
  'return_to_branch_status', 'payment_order_date', 'payment_order_status',
  'case_notes', 'payment_order', 'execution_stages',
];
const NOTES_PRESETS = ['منتظر تکمیل و ارسال مدارک', 'در حال بررسی', 'پرونده جهت بررسی و تایید به تهران ارسال شد', 'در دست پرداخت', 'پرداخت شده', 'غیر قابل پرداخت'];
const BENEFICIARY_FILE = 'BENEFICIARY_FILE';

const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const toAsciiNum = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d]/g, '');
const groupFa = (raw: string) => { const a = toAsciiNum(raw); return a ? faD(a.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : ''; };

export function CaseEditForm({ claimId, title, onSaved }: { claimId: string; title: string; onSaved: () => void }) {
  const [data, setData] = useState<FieldsData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [benFile, setBenFile] = useState<{ id: string; fileName: string } | null>(null);

  const load = async () => {
    const d = await client.get<FieldsData>(`/claims/${claimId}/fields`, 'org');
    setData(d);
    const dr: Record<string, string> = {};
    Object.values(d.groups).flat().forEach((f) => { dr[f.key] = f.value ?? ''; });
    setDrafts(dr); setErrors({});
    const docs = await client.get<{ id: string; docCode: string | null; fileName: string }[]>(`/claims/${claimId}/documents`, 'org').catch(() => []);
    const b = docs.find((x) => x.docCode === BENEFICIARY_FILE);
    setBenFile(b ? { id: b.id, fileName: b.fileName } : null);
  };
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: e.message })); /* eslint-disable-next-line */ }, [claimId]);

  if (!data) return null;
  const all = Object.values(data.groups).flat();
  const byKey = Object.fromEntries(all.map((f) => [f.key, f]));
  const placed = new Set([...COLUMNS.flatMap((c) => c.keys), ...STEPS]);
  const others = all.filter((f) => !placed.has(f.key));

  // Changed fields, plus values the server pre-filled from the case itself (source CLAIM) so they get stored.
  const dirty = all.filter((f) => f.canEdit && ((drafts[f.key] ?? '') !== (f.value ?? '') || (f.source === 'CLAIM' && (drafts[f.key] ?? '') !== '')));

  const save = async () => {
    setBusy(true); setMsg(null);
    const errs: Record<string, string> = {};
    for (const f of dirty) {
      try { await client.put(`/claims/${claimId}/fields/${f.key}`, { value: drafts[f.key] ?? '' }, 'org'); }
      catch (e: any) { errs[f.key] = e.message; }
    }
    setBusy(false);
    if (Object.keys(errs).length) { setErrors(errs); setMsg({ ok: false, text: `${Object.keys(errs).length.toLocaleString('fa-IR')} فیلد ذخیره نشد؛ خطاها کنار هر فیلد نوشته شده است.` }); return; }
    setMsg({ ok: true, text: 'تغییرات ذخیره شد' });
    await load(); onSaved();
  };
  const cancel = () => { const dr: Record<string, string> = {}; all.forEach((f) => { dr[f.key] = f.value ?? ''; }); setDrafts(dr); setErrors({}); setMsg(null); };

  // From the upload dialog, which shows the progress and any error itself.
  const uploadBen = async (file: File, onProgress: OnProgress) => {
    setMsg(null);
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/claims/${claimId}/documents?docCode=${BENEFICIARY_FILE}`, fd, 'org', onProgress);
    await load();
    setMsg({ ok: true, text: 'فایل ذینفع بارگذاری شد' });
  };

  const input = (f: FieldRow) => {
    const v = drafts[f.key] ?? '';
    const set = (x: string) => setDrafts((d) => ({ ...d, [f.key]: x }));
    const dis = !f.canEdit || busy;
    if (f.key === 'case_notes') {
      return (
        <>
          <input className={`input ce-notes tone-${notesTone(v)}`} list="ce-notes-list" value={v} disabled={dis} onChange={(e) => set(e.target.value)} placeholder="توضیحات پرونده" />
          <datalist id="ce-notes-list">{NOTES_PRESETS.map((o) => <option key={o} value={o} />)}</datalist>
          <p className="ce-hint"><b>رنگ‌بندی خودکار:</b> پرداخت شده (سبز)، در حال بررسی (زرد)، غیر قابل پرداخت (قرمز)، سایر (خاکستری)</p>
        </>
      );
    }
    if (f.key === 'beneficiary_type') {
      return (
        <select className="input ce-narrow" value={v} disabled={dis} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {(f.options.includes(v) || !v ? f.options : [v, ...f.options]).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (f.type === 'DATE') return dis ? <input className="input" readOnly value={v ? faD(v) : ''} placeholder={f.label} /> : <JalaliDatePicker value={v} onChange={set} placeholder={f.label} />;
    if (f.type === 'AMOUNT') return <input className="input" inputMode="numeric" value={groupFa(v)} disabled={dis} onChange={(e) => set(toAsciiNum(e.target.value))} placeholder={f.label} style={{ direction: 'ltr', textAlign: 'right' }} />;
    if (f.type === 'NATIONAL_CODE' || f.type === 'NUMBER') return <input className="input" inputMode="numeric" value={faD(toAsciiNum(v))} disabled={dis} onChange={(e) => set(toAsciiNum(e.target.value))} placeholder={f.label} style={{ direction: 'ltr', textAlign: 'right' }} />;
    if (f.type === 'SELECT') {
      return (
        <>
          <input className="input" list={`ce-${f.key}`} value={v} disabled={dis} onChange={(e) => set(e.target.value)} placeholder={f.label} />
          <datalist id={`ce-${f.key}`}>{f.options.map((o) => <option key={o} value={o} />)}</datalist>
        </>
      );
    }
    if (f.key === 'beneficiaries' || f.key === 'execution_stages') return <textarea className="input" rows={2} value={v} disabled={dis} onChange={(e) => set(e.target.value)} placeholder={f.label} />;
    return <input className="input" value={v} disabled={dis} onChange={(e) => set(e.target.value)} placeholder={f.label} style={f.type === 'IBAN' ? { direction: 'ltr', textAlign: 'right' } : undefined} />;
  };

  const cell = (key: string) => {
    const f = byKey[key];
    if (!f) return null;
    return (
      <div key={key} className={`ce-field${key === 'case_notes' ? ' is-notes' : ''}`}>
        <label className="ce-label"><span className="ce-dot" />{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
        {input(f)}
        {errors[key] && <div className="ce-err">{errors[key]}</div>}
      </div>
    );
  };

  return (
    <div className="ce-wrap">
      <h2 className="ce-title">ویرایش: {title}</h2>
      {data?.manual && (
        <div className="alert-success mb-4 text-sm">
          تکمیل دستی پرونده فعال است: همهٔ فیلدها، از جمله وضعیت‌های ستاد، شورای فنی و حوالهٔ پرداخت، را می‌توانید خودتان پر کنید.
          با ثبت «وضعیت حواله پرداخت: پرداخت شد» پرونده پرداخت‌شده و با «وضعیت تایید شورای فنی: رد شد» ردشده بسته می‌شود؛ «پرونده تایید شد» یا «حواله پرداخت ثبت شد» آن را تاییدشده می‌کند.
          گردش کار عادی سلسله‌مراتب هم‌زمان برقرار است.
        </div>
      )}

      <div className="ce-cols">
        {COLUMNS.map((col) => (
          <div key={col.title} className="ce-col">
            <div className="ce-head">{col.title}</div>
            {col.keys.map(cell)}
            {col.title === 'اطلاعات فوت' && (
              <div className="ce-field">
                <label className="ce-label"><span className="ce-dot" />بارگذاری فایل PDF/EXCEL ذینفع</label>
                <div><DocUploadTile label="فایل PDF/EXCEL ذینفع" addText="افزودن فایل ذینفع" required={false} uploaded={!!benFile} disabled={busy} accept=".pdf,.doc,.docx,.xlsx,.xls" camera={false}
                  help="فهرست ذینفعان را به صورت فایل PDF، Word یا اکسل بارگذاری کنید؛ حداکثر ۱۵ مگابایت." onUpload={uploadBen} /></div>
                {benFile && (
                  <button type="button" className="ce-link" onClick={() => client.download(`/claims/${claimId}/documents/${benFile.id}/file`, 'org', benFile.fileName).catch((e) => setMsg({ ok: false, text: e.message }))}>
                    دانلود فایل فعلی
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ce-head ce-head-wide">مراحل اجرایی</div>
      <div className="ce-grid">{STEPS.map(cell)}</div>

      {others.length > 0 && (
        <>
          <div className="ce-head ce-head-wide">سایر فیلدها</div>
          <div className="ce-grid">{others.map((f) => cell(f.key))}</div>
        </>
      )}

      {msg && <div className={msg.ok ? 'alert-success mt-4' : 'alert-error mt-4'}>{msg.text}</div>}
      <div className="ce-btns">
        <button type="button" className="ce-save" onClick={save} disabled={busy || dirty.length === 0}>
          <Icon path="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8" />
          {busy ? 'در حال ذخیره…' : 'ذخیره ویرایش'}
        </button>
        <button type="button" className="ce-cancel" onClick={cancel} disabled={busy}><Icon path="M18 6L6 18M6 6l12 12" /> انصراف</button>
      </div>
    </div>
  );
}
