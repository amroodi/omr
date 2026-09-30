'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setToken } from '../../../lib/client';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

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
    <div className="max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-bold">ورود مدیر سکو</h1>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ایمیل" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز عبور" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
        <button onClick={submit} disabled={loading} className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50">ورود</button>
      </div>
    </div>
  );
}
