'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { OrgNav } from './nav';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };
const STATUS = [
  { v: '', l: 'همه وضعیت‌ها' },
  { v: 'REVIEWING', l: 'در حال بررسی' },
  { v: 'PAID', l: 'پرداخت شده' },
  { v: 'UNPAYABLE', l: 'غیرقابل پرداخت' },
  { v: 'OTHER', l: 'سایر' },
];

interface CaseRow {
  id: string;
  caseNumber: string;
  status: string;
  insuredName: string | null;
  nationalCode: string | null;
  policyNumber: string | null;
  stageDate: string | null;
  paidAt: string | null;
}

export default function OrgCases() {
  const router = useRouter();
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const r = await client.get<{ items: CaseRow[]; total: number }>(`/cases?${params}`, 'org');
      setRows(r.items);
      setTotal(r.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getToken('org')) {
      router.push('/org/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportXlsx = () =>
    client.download(`/exports/cases.xlsx${status ? `?status=${status}` : ''}`, 'org', 'cases.xlsx').catch((e) => setError(e.message));

  return (
    <div>
      <OrgNav />
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <h1 className="text-lg font-bold">پرونده‌ها ({total})</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border p-1 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }}>
          {STATUS.map((s) => (
            <option key={s.v} value={s.v} style={{ color: '#000' }}>{s.l}</option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو..." className="rounded-lg border p-1 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
        <button onClick={load} className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: 'var(--border)' }}>اعمال</button>
        <button onClick={exportXlsx} className="rounded-lg bg-brand text-white px-3 py-1 text-sm">خروجی Excel</button>
      </div>

      {error && <div className="rounded-lg border p-2 text-sm mb-2" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}

      <div className="rounded-xl border overflow-x-auto" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              {['شماره پرونده', 'بیمه‌گذار', 'کد ملی', 'بیمه‌نامه', 'مرحله', 'وضعیت'].map((h) => (
                <th key={h} className="p-2 text-right border-b" style={{ borderColor: 'var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-center">در حال بارگذاری...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center">پرونده‌ای یافت نشد</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2">{r.caseNumber}</td>
                  <td className="p-2">{r.insuredName}</td>
                  <td className="p-2">{r.nationalCode}</td>
                  <td className="p-2">{r.policyNumber}</td>
                  <td className="p-2">{r.stageDate}</td>
                  <td className="p-2">{statusFa(r.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusFa(s: string): string {
  return ({ PAID: 'پرداخت شده', REVIEWING: 'در حال بررسی', UNPAYABLE: 'غیرقابل پرداخت', OTHER: 'سایر' } as Record<string, string>)[s] || s;
}
