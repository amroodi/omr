'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

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
  const request = () => wrap(async () => { setTenantSlug(tenant); await client.post('/customer/login/request-otp', { nationalCode, phone }); setStep('otp'); });
  const verify = () => wrap(async () => {
    const r = await client.post<{ token: string }>('/customer/login/verify-otp', { nationalCode, phone, code });
    setToken('customer', r.token); router.push('/customer');
  });

  return (
    <AuthCard title="ورود بیمه‌گزار" subtitle="پیگیری پرونده‌های خسارت و بارگذاری مدارک">
      <div className="space-y-4">
        <ErrorBox message={error} />
        {step === 'id' ? (
          <>
            <Field label="شناسه سازمان"><input value={tenant} onChange={(e) => setTenant(e.target.value)} className="input" /></Field>
            <Field label="کد ملی"><input value={nationalCode} onChange={(e) => setNid(e.target.value)} className="input" inputMode="numeric" /></Field>
            <Field label="موبایل ثبت‌شده"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" inputMode="numeric" placeholder="۰۹۱۲…" /></Field>
            <button onClick={request} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full">{loading ? '…' : 'ارسال کد'}</button>
          </>
        ) : (
          <>
            <Field label="کد تایید"><input value={code} onChange={(e) => setCode(e.target.value)} className="input text-center tracking-[0.5em] text-lg" inputMode="numeric" placeholder="––––––" /></Field>
            <button onClick={verify} disabled={loading || code.length < 4} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
            <button onClick={() => setStep('id')} className="btn btn-ghost btn-sm w-full">بازگشت</button>
          </>
        )}
      </div>
    </AuthCard>
  );
}
