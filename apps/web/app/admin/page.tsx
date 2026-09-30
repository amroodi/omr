'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

interface Tenant {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  _count: { orgUsers: number; cases: number; customers: number };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ name: '', slug: '', adminUsername: 'admin', adminDisplayName: '' });
  const [result, setResult] = useState<{ username: string; oneTimePassword: string } | null>(null);
  const [error, setError] = useState('');

  const load = () => client.get<Tenant[]>('/tenants', 'super').then(setTenants).catch((e) => setError(e.message));

  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provision = async () => {
    setError(''); setResult(null);
    try {
      const r = await client.post<{ admin: { username: string; oneTimePassword: string } }>('/tenants', form, 'super');
      setResult(r.admin);
      setForm({ name: '', slug: '', adminUsername: 'admin', adminDisplayName: '' });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const toggle = async (t: Tenant) => {
    try { await client.patch(`/tenants/${t.id}/active`, { isActive: !t.isActive }, 'super'); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-bold">مدیریت سازمان‌ها</h1>
        <button onClick={() => { clearToken('super'); router.push('/admin/login'); }} className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: 'var(--border)' }}>خروج</button>
      </div>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}

      <div className="rounded-xl border p-4 space-y-2" style={card}>
        <h2 className="font-bold text-sm">ایجاد سازمان جدید</h2>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام سازمان" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
        <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="شناسه (slug) — انگلیسی" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
        <input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} placeholder="نام کاربری مدیر سازمان" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
        <button onClick={provision} disabled={!form.name || !form.slug} className="rounded-lg bg-brand text-white px-3 py-1 text-sm disabled:opacity-50">ایجاد و ساخت مدیر</button>
        {result && (
          <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#10b981' }}>
            مدیر ساخته شد. نام کاربری: <b>{result.username}</b> — رمز یک‌بار مصرف: <b>{result.oneTimePassword}</b>
            <div style={{ color: 'var(--muted)' }}>این رمز فقط یک‌بار نمایش داده می‌شود.</div>
          </div>
        )}
      </div>

      <div className="rounded-xl border overflow-x-auto" style={card}>
        <table className="w-full text-sm">
          <thead><tr style={{ background: 'var(--bg)' }}>
            {['نام', 'شناسه', 'کاربران', 'پرونده‌ها', 'مشتریان', 'وضعیت'].map((h) => (
              <th key={h} className="p-2 text-right border-b" style={{ borderColor: 'var(--border)' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                <td className="p-2">{t.name}</td>
                <td className="p-2">{t.slug}</td>
                <td className="p-2">{t._count.orgUsers}</td>
                <td className="p-2">{t._count.cases}</td>
                <td className="p-2">{t._count.customers}</td>
                <td className="p-2">
                  <button onClick={() => toggle(t)} className="text-xs rounded border px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                    {t.isActive ? 'فعال' : 'غیرفعال'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
