'use client';
import { useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Preview {
  summary: { total: number; valid: number; invalid: number };
  rows: { row: number; data: Record<string, string>; errors: string[] }[];
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [committed, setCommitted] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const upload = async (path: string, set: (v: any) => void) => {
    if (!file) return;
    setError(''); setLoading(true);
    try { const fd = new FormData(); fd.append('file', file); set(await client.postForm(path, fd, 'org')); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <Shell title="ورود دسته‌ای مشتریان" subtitle="بارگذاری فایل CSV یا Excel با اعتبارسنجی پیش از ثبت" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <div className="card p-5 space-y-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          ستون‌های پشتیبانی‌شده: کد ملی، نام بیمه‌گذار، موبایل، شماره بیمه‌نامه (اختیاری)، شرکت بیمه (اختیاری).
        </p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setCommitted(null); }} className="input" />
        <div className="flex gap-2">
          <button onClick={() => upload('/import/preview', setPreview)} disabled={!file || loading} className="btn btn-ghost btn-sm">پیش‌نمایش و اعتبارسنجی</button>
          <button onClick={() => upload('/import/commit', setCommitted)} disabled={!file || loading || !preview || preview.summary.valid === 0} className="btn btn-primary btn-sm">ثبت ردیف‌های معتبر</button>
        </div>
      </div>

      {committed && <div className="alert-success mt-3">ثبت شد: {committed.created} — رد شده: {committed.skipped}</div>}

      {preview && (
        <div className="mt-4">
          <div className="flex gap-2 mb-3">
            <span className="badge badge-neutral">کل: {preview.summary.total}</span>
            <span className="badge badge-success">معتبر: {preview.summary.valid}</span>
            <span className="badge badge-danger">نامعتبر: {preview.summary.invalid}</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr>{['ردیف', 'کد ملی', 'نام', 'موبایل', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.data.nationalCode}</td>
                    <td>{r.data.fullName}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.data.phone}</td>
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
