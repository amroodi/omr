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

  const submit = async () => {
    setError(''); setLoading(true);
    try {
      const r = await client.post<{ token: string }>('/auth/super/login', { email, password });
      setToken('super', r.token);
      router.push('/admin');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <AuthCard title="مدیر سکو" subtitle="مدیریت سازمان‌ها و لایسنس‌ها">
      <div className="space-y-4">
        <ErrorBox message={error} />
        <Field label="ایمیل"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
        <button onClick={submit} disabled={loading || !email || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
      </div>
    </AuthCard>
  );
}
