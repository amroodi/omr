'use client';
import { useState } from 'react';
import { client } from '../../../lib/client';
import { OrgNav } from '../nav';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

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

  const doPreview = async () => {
    if (!file) return;
    setError('');
    setLoading(true);
    setCommitted(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setPreview(await client.postForm<Preview>('/import/preview', fd, 'org'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doCommit = async () => {
    if (!file) return;
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setCommitted(await client.postForm('/import/commit', fd, 'org'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <OrgNav />
      <h1 className="text-lg font-bold mb-3">ورود دسته‌ای مشتریان (CSV / Excel)</h1>
      <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
        ستون‌ها: کد ملی، نام بیمه‌گذار، موبایل، شماره بیمه‌نامه (اختیاری)، شرکت بیمه (اختیاری).
      </p>
      {error && <div className="rounded-lg border p-2 text-sm mb-2" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}

      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div className="flex gap-2">
          <button onClick={doPreview} disabled={!file || loading} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>پیش‌نمایش و اعتبارسنجی</button>
          <button onClick={doCommit} disabled={!file || loading || !preview || preview.summary.valid === 0} className="rounded-lg bg-brand text-white px-3 py-1 text-sm disabled:opacity-50">ثبت ردیف‌های معتبر</button>
        </div>
      </div>

      {committed && (
        <div className="rounded-lg border p-3 mt-3 text-sm" style={{ borderColor: '#10b981' }}>
          ثبت شد: {committed.created} — رد شده: {committed.skipped}
        </div>
      )}

      {preview && (
        <div className="mt-3">
          <p className="text-sm mb-2">مجموع: {preview.summary.total} — معتبر: {preview.summary.valid} — نامعتبر: {preview.summary.invalid}</p>
          <div className="rounded-xl border overflow-x-auto" style={card}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--bg)' }}>
                {['ردیف', 'کد ملی', 'نام', 'موبایل', 'خطاها'].map((h) => (
                  <th key={h} className="p-2 text-right border-b" style={{ borderColor: 'var(--border)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-2">{r.row}</td>
                    <td className="p-2">{r.data.nationalCode}</td>
                    <td className="p-2">{r.data.fullName}</td>
                    <td className="p-2">{r.data.phone}</td>
                    <td className="p-2" style={{ color: r.errors.length ? '#ef4444' : '#10b981' }}>
                      {r.errors.length ? r.errors.join('، ') : 'معتبر'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
