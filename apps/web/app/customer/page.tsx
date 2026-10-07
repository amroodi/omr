'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../components/ui';
import { Icon } from '../components/Shell';
import { NotificationBell } from '../components/NotificationBell';

interface MyCase {
  caseNumber: string; status: string;
  insuredName: string | null; nationalCodeMasked: string | null;
  policy: { policyNumber: string; carrier: string } | null;
  stageDate: string | null; paidAt: string | null;
  recentPayments: { date: string; amount: string; status: string }[];
}
interface MyClaim { id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null; lateNotice: boolean; needsAction: boolean }

export default function CustomerDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<MyCase[]>([]);
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    Promise.all([
      client.get<MyClaim[]>('/customer/claims', 'customer').then(setClaims).catch(() => {}),
      client.get<MyCase[]>('/customer/cases', 'customer').then(setCases).catch((e) => setError(e.message)),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">پرونده‌های من</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>وضعیت و سوابق پرداخت پرونده‌های شما</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/customer/claims/new')} className="btn btn-primary btn-sm">+ ثبت پرونده خسارت</button>
          <NotificationBell realm="customer" />
          <button onClick={() => { clearToken('customer'); router.push('/customer/login'); }} className="btn btn-ghost btn-sm">
            <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج
          </button>
        </div>
      </div>
      <ErrorBox message={error} />

      {claims.length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold mb-2">پرونده‌های خسارت</h2>
          <div className="space-y-2">
            {claims.map((c) => (
              <Link key={c.id} href={`/customer/claims/${c.id}`} className="card card-hover p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{c.claimNumber} <span className="font-normal" style={{ color: 'var(--muted)' }}>— {CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</span></div>
                  <div className="text-sm" style={{ color: 'var(--muted)' }}>{c.deceasedName}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === 'RETURNED_INCOMPLETE' && <span className="badge badge-danger">نیازمند رفع نقص</span>}
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</div>
      ) : cases.length === 0 && claims.length === 0 ? (
        <div className="card p-8 text-center space-y-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>هنوز پرونده‌ای ندارید. برای شروع، یک پرونده خسارت ثبت کنید و سپس مدارک را بارگذاری کنید.</p>
          <button onClick={() => router.push('/customer/claims/new')} className="btn btn-primary">+ ثبت پرونده خسارت جدید</button>
        </div>
      ) : cases.length === 0 ? null : (
        <div className="grid md:grid-cols-2 gap-4">
          {cases.map((c) => (
            <div key={c.caseNumber} className="card card-hover p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold">پرونده {c.caseNumber}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="text-sm space-y-1" style={{ color: 'var(--muted)' }}>
                <div>{c.insuredName} — <span style={{ direction: 'ltr' }}>{c.nationalCodeMasked}</span></div>
                {c.policy && <div>بیمه‌نامه {c.policy.policyNumber} · {c.policy.carrier}</div>}
                {c.stageDate && <div>آخرین مرحله: {c.stageDate}</div>}
              </div>
              {c.recentPayments.length > 0 && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>پرداخت‌های اخیر</div>
                  {c.recentPayments.map((p, i) => (
                    <div key={i} className="flex justify-between text-sm py-0.5">
                      <span>{p.date}</span><span className="font-semibold">{p.amount}</span><StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
