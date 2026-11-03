'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Branch { id: string; name: string; code: string }
interface Agent { id: string; fullName: string | null; nationalCode: string; phone: string; branchId: string | null; branchName: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null }
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * «نمایندگان بیمه» (insurer admin, panel 2): the insurer's own insurance agents. Each is tied to one شعبه;
 * they sign in to the insurer's panel 1 with کد ملی + password (first password = کد ملی, changed at first
 * sign-in), file cases for their own customers, and «ارسال» sends a case to their شعبه.
 */
export default function Agents() {
  const [data, setData] = useState<{ branches: Branch[]; agents: Agent[] } | null>(null);
  const [f, setF] = useState({ fullName: '', nationalCode: '', phone: '', branchId: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => client.get<{ branches: Branch[]; agents: Agent[] }>('/customer/agents', 'org').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setError(''); setMsg(''); setBusy(true);
    try { const r = await fn(); setMsg(r?.message || ok); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const add = () => act(async () => {
    await client.post('/customer/agents', { fullName: f.fullName.trim(), nationalCode: toAscii(f.nationalCode).trim(), phone: toAscii(f.phone).trim(), branchId: f.branchId }, 'org');
    setF({ fullName: '', nationalCode: '', phone: '', branchId: f.branchId });
  }, 'نماینده افزوده شد؛ نخستین رمز عبور کد ملی اوست.');

  return (
    <Shell title="نمایندگان بیمه" nav={ORG_NAV} realm="org">
      <div className="space-y-4">
        <ErrorBox message={error} />
        {msg && <div className="alert-success">{msg}</div>}
        <section className="card p-4 space-y-3">
          <h2 className="font-bold">افزودن نماینده</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>نماینده با کد ملی و رمز عبور از «ورود برای بارگزاری مدارک» در صفحهٔ اصلی وارد پنل این بیمه‌گر می‌شود، برای مشتریان خود پرونده ثبت می‌کند و با «ارسال»، پرونده به شعبهٔ او می‌رود.</p>
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="نام و نام خانوادگی"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
            <Field label="کد ملی"><input className="input latin-digits" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="شمارهٔ همراه"><input className="input latin-digits" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="شعبه">
              <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                <option value="">— انتخاب شعبه —</option>
                {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </Field>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || f.fullName.trim().length < 2 || !f.nationalCode.trim() || !f.phone.trim() || !f.branchId} onClick={add}>افزودن نماینده</button>
        </section>

        <section className="card p-0 overflow-x-auto">
          <table className="table w-full text-sm">
            <thead><tr><th>نام</th><th>کد ملی</th><th>همراه</th><th>شعبه</th><th>آخرین ورود</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={7} className="text-center py-6">…</td></tr>
                : !data.agents.length ? <tr><td colSpan={7} className="text-center py-6" style={{ color: 'var(--muted)' }}>هنوز نماینده‌ای ثبت نشده است.</td></tr>
                : data.agents.map((a) => (
                  <tr key={a.id}>
                    <td>{a.fullName || '—'}</td>
                    <td><bdi className="latin-digits">{a.nationalCode}</bdi></td>
                    <td><bdi className="latin-digits">{a.phone || '—'}</bdi></td>
                    <td>
                      <select className="input" style={{ minWidth: 150 }} value={a.branchId ?? ''} disabled={busy} onChange={(e) => e.target.value && act(() => client.patch(`/customer/agents/${a.id}`, { branchId: e.target.value }, 'org'), 'شعبهٔ نماینده تغییر کرد.')}>
                        {!a.branchId && <option value="">— بدون شعبه —</option>}
                        {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                      </select>
                    </td>
                    <td>{a.lastLoginAt || '—'}</td>
                    <td>{a.isActive ? <span className="badge badge-success">فعال</span> : <span className="badge badge-neutral">غیرفعال</span>}{a.mustChangePassword && <span className="badge badge-warning mr-1">رمز اولیه</span>}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.patch(`/customer/agents/${a.id}`, { active: !a.isActive }, 'org'), a.isActive ? 'نماینده غیرفعال شد.' : 'نماینده فعال شد.')}>{a.isActive ? 'غیرفعال' : 'فعال'}</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.post(`/customer/accounts/${a.id}/password`, {}, 'org'), 'رمز عبور به کد ملی بازنشانی شد.')}>بازنشانی رمز</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => window.confirm(`حذف «${a.fullName || 'نماینده'}»؟ پرونده‌هایی که ثبت کرده می‌مانند.`) && act(() => client.del(`/customer/accounts/${a.id}`, 'org'), 'نماینده حذف شد.')}>حذف</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
