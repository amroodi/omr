'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Agreement { id: string; ownerTenantId: string; partnerTenantId: string; scope: string; isActive: boolean }

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
      setOutgoing(o); setIncoming(i);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const grant = async () => {
    setError('');
    try { await client.post('/sharing/grant', { partnerTenantId, scope }, 'org'); setPartner(''); load(); }
    catch (e: any) { setError(e.message); }
  };
  const revoke = async (id: string) => {
    setError('');
    try { await client.del(`/sharing/${id}`, 'org'); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <Shell title="اشتراک‌گذاری داده بین سازمان‌ها" subtitle="داده هر سازمان به‌صورت پیش‌فرض خصوصی است؛ اشتراک اختیاری و قابل لغو است" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">اعطای دسترسی</h3>
          <Field label="شناسه سازمان مقصد"><input value={partnerTenantId} onChange={(e) => setPartner(e.target.value)} className="input" placeholder="Tenant ID" /></Field>
          <Field label="سطح دسترسی">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="input">
              <option value="CASE_STATUS">فقط وضعیت پرونده (بدون اطلاعات هویتی)</option>
              <option value="FULL">دسترسی کامل</option>
            </select>
          </Field>
          <button onClick={grant} disabled={!partnerTenantId} className="btn btn-primary btn-sm">اعطای دسترسی</button>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">دسترسی‌های اعطاشده</h3>
          {outgoing.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>موردی نیست.</p> :
            <div className="space-y-2">{outgoing.map((a) => (
              <div key={a.id} className="flex justify-between items-center text-sm">
                <span>{a.partnerTenantId.slice(0, 8)}… <span className="badge badge-info">{a.scope}</span></span>
                {a.isActive ? <button onClick={() => revoke(a.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>لغو</button> : <span className="badge badge-neutral">لغوشده</span>}
              </div>
            ))}</div>}
        </div>

        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">دریافت‌شده از دیگران</h3>
          {incoming.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>موردی نیست.</p> :
            <div className="space-y-2">{incoming.map((a) => (
              <div key={a.id} className="text-sm">{a.ownerTenantId.slice(0, 8)}… <span className="badge badge-info">{a.scope}</span></div>
            ))}</div>}
        </div>
      </div>
    </Shell>
  );
}
