'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';
import { ErrorBox, Field, StatCard } from '../components/ui';
import { Icon } from '../components/Shell';

interface Tenant {
  id: string; slug: string; name: string; isActive: boolean;
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

  const totals = useMemo(() => ({
    orgs: tenants.length,
    active: tenants.filter((t) => t.isActive).length,
    cases: tenants.reduce((s, t) => s + t._count.cases, 0),
    customers: tenants.reduce((s, t) => s + t._count.customers, 0),
  }), [tenants]);

  const provision = async () => {
    setError(''); setResult(null);
    try {
      const payload: Record<string, string> = { name: form.name.trim(), slug: form.slug.trim(), adminUsername: form.adminUsername.trim() };
      if (form.adminDisplayName.trim()) payload.adminDisplayName = form.adminDisplayName.trim();
      const r = await client.post<{ admin: { username: string; oneTimePassword: string } }>('/tenants', payload, 'super');
      setResult(r.admin);
      setForm({ name: '', slug: '', adminUsername: 'admin', adminDisplayName: '' });
      load();
    } catch (e: any) { setError(e.message); }
  };
  const toggle = async (t: Tenant) => {
    try { await client.patch(`/tenants/${t.id}/active`, { isActive: !t.isActive }, 'super'); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">مدیریت سازمان‌ها</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>تامین و مدیریت سازمان‌های سکو</p>
        </div>
        <button onClick={() => { clearToken('super'); router.push('/admin/login'); }} className="btn btn-ghost btn-sm">
          <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="سازمان‌ها" value={totals.orgs} tone="brand" icon={<Icon path="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01" />} />
        <StatCard label="فعال" value={totals.active} tone="success" icon={<Icon path="M20 6L9 17l-5-5" />} />
        <StatCard label="کل پرونده‌ها" value={totals.cases} tone="warning" icon={<Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />} />
        <StatCard label="کل بیمه‌گزاران" value={totals.customers} tone="muted" icon={<Icon path="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />} />
      </div>

      <ErrorBox message={error} />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card p-5 space-y-3 lg:col-span-1 h-fit">
          <h3 className="font-semibold">ایجاد سازمان جدید</h3>
          <Field label="نام سازمان"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
          <Field label="شناسه (انگلیسی)"><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="input" style={{ direction: 'ltr', textAlign: 'left' }} placeholder="sazman-test" /></Field>
          <Field label="نام کاربری مدیر"><input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} className="input" /></Field>
          <Field label="نام نمایشی مدیر (اختیاری)"><input value={form.adminDisplayName} onChange={(e) => setForm({ ...form, adminDisplayName: e.target.value })} className="input" /></Field>
          <button onClick={provision} disabled={!form.name || !form.slug} className="btn btn-primary w-full">ایجاد سازمان و مدیر</button>
          {result && (
            <div className="alert-success">
              مدیر ساخته شد.<br />کاربری: <b>{result.username}</b><br />رمز یک‌بار مصرف: <b style={{ direction: 'ltr', display: 'inline-block' }}>{result.oneTimePassword}</b>
              <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>این رمز فقط یک‌بار نمایش داده می‌شود.</div>
            </div>
          )}
        </div>

        <div className="card overflow-x-auto lg:col-span-2 h-fit">
          <table className="table">
            <thead><tr>{['نام', 'شناسه', 'کاربران', 'پرونده‌ها', 'بیمه‌گزاران', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="font-semibold">{t.name}</td>
                  <td style={{ direction: 'ltr', textAlign: 'right' }}>{t.slug}</td>
                  <td>{t._count.orgUsers}</td>
                  <td>{t._count.cases}</td>
                  <td>{t._count.customers}</td>
                  <td>
                    <button onClick={() => toggle(t)} className={`badge ${t.isActive ? 'badge-success' : 'badge-neutral'}`} style={{ cursor: 'pointer' }}>
                      {t.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
