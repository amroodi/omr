'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

interface MyCase {
  caseNumber: string;
  status: string;
  insuredName: string | null;
  nationalCodeMasked: string | null;
  policy: { policyNumber: string; carrier: string } | null;
  stageDate: string | null;
  paidAt: string | null;
  recentPayments: { date: string; amount: string; status: string }[];
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<MyCase[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken('customer')) {
      router.push('/customer/login');
      return;
    }
    client.get<MyCase[]>('/customer/cases', 'customer')
      .then(setCases)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-bold">پرونده‌های من</h1>
        <button onClick={() => { clearToken('customer'); router.push('/customer/login'); }} className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: 'var(--border)' }}>خروج</button>
      </div>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      {loading ? (
        <p className="text-sm">در حال بارگذاری...</p>
      ) : cases.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد.</p>
      ) : (
        cases.map((c) => (
          <div key={c.caseNumber} className="rounded-xl border p-4 space-y-2" style={card}>
            <div className="flex justify-between">
              <span className="font-bold">پرونده {c.caseNumber}</span>
              <span className="text-xs rounded-full border px-2 py-1" style={{ borderColor: 'var(--border)' }}>{statusFa(c.status)}</span>
            </div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {c.insuredName} — {c.nationalCodeMasked}
              {c.policy ? ` — بیمه‌نامه ${c.policy.policyNumber} (${c.policy.carrier})` : ''}
            </div>
            {c.recentPayments.length > 0 && (
              <div className="text-sm">
                آخرین پرداخت‌ها:
                {c.recentPayments.map((p, i) => (
                  <span key={i} className="mx-1">{p.date}: {p.amount}</span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function statusFa(s: string): string {
  return ({ PAID: 'پرداخت شده', REVIEWING: 'در حال بررسی', UNPAYABLE: 'غیرقابل پرداخت', OTHER: 'سایر' } as Record<string, string>)[s] || s;
}
