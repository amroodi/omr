'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

export default function OrgLogin() {
  const router = useRouter();
  const [tenantSlug, setSlug] = useState('damuon');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(''); setLoading(true);
    try {
      setTenantSlug(tenantSlug);
      const r = await client.post<{ token: string }>('/auth/org/login', { tenantSlug, username, password });
      setToken('org', r.token);
      router.push('/org');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <AuthCard title="ورود سازمان" subtitle="پنل مدیریت پرونده‌های سازمان">
      <div className="space-y-4">
        <ErrorBox message={error} />
        <Field label="شناسه سازمان"><input className="input" value={tenantSlug} onChange={(e) => setSlug(e.target.value)} placeholder="damuon" /></Field>
        <Field label="نام کاربری"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
      </div>
    </AuthCard>
  );
}
