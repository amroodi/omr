'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { client, getToken, hasPerm } from '../../../../lib/client';
import { Shell, Icon } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox } from '../../../components/ui';
import { ORG_NAV } from '../../nav';

interface TrashClaim {
  id: string; claimNumber: string; status: string; claimType: string;
  deceasedName: string | null; claimedAmount: string; deletedAt: string | null; daysLeft: number;
}

export default function ClaimsTrash() {
  const router = useRouter();
  const [rows, setRows] = useState<TrashClaim[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { setRows(await client.get<TrashClaim[]>('/claims/trash', 'org')); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    if (!hasPerm('org', 'claim:delete')) { router.push('/org'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restore = async (id: string) => {
    setBusy(id); setError('');
    try { await client.post(`/claims/${id}/restore`, {}, 'org'); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <Shell title="سطل بازیافت پرونده‌ها" subtitle="پرونده‌های حذف‌شده؛ تا ۱۴ روز قابل بازیابی، سپس حذف دائمی" nav={ORG_NAV} realm="org">
      <div className="mb-3">
        <Link href="/org" className="btn btn-ghost btn-sm"><Icon path="M15 19l-7-7 7-7" /> بازگشت به پرونده‌ها</Link>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr>{['شماره', 'نوع', 'بیمه‌شده', 'مبلغ', 'تاریخ حذف', 'مهلت بازیابی', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>سطل بازیافت خالی است</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.claimNumber}</td>
                <td>{CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</td>
                <td>{c.deceasedName}</td>
                <td style={{ direction: 'ltr', textAlign: 'right' }}>{Number(c.claimedAmount).toLocaleString('fa-IR')}</td>
                <td style={{ color: 'var(--muted)' }}>{c.deletedAt}</td>
                <td><span className={`badge ${c.daysLeft <= 3 ? 'badge-danger' : 'badge-warning'}`}>{c.daysLeft.toLocaleString('fa-IR')} روز</span></td>
                <td><button onClick={() => restore(c.id)} disabled={busy === c.id} className="btn btn-primary btn-sm">بازیابی</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
