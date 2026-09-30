'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { OrgNav } from '../nav';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

interface Agreement {
  id: string;
  ownerTenantId: string;
  partnerTenantId: string;
  scope: string;
  isActive: boolean;
}

export default function Sharing() {
  const [outgoing, setOutgoing] = useState<Agreement[]>([]);
  const [incoming, setIncoming] = useState<Agreement[]>([]);
  const [partnerTenantId, setPartner] = useState('');
  const [scope, setScope] = useState('CASE_STATUS');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [o, i] = await Promise.all([
        client.get<Agreement[]>('/sharing/outgoing', 'org'),
        client.get<Agreement[]>('/sharing/incoming', 'org'),
      ]);
      setOutgoing(o);
      setIncoming(i);
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const grant = async () => {
    setError('');
    try {
      await client.post('/sharing/grant', { partnerTenantId, scope }, 'org');
      setPartner(''); load();
    } catch (e: any) { setError(e.message); }
  };

  const revoke = async (id: string) => {
    setError('');
    try {
      await client.del(`/sharing/${id}`, 'org');
      load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-5">
      <OrgNav />
      <h1 className="text-lg font-bold">اشتراک‌گذاری داده بین سازمان‌ها</h1>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        به‌صورت پیش‌فرض داده هر سازمان کاملاً خصوصی است. اشتراک‌گذاری اختیاری و قابل لغو است.
      </p>
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}

      <div className="rounded-xl border p-3 space-y-2" style={card}>
        <h2 className="font-bold text-sm">اعطای دسترسی به سازمان دیگر</h2>
        <input value={partnerTenantId} onChange={(e) => setPartner(e.target.value)} placeholder="شناسه (id) سازمان مقصد" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }}>
          <option value="CASE_STATUS" style={{ color: '#000' }}>فقط وضعیت پرونده (بدون اطلاعات هویتی)</option>
          <option value="FULL" style={{ color: '#000' }}>دسترسی کامل</option>
        </select>
        <button onClick={grant} disabled={!partnerTenantId} className="rounded-lg bg-brand text-white px-3 py-1 text-sm disabled:opacity-50">اعطای دسترسی</button>
      </div>

      <section>
        <h2 className="font-bold text-sm mb-2">دسترسی‌هایی که داده‌ایم</h2>
        <div className="rounded-xl border p-3 space-y-1" style={card}>
          {outgoing.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>موردی نیست.</p> : outgoing.map((a) => (
            <div key={a.id} className="flex justify-between text-sm border-b pb-1" style={{ borderColor: 'var(--border)' }}>
              <span>{a.partnerTenantId.slice(0, 8)}… — {a.scope} {a.isActive ? '' : '(لغو‌شده)'}</span>
              {a.isActive && <button onClick={() => revoke(a.id)} className="text-red-500 text-xs">لغو</button>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-bold text-sm mb-2">دسترسی‌هایی که دریافت کرده‌ایم</h2>
        <div className="rounded-xl border p-3 space-y-1" style={card}>
          {incoming.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>موردی نیست.</p> : incoming.map((a) => (
            <div key={a.id} className="text-sm border-b pb-1" style={{ borderColor: 'var(--border)' }}>
              {a.ownerTenantId.slice(0, 8)}… — {a.scope}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
