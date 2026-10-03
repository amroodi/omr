'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell, Icon } from '../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Claim {
  id: string; claimNumber: string; status: string; claimType: string;
  deceasedName: string | null; claimedAmount: string; lateNotice: boolean; needsAction: boolean;
}

export default function ClaimsList() {
  const router = useRouter();
  const [rows, setRows] = useState<Claim[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => client.get<Claim[]>('/claims', 'org').then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false));
  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell title="پرونده‌های خسارت" subtitle="ثبت و پیگیری پرونده‌های خسارت فوت و ازکارافتادگی" nav={ORG_NAV} realm="org">
      <div className="flex justify-end mb-4">
        <Link href="/org/claims/new" className="btn btn-primary btn-sm">
          <Icon path="M12 5v14M5 12h14" /> پرونده جدید
        </Link>
      </div>
      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr>{['شماره', 'نوع', 'بیمه‌شده', 'مبلغ', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>پرونده‌ای نیست</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/org/claims/${c.id}`)}>
                <td className="font-semibold">{c.claimNumber}</td>
                <td>{CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</td>
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
