'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Acc { id: string; fullName: string | null; nationalCodeMasked: string | null; isActive: boolean; lastLoginAt: string | null }

export default function Policyholders() {
  const [rows, setRows] = useState<Acc[]>([]);
  const [f, setF] = useState({ nationalCode: '', phone: '', fullName: '' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => client.get<Acc[]>('/customer/accounts', 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setMsg(null); setBusy(true);
    try {
      await client.post('/customer/accounts', f, 'org');
      setMsg({ t: 'ok', m: 'بیمه‌گزار ثبت شد' }); setF({ nationalCode: '', phone: '', fullName: '' }); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };

  return (
    <Shell title="بیمه‌گزاران" subtitle="ایجاد و مدیریت حساب بیمه‌گزاران (ورود با کد یکبارمصرف پیامکی)" nav={ORG_NAV} realm="org">
      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <div className="card p-4 space-y-3 h-fit">
          <h3 className="font-semibold text-sm">افزودن بیمه‌گزار</h3>
          {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
          <Field label="کد ملی"><input className="input" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="موبایل"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="نام و نام خانوادگی (اختیاری)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <button onClick={create} disabled={busy || !f.nationalCode || !f.phone} className="btn btn-primary btn-sm w-full">ثبت بیمه‌گزار</button>
        </div>
        <div className="card overflow-x-auto h-fit">
          <table className="table">
            <thead><tr>{['نام', 'کد ملی', 'آخرین ورود', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="text-center py-8" style={{ color: 'var(--muted)' }}>موردی نیست</td></tr> :
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.fullName || '—'}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.nationalCodeMasked}</td>
                    <td>{r.lastLoginAt || '—'}</td>
                    <td><span className={`badge ${r.isActive ? 'badge-success' : 'badge-neutral'}`}>{r.isActive ? 'فعال' : 'غیرفعال'}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
