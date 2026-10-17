'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { client, getToken, hasPerm } from '../../lib/client';
import { Shell, Icon } from '../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, StatCard, StatusBadge } from '../components/ui';
import { ORG_NAV } from './nav';

interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; insurerTenantId?: string;
  deceasedName: string | null; claimedAmount: string; lateNotice: boolean; needsAction: boolean;
}

export default function OrgDashboard() {
  const router = useRouter();
  const [rows, setRows] = useState<Claim[]>([]);
  const [insurers, setInsurers] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    try { setRows(await client.get<Claim[]>('/claims', 'org')); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    load();
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then((a) => setInsurers(Object.fromEntries(a.map((i) => [i.id, i.name])))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    reviewing: rows.filter((r) => ['SUBMITTED', 'UNDER_REVIEW', 'RETURNED_INCOMPLETE', 'APPROVED'].includes(r.status)).length,
    paid: rows.filter((r) => r.status === 'PAID').length,
    action: rows.filter((r) => r.needsAction).length,
  }), [rows]);

  const shown = q ? rows.filter((r) => `${r.claimNumber} ${r.deceasedName || ''}`.toLowerCase().includes(q.toLowerCase())) : rows;

  return (
    <Shell title="مدیریت پرونده‌ها" subtitle="پرونده‌های خسارت فوت و حوادث و پیگیری مراحل" nav={ORG_NAV} realm="org">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="کل پرونده‌ها" value={rows.length} tone="brand" icon={<Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />} />
        <StatCard label="در جریان" value={counts.reviewing} tone="warning" icon={<Icon path="M12 6v6l4 2M12 22a10 10 0 100-20 10 10 0 000 20z" />} />
        <StatCard label="پرداخت‌شده" value={counts.paid} tone="success" icon={<Icon path="M20 6L9 17l-5-5" />} />
        <StatCard label="نیازمند اقدام" value={counts.action} tone="muted" icon={<Icon path="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />} />
      </div>

      <ErrorBox message={error} />

      <div className="flex justify-between items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی شماره پرونده یا نام…" className="input" style={{ maxWidth: 280 }} />
        <div className="flex items-center gap-2">
          {hasPerm('org', 'claim:delete') && (
            <Link href="/org/claims/trash" className="btn btn-ghost btn-sm" title="سطل بازیافت"><Icon path="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /> سطل بازیافت</Link>
          )}
          {hasPerm('org', 'claim:file') && (
            <Link href="/org/claims/new" className="btn btn-primary btn-sm"><Icon path="M12 5v14M5 12h14" /> پرونده جدید</Link>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr>{['شماره', 'نوع', 'بیمه‌گر', 'بیمه‌شده', 'مبلغ', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد</td></tr>
            ) : shown.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/org/claims/${c.id}`)}>
                <td className="font-semibold">{c.claimNumber}</td>
                <td>{CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</td>
                <td>{(c.insurerTenantId && insurers[c.insurerTenantId]) || '—'}</td>
                <td>{c.deceasedName}</td>
                <td style={{ direction: 'ltr', textAlign: 'right' }}>{Number(c.claimedAmount).toLocaleString('fa-IR')}</td>
                <td><StatusBadge status={c.status} />{c.lateNotice && <span className="badge badge-danger mr-1">خارج از مهلت</span>}</td>
                <td>{c.needsAction && <span className="badge badge-warning">نیازمند اقدام</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
