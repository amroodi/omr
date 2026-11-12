'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { DoctorShell } from './shell';

interface Row { id: string; kindLabel: string; status: string; statusLabel: string; createdAt: string; answeredAt: string | null; claimNumber: string; name: string | null; claimTypeLabel: string; eventDate: string | null; cause: string | null }

/** کارتابل پزشک معتمد: the cases referred to this doctor — waiting ones first, then those already answered. */
export default function DoctorDesk() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<'PENDING' | 'DONE'>('PENDING');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!getToken('org')) { router.push('/doctor/login'); return; }
    client.get<Row[]>('/doctor/referrals', 'org').then(setRows).catch((e) => setError(e.message));
  }, [router]);
  const shown = (rows ?? []).filter((r) => r.status === tab);
  const count = (s: string) => (rows ?? []).filter((r) => r.status === s).length.toLocaleString('fa-IR');

  return (
    <DoctorShell title="کارتابل">
      {error && <div className="alert-error text-sm">{error}</div>}
      <div className="doc-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'PENDING'} className={tab === 'PENDING' ? 'is-on' : ''} onClick={() => setTab('PENDING')}>در انتظار اظهار نظر ({count('PENDING')})</button>
        <button role="tab" aria-selected={tab === 'DONE'} className={tab === 'DONE' ? 'is-on' : ''} onClick={() => setTab('DONE')}>ثبت شده ({count('DONE')})</button>
      </div>
      <div className="doc-card overflow-x-auto">
        <table className="sk-table">
          <thead><tr><th>#</th><th>عملیات</th><th>شماره پرونده</th><th>بیمه‌شده</th><th>نوع پرونده</th><th>علت</th><th>تاریخ وقوع</th><th>نوع ارجاع</th><th>تاریخ ارجاع</th>{tab === 'DONE' && <th>تاریخ ثبت نظر</th>}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={10} className="sk-none">در حال بارگذاری…</td></tr>}
            {rows && shown.length === 0 && <tr><td colSpan={10} className="sk-none">پرونده‌ای در این بخش نیست.</td></tr>}
            {shown.map((r, i) => (
              <tr key={r.id}>
                <td>{(i + 1).toLocaleString('fa-IR')}</td>
                <td><Link href={`/doctor/${r.id}`} className="sn-act is-green">{r.status === 'PENDING' ? 'اظهار نظر' : 'مشاهده'}</Link></td>
                <td className="ltr-num">{r.claimNumber}</td><td>{r.name ?? '—'}</td><td>{r.claimTypeLabel}</td><td>{r.cause ?? '—'}</td>
                <td>{r.eventDate ?? '—'}</td><td>{r.kindLabel}</td><td>{r.createdAt}</td>{tab === 'DONE' && <td>{r.answeredAt ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DoctorShell>
  );
}
