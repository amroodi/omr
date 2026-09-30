'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

export default function OrgLogin() {
  const router = useRouter();
  const [tenantSlug, setSlug] = useState('damuon');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      setTenantSlug(tenantSlug);
      const r = await client.post<{ token: string }>('/auth/org/login', { tenantSlug, username, password });
      setToken('org', r.token);
      router.push('/org');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-bold">ورود سازمان</h1>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      <div className="rounded-xl border p-4 space-y-3" style={card}>
        <input className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} value={tenantSlug} onChange={(e) => setSlug(e.target.value)} placeholder="شناسه سازمان (slug)" />
        <input className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="نام کاربری" />
        <input type="password" className="w-full rounded-lg border p-2 bg-transparent" style={{ borderColor: 'var(--border)' }} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز عبور" />
        <button onClick={submit} disabled={loading} className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50">
          {loading ? '...' : 'ورود'}
        </button>
      </div>
    </div>
  );
}
