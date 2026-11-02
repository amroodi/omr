'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';
import { NetworkTab } from './network';

/** Super Admin only: which بیمه‌گزار connects through which کارگزاری to which بیمه‌گر. */
export default function AdminNetwork() {
  const router = useRouter();
  const [brokers, setBrokers] = useState<{ id: string; name: string }[] | null>(null);
  const [broker, setBroker] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    client.get<{ brokers: { id: string; name: string }[] }>('/admin/policyholders/options', 'super').then((o) => {
      setBrokers(o.brokers); setBroker(o.brokers[0]?.id ?? '');
    }).catch((e) => { setBrokers([]); setMsg({ t: 'err', m: e.message }); });
    // eslint-disable-next-line
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">نقشهٔ اتصال‌ها</h1>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>
      {brokers === null ? <div className="card p-8 text-center"><Spinner /></div> : (
        <div className="card p-4 max-w-sm">
          <label className="text-sm">کارگزاری
            <select className="input mt-1" value={broker} onChange={(e) => { setMsg(null); setBroker(e.target.value); }}>
              {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      {broker && <NetworkTab brokerTenantId={broker} setMsg={setMsg} />}
    </div>
  );
}
