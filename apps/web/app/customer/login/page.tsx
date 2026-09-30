'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

export default function CustomerLogin() {
  const router = useRouter();
  const [tenant, setTenant] = useState('damuon');
  const [nationalCode, setNid] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'otp'>('id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setError(''); setLoading(true);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const request = () => wrap(async () => {
    setTenantSlug(tenant);
    await client.post('/customer/login/request-otp', { nationalCode, phone });
    setStep('otp');
  });

  const verify = () => wrap(async () => {
    const r = await client.post<{ token: string }>('/customer/login/verify-otp', { nationalCode, phone, code });
    setToken('customer', r.token);
    router.push('/customer');
  });

  return (
    <div className="max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-bold">ورود مشتری</h1>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        {step === 'id' ? (
          <>
            <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="شناسه سازمان" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
            <input value={nationalCode} onChange={(e) => setNid(e.target.value)} placeholder="کد ملی" inputMode="numeric" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="موبایل ثبت‌شده" inputMode="numeric" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
            <button onClick={request} disabled={loading || !nationalCode || !phone} className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50">ارسال کد</button>
          </>
        ) : (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="کد تایید" inputMode="numeric" className="w-full rounded-lg border p-2 bg-transparent text-center tracking-widest" style={{ borderColor: 'var(--border)' }} />
            <button onClick={verify} disabled={loading || code.length < 4} className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50">ورود</button>
          </>
        )}
      </div>
    </div>
  );
}
