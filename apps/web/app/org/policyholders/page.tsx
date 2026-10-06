'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Acc { id: string; fullName: string | null; nationalCodeMasked: string | null; phoneMasked: string | null; signupStatus: string; isActive: boolean; createdAt: string | null; lastLoginAt: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'در انتظار تایید', cls: 'badge-warning' },
  ACTIVE: { label: 'فعال', cls: 'badge-success' },
  REJECTED: { label: 'ردشده', cls: 'badge-neutral' },
};

export default function Policyholders() {
  const [rows, setRows] = useState<Acc[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING'>('PENDING');
  const [f, setF] = useState({ nationalCode: '', phone: '', fullName: '' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const load = () => {
    const q = filter === 'PENDING' ? '?status=PENDING' : '';
    client.get<Acc[]>(`/customer/accounts${q}`, 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
    client.get<{ count: number }>('/customer/accounts/pending-count', 'org').then((d) => setPending(d.count)).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const create = async () => {
    setMsg(null); setBusy(true);
    try {
      await client.post('/customer/accounts', f, 'org');
      setMsg({ t: 'ok', m: 'بیمه‌گزار ثبت شد' }); setF({ nationalCode: '', phone: '', fullName: '' }); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const act = async (id: string, action: 'approve' | 'reject') => {
    try { await client.post(`/customer/accounts/${id}/${action}`, {}, 'org'); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };

  return (
    <Shell title="بیمه‌گزاران" subtitle="تایید درخواست‌های ثبت‌نام و مدیریت حساب بیمه‌گزاران (ورود با کد پیامکی)" nav={ORG_NAV} realm="org">
      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <div className="card p-4 space-y-3 h-fit">
          <h3 className="font-semibold text-sm">افزودن بیمه‌گزار (تایید فوری)</h3>
          {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
          <Field label="کد ملی"><input className="input" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="موبایل"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="نام و نام خانوادگی (اختیاری)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <button onClick={create} disabled={busy || !f.nationalCode || !f.phone} className="btn btn-primary btn-sm w-full">ثبت بیمه‌گزار</button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setFilter('PENDING')} className="btn btn-sm" style={filter === 'PENDING' ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              در انتظار تایید{pending > 0 ? ` (${pending})` : ''}
            </button>
            <button onClick={() => setFilter('ALL')} className="btn btn-sm" style={filter === 'ALL' ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>همه</button>
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr>{['نام', 'کد ملی', 'موبایل', 'وضعیت', 'ثبت', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>موردی نیست</td></tr> :
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.fullName || '—'}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.nationalCodeMasked}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.phoneMasked || '—'}</td>
                      <td><span className={`badge ${STATUS[r.signupStatus]?.cls || 'badge-neutral'}`}>{STATUS[r.signupStatus]?.label || r.signupStatus}</span></td>
                      <td className="text-xs">{r.createdAt || '—'}</td>
                      <td>
                        {r.signupStatus === 'PENDING' ? (
                          <span className="flex gap-2">
                            <button onClick={() => act(r.id, 'approve')} className="text-xs" style={{ color: 'var(--success)' }}>تایید</button>
                            <button onClick={() => act(r.id, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }}>رد</button>
                          </span>
                        ) : r.signupStatus === 'REJECTED' ? (
                          <button onClick={() => act(r.id, 'approve')} className="text-xs" style={{ color: 'var(--success)' }}>تایید</button>
                        ) : <span style={{ color: 'var(--muted)' }} className="text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
