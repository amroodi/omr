'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { Shell, Icon } from '../components/Shell';
import { ErrorBox, StatCard, StatusBadge } from '../components/ui';
import { ORG_NAV } from './nav';

const STATUS = [
  { v: '', l: 'همه' },
  { v: 'REVIEWING', l: 'در حال بررسی' },
  { v: 'PAID', l: 'پرداخت شده' },
  { v: 'UNPAYABLE', l: 'غیرقابل پرداخت' },
  { v: 'OTHER', l: 'سایر' },
];

interface CaseRow {
  id: string; caseNumber: string; status: string;
  insuredName: string | null; nationalCode: string | null;
  policyNumber: string | null; stageDate: string | null;
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
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const r = await client.get<{ items: CaseRow[]; total: number }>(`/cases?${params}`, 'org');
      setRows(r.items); setTotal(r.total);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    reviewing: rows.filter((r) => r.status === 'REVIEWING').length,
    paid: rows.filter((r) => r.status === 'PAID').length,
  }), [rows]);

  const exportXlsx = () => client.download(`/exports/cases.xlsx${status ? `?status=${status}` : ''}`, 'org', 'cases.xlsx').catch((e) => setError(e.message));

  return (
    <Shell title="مدیریت پرونده‌ها" subtitle="پرونده‌های خسارت و پیگیری مراحل" nav={ORG_NAV} realm="org">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="کل پرونده‌ها" value={total} tone="brand" icon={<Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />} />
        <StatCard label="در حال بررسی" value={counts.reviewing} tone="warning" icon={<Icon path="M12 6v6l4 2M12 22a10 10 0 100-20 10 10 0 000 20z" />} />
        <StatCard label="پرداخت‌شده" value={counts.paid} tone="success" icon={<Icon path="M20 6L9 17l-5-5" />} />
        <StatCard label="این صفحه" value={rows.length} tone="muted" icon={<Icon path="M4 6h16M4 12h16M4 18h16" />} />
      </div>

      <ErrorBox message={error} />

      <div className="card">
        <div className="flex flex-wrap gap-2 items-center p-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input" style={{ width: 'auto' }}>
            {STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="جستجوی شماره پرونده یا بیمه‌نامه…" className="input" style={{ maxWidth: 280 }} />
          <button onClick={load} className="btn btn-ghost btn-sm">اعمال فیلتر</button>
          <button onClick={exportXlsx} className="btn btn-primary btn-sm mr-auto">
            <Icon path="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /> خروجی Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>{['شماره پرونده', 'بیمه‌گذار', 'کد ملی', 'بیمه‌نامه', 'مرحله', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.caseNumber}</td>
                  <td>{r.insuredName}</td>
                  <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.nationalCode}</td>
                  <td>{r.policyNumber}</td>
                  <td>{r.stageDate}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
