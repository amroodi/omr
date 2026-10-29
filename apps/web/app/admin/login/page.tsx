'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [totp, setTotp] = useState<string | null>(null);

  const submit = async () => {
    setError(''); setLoading(true);
    try {
      const code = totp ? totp.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim() : undefined;
      const r = await client.post<{ token: string }>('/auth/super/login', { email, password, ...(code ? { totp: code } : {}) });
      setToken('super', r.token);
      router.push('/admin');
    } catch (e: any) {
      if (e.code === 'MFA_REQUIRED') { setTotp(''); setError(''); }
      else { setError(e.message); if (e.code === 'MFA_INVALID') setTotp(''); }
    } finally { setLoading(false); }
  };

  return (
    <AuthCard title="مدیر سکو" subtitle="مدیریت سازمان‌ها و لایسنس‌ها">
      <div className="space-y-4">
        <ErrorBox message={error} />
        <Field label="ایمیل"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
        {totp !== null && (
          <Field label="کد ورود دومرحله‌ای (برنامهٔ احراز هویت گوشی)">
            <input className="input latin-digits" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
              style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '0.3em' }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </Field>
        )}
        <button onClick={submit} disabled={loading || !email || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
      </div>
    </AuthCard>
  );
}
