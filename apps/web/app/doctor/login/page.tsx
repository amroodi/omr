'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, setToken } from '../../../lib/client';

const ascii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * ورود پزشک معتمد: a login of its own (not panel 1 or 2). The doctor is a user of the insurer with the
 * «پزشک معتمد» role; after signing in they see only the cases referred to them.
 */
export default function DoctorLogin() {
  const router = useRouter();
  const [org, setOrg] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const o = new URLSearchParams(window.location.search).get('org'); if (o) setOrg(o); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await client.post<{ token: string }>('/auth/org/login', { tenantSlug: org.trim(), username: username.trim(), password, mode: 'PROCESS', ...(totp ? { totp: ascii(totp).trim() } : {}) });
      setToken('org', r.token);
      router.push('/doctor');
    } catch (err: any) {
      if (err.code === 'MFA_REQUIRED') { setTotp(''); setError(''); } else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="doc-login">
      <form className="doc-login-card" onSubmit={submit}>
        <div className="doc-login-ico" aria-hidden>
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3v6a4 4 0 008 0V3M10 13v3a5 5 0 0010 0v-2" /><circle cx="20" cy="12" r="2" /></svg>
        </div>
        <h1>پنل پزشک معتمد</h1>
        <p>پرونده‌هایی که برای اظهار نظر یا معاینه به شما ارجاع شده است.</p>
        {error && <div className="alert-error text-sm">{error}</div>}
        {!new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('org') && (
          <label className="label">شناسهٔ بیمه‌گر<input className="input" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="مثلاً alborz" dir="ltr" required /></label>
        )}
        <label className="label">نام کاربری<input className="input" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="username" required /></label>
        <label className="label">رمز عبور<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" required /></label>
        {totp !== null && <label className="label">کد ورود دومرحله‌ای<input className="input" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" dir="ltr" autoFocus /></label>}
        <button className="btn btn-solid w-full" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود'}</button>
      </form>
    </div>
  );
}
