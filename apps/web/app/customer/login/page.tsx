'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

/**
 * ورود بیمه‌گزار: «کد بیمه‌گزار» + password — one login per company for both its عمر and حوادث
 * policies. (The person login by کد ملی + mobile is off for now; it returns for بیمه‌شده later.)
 */
export default function CustomerLogin() {
  const router = useRouter();
  const [tenant, setTenant] = useState('damuon');
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { client.get<{ slug: string; name: string }[]>('/customer/orgs').then(setOrgs).catch(() => {}); }, []);

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(''); setLoading(true);
    try {
      setTenantSlug(tenant);
      const r = await client.post<{ token: string }>('/customer/login/company', { code: code.trim(), password });
      setToken('customer', r.token);
      router.push('/customer');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <AuthCard title="ورود بیمه‌گزار" subtitle="اعلام و پیگیری خسارت عمر و حوادث" bg={{ light: ['cust-day-1', 'cust-day-2'], dark: ['cust-night-1'] }}>
      <form className="space-y-4" onSubmit={login}>
        <ErrorBox message={error} />
        {orgs.length > 1 && (
          <Field label="کارگزاری">
            <select value={tenant} onChange={(e) => setTenant(e.target.value)} className="input">
              {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="کد بیمه‌گزار">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input latin-digits" inputMode="numeric" autoComplete="username"
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
