'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

export default function CustomerLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [tenant, setTenant] = useState('damuon');
  const [nationalCode, setNid] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'otp'>('id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // signup
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [fullName, setFullName] = useState('');
  const [signupDone, setSignupDone] = useState('');

  useEffect(() => { client.get<{ slug: string; name: string }[]>('/customer/orgs').then(setOrgs).catch(() => {}); }, []);

  const wrap = async (fn: () => Promise<void>) => {
    setError(''); setLoading(true);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  const request = () => wrap(async () => { setTenantSlug(tenant); await client.post('/customer/login/request-otp', { nationalCode, phone }); setStep('otp'); });
  const verify = () => wrap(async () => {
    const r = await client.post<{ token: string }>('/customer/login/verify-otp', { nationalCode, phone, code });
    setToken('customer', r.token); router.push('/customer');
  });
  const signup = () => wrap(async () => {
    const r = await client.post<{ message: string }>('/customer/signup', { tenantSlug: tenant, nationalCode, phone, fullName });
    setSignupDone(r.message || 'درخواست ثبت‌نام ارسال شد.');
  });

  const subtitle = mode === 'login' ? 'پیگیری پرونده‌های خسارت و بارگذاری مدارک' : 'ثبت‌نام بیمه‌گزار جدید — پس از تایید سازمان فعال می‌شود';

  return (
    <AuthCard title={mode === 'login' ? 'ورود بیمه‌گزار' : 'ثبت‌نام بیمه‌گزار'} subtitle={subtitle}>
      <div className="space-y-4">
        <ErrorBox message={error} />

        {mode === 'signup' && signupDone ? (
          <>
            <div className="alert-success">{signupDone}</div>
            <button onClick={() => { setMode('login'); setSignupDone(''); setStep('id'); }} className="btn btn-primary w-full">بازگشت به ورود</button>
          </>
        ) : mode === 'signup' ? (
          <>
            <Field label="سازمان">
              <select value={tenant} onChange={(e) => setTenant(e.target.value)} className="input">
                {orgs.length === 0 && <option value={tenant}>{tenant}</option>}
                {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="نام و نام خانوادگی"><input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" /></Field>
            <Field label="کد ملی"><input value={nationalCode} onChange={(e) => setNid(e.target.value)} className="input" inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="موبایل"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <button onClick={signup} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full">{loading ? '…' : 'ارسال درخواست ثبت‌نام'}</button>
            <button onClick={() => { setMode('login'); setError(''); }} className="btn btn-ghost btn-sm w-full">حساب دارید؟ ورود</button>
          </>
        ) : step === 'id' ? (
          <>
            <Field label="شناسه سازمان"><input value={tenant} onChange={(e) => setTenant(e.target.value)} className="input" style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
            <Field label="کد ملی"><input value={nationalCode} onChange={(e) => setNid(e.target.value)} className="input" inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="موبایل ثبت‌شده"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <button onClick={request} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full">{loading ? '…' : 'ارسال کد'}</button>
            <button onClick={() => { setMode('signup'); setError(''); }} className="btn btn-ghost btn-sm w-full">حساب ندارید؟ ثبت‌نام بیمه‌گزار</button>
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
