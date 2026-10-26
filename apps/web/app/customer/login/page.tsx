'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, getTenantSlug, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

/**
 * ورود بیمه‌گزار: «کد بیمه‌گزار» + password — one login per company for both its عمر and حوادث
 * policies. (The person login by کد ملی + mobile is off for now; it returns for بیمه‌شده later.)
 */
export default function CustomerLogin() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(''); setLoading(true);
    try {
      setTenantSlug(process.env.NEXT_PUBLIC_TENANT_SLUG || getTenantSlug()); // the brokerage this site belongs to
      const r = await client.post<{ token: string }>('/customer/login/company', { code: code.trim(), password });
      setToken('customer', r.token);
      router.push('/customer');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <AuthCard title="ورود بیمه‌گزار" subtitle="اعلام و پیگیری خسارت عمر و حوادث" bg={{ light: ['cust-day-1', 'cust-day-2'], dark: ['cust-night-1'] }}>
      <form className="space-y-4" onSubmit={login}>
        <ErrorBox message={error} />
        <Field label="کد بیمه‌گزار">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input latin-digits" autoComplete="username" autoCapitalize="off"
            placeholder="مثلاً ۷۰۹۶۲۳۲" style={{ direction: 'ltr', textAlign: 'right' }} autoFocus />
        </Field>
        <Field label="رمز عبور">
          <div className="relative">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input" type={show ? 'text' : 'password'} autoComplete="current-password"
              style={{ direction: 'ltr', textAlign: 'right', paddingLeft: 64 }} />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: 'var(--brand)' }}>
              {show ? 'پنهان' : 'نمایش'}
            </button>
          </div>
        </Field>
        <button type="submit" disabled={loading || !code.trim() || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
        <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>کد بیمه‌گزار و رمز عبور را از کارگزاری دریافت کنید.</p>
      </form>
    </AuthCard>
  );
}
