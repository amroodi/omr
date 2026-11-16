'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, setToken } from '../../../lib/client';

/**
 * ورود پزشک معتمد: a login of its own (not panel 1 or 2), with the account Super Admin made in «پزشکان معتمد».
 * After signing in the doctor sees only the cases referred to them, from every insurer they work with.
 */
export default function DoctorLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await client.post<{ token: string }>('/auth/doctor/login', { username: username.trim().toLowerCase(), password });
      setToken('doctor', r.token);
      router.push('/doctor');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="doc-login">
      <form className="doc-login-card" onSubmit={submit}>
        <div className="doc-login-ico" aria-hidden>
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3v6a4 4 0 008 0V3M10 13v3a5 5 0 0010 0v-2" /><circle cx="20" cy="12" r="2" /></svg>
        </div>
        <h1>پنل پزشک معتمد</h1>
        {error && <div className="alert-error text-sm">{error}</div>}
        <label className="label">نام کاربری<input className="input" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="username" required /></label>
        <label className="label">رمز عبور<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" required /></label>
        <button className="btn btn-solid w-full" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود'}</button>
      </form>
    </div>
  );
}
