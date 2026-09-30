'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';
import { ErrorBox, StatusBadge } from '../components/ui';
import { Icon } from '../components/Shell';

interface MyCase {
  caseNumber: string; status: string;
  insuredName: string | null; nationalCodeMasked: string | null;
  policy: { policyNumber: string; carrier: string } | null;
  stageDate: string | null; paidAt: string | null;
  recentPayments: { date: string; amount: string; status: string }[];
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<MyCase[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<MyCase[]>('/customer/cases', 'customer').then(setCases).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">پرونده‌های من</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>وضعیت و سوابق پرداخت پرونده‌های شما</p>
        </div>
        <button onClick={() => { clearToken('customer'); router.push('/customer/login'); }} className="btn btn-ghost btn-sm">
          <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج
        </button>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</div>
      ) : cases.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد.</div>
      ) : (
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
