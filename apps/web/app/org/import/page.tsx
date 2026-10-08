'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Row {
  row: number;
  kind: 'CLAIM' | 'PERSON';
  claimStatus?: string;
  data: Record<string, string>;
  errors: string[];
}
interface Preview {
  summary: { total: number; claims: number; people: number; invalid: number };
  rows: Row[];
}

const CLAIM_STATUS_LABEL: Record<string, string> = {
  PAID: 'پرداخت شده', REJECTED: 'رد شده', APPROVED: 'تایید شده', UNDER_REVIEW: 'در حال بررسی',
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [insurerId, setInsurerId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [committed, setCommitted] = useState<{ claimsCreated: number; peopleCreated: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch(() => {});
  }, []);

  const doPreview = async () => {
    if (!file) return;
    setError(''); setLoading(true); setCommitted(null);
    try { const fd = new FormData(); fd.append('file', file); setPreview(await client.postForm('/import/preview', fd, 'org')); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const doCommit = async () => {
    if (!file) return;
    if ((preview?.summary.claims ?? 0) > 0 && !insurerId) { setError('برای ثبت پرونده‌ها ابتدا بیمه‌گر را انتخاب کنید'); return; }
    setError(''); setLoading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const q = insurerId ? `?insurerTenantId=${encodeURIComponent(insurerId)}` : '';
      setCommitted(await client.postForm(`/import/commit${q}`, fd, 'org'));
      setPreview(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const hasClaims = (preview?.summary.claims ?? 0) > 0;

  return (
    <Shell title="ورود دسته‌ای" subtitle="بارگذاری فایل CSV یا Excel — پرونده‌های مختومه به‌صورت سابقه و بقیه به‌صورت بیمه‌شده ثبت می‌شوند" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <div className="card p-5 space-y-3">
        <div className="text-sm space-y-1" style={{ color: 'var(--muted)' }}>
          <p>سیستم به‌صورت هوشمند هر ردیف را تشخیص می‌دهد:</p>
          <ul className="mr-5 list-disc">
            <li>ردیف‌هایی که <b>وضعیت پرونده نهایی</b> دارند (مثل «پرداخت شده» / «رد شده») به‌عنوان <b>پرونده سابقه</b> (بایگانی برای پیگیری) وارد می‌شوند.</li>
            <li>بقیه ردیف‌ها فقط به‌عنوان <b>بیمه‌شده</b> (دفترچه اطلاعات) ثبت می‌شوند.</li>
          </ul>
          <p>ستون‌های پشتیبانی‌شده: کد ملی، نام و نام خانوادگی، موبایل، شماره بیمه‌نامه، سرمایه فوت، تاریخ فوت، علت فوت، مبلغ قابل پرداخت، نوع ذینفع، وضعیت پرونده، نام شرکت محل فعالیت، تاریخ تولد و…</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold block mb-1">بیمه‌گر (برای پرونده‌های سابقه)</label>
            <select className="input" value={insurerId} onChange={(e) => setInsurerId(e.target.value)}>
              <option value="">— انتخاب بیمه‌گر —</option>
              {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1">فایل</label>
            <input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setCommitted(null); }} className="input" />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={doPreview} disabled={!file || loading} className="btn btn-ghost btn-sm">پیش‌نمایش و اعتبارسنجی</button>
          <button onClick={doCommit} disabled={!file || loading || !preview || (preview.summary.claims + preview.summary.people) === 0 || (hasClaims && !insurerId)} className="btn btn-primary btn-sm">ثبت ردیف‌های معتبر</button>
        </div>
        {hasClaims && !insurerId && <p className="text-xs" style={{ color: 'var(--danger)' }}>این فایل شامل پرونده‌های مختومه است؛ برای ثبت آن‌ها انتخاب بیمه‌گر الزامی است.</p>}
      </div>

      {committed && (
        <div className="alert-success mt-3">
          ثبت شد — پرونده سابقه: {committed.claimsCreated}، بیمه‌شده: {committed.peopleCreated}، نادیده‌گرفته: {committed.skipped}
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <div className="flex gap-2 mb-3 flex-wrap">
            <span className="badge badge-neutral">کل: {preview.summary.total}</span>
            <span className="badge badge-info">پرونده سابقه: {preview.summary.claims}</span>
            <span className="badge badge-success">بیمه‌شده: {preview.summary.people}</span>
            <span className="badge badge-danger">نامعتبر: {preview.summary.invalid}</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr>{['ردیف', 'نوع', 'کد ملی', 'نام', 'تاریخ فوت', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      {r.kind === 'CLAIM'
                        ? <span className="badge badge-info">پرونده{r.claimStatus ? ` — ${CLAIM_STATUS_LABEL[r.claimStatus] || r.claimStatus}` : ''}</span>
                        : <span className="badge badge-neutral">بیمه‌شده</span>}
                    </td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.data.nationalCode}</td>
                    <td>{r.data.fullName}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.data.deathDate || '—'}</td>
                    <td>{r.errors.length ? <span className="badge badge-danger">{r.errors.join('، ')}</span> : <span className="badge badge-success">معتبر</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
