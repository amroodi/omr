'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { CUSTOMER_NAV } from '../nav';

interface Rep { id: string; fullName: string | null; nationalCode: string | null; phone: string | null; active: boolean; mustChangePassword: boolean; createdAt: string | null; lastLoginAt: string | null }
const EMPTY = { fullName: '', nationalCode: '', phone: '', password: '' };

/**
 * «نمایندگان»: the بیمه‌گزار company adds the people who work in this panel on its behalf. Each signs in
 * with their own کد ملی + password; what they file goes through the same path as the company's own cases
 * (بیمه‌گزار → کارگزاری → …). Only the company login sees this page.
 */
export default function Representatives() {
  const router = useRouter();
  const [rows, setRows] = useState<Rep[] | null>(null);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => client.get<Rep[]>('/customer/representatives', 'customer').then(setRows).catch((e) => { setRows([]); setMsg({ ok: false, text: e.message }); });
  useEffect(() => { if (!getToken('customer')) { router.push('/customer/login'); return; } load(); /* eslint-disable-next-line */ }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null); setBusy(true);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await client.post('/customer/representatives', { ...f, fullName: f.fullName.trim() || undefined, password: f.password.trim() || undefined }, 'customer');
      setF(EMPTY);
    }, f.password.trim() ? 'نماینده ثبت شد.' : 'نماینده ثبت شد؛ رمز ورود اولیهٔ او کد ملی‌اش است و در اولین ورود آن را تغییر می‌دهد.');
  };
  const name = (r: Rep) => r.fullName || r.nationalCode || 'این نماینده';
  const resetPassword = (r: Rep) => {
    const pw = window.prompt(`رمز عبور تازهٔ «${name(r)}» (دست‌کم ۸ نویسه).\nخالی بگذارید تا رمز به کد ملی او بازنشانی شود:`, '');
    if (pw === null) return;
    run(() => client.post(`/customer/representatives/${r.id}/password`, { password: pw.trim() || undefined }, 'customer'), pw.trim() ? 'رمز عبور تنظیم شد.' : 'رمز عبور به کد ملی بازنشانی شد.');
  };
  const setActive = (r: Rep, active: boolean) => {
    if (!active && !window.confirm(`ورود «${name(r)}» تا فعال‌سازی دوباره متوقف شود؟`)) return;
    run(() => client.post(`/customer/representatives/${r.id}/active`, { active }, 'customer'), active ? 'نماینده فعال شد.' : 'ورود نماینده متوقف شد.');
  };
  const remove = (r: Rep) => {
    if (!window.confirm(`«${name(r)}» از نمایندگان حذف شود؟\nدیگر نمی‌تواند وارد شود؛ پرونده‌هایی که ثبت کرده برای شرکت باقی می‌مانند.`)) return;
    run(() => client.del(`/customer/representatives/${r.id}`, 'customer'), 'نماینده حذف شد.');
  };

  return (
    <Shell title="نمایندگان" breadcrumb="نمایندگان" nav={CUSTOMER_NAV} realm="customer">
      <div className="space-y-4">
        <form onSubmit={add} className="pcard p-5 space-y-3">
          <h3 className="font-extrabold">افزودن نماینده</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            نماینده با کد ملی خود و رمز عبور وارد همین پنل می‌شود و برای شرکت پرونده ثبت و مدارک بارگذاری می‌کند.
            پرونده‌های او مانند پرونده‌های شرکت برای بررسی به کارگزاری و سپس بیمه‌گر ارسال می‌شوند.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input className="input cu-pill" placeholder="نام و نام خانوادگی" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
            <input className="input cu-pill" placeholder="کد ملی *" inputMode="numeric" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} />
            <input className="input cu-pill" placeholder="موبایل * (۰۹۱۲…)" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} />
            <input className="input cu-pill" type="text" autoComplete="new-password" placeholder="رمز عبور (خالی = کد ملی)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} />
          </div>
          {msg && <div className={msg.ok ? 'alert-success' : 'alert-error'}>{msg.text}</div>}
          <button type="submit" className="cu-go" disabled={busy || !f.nationalCode || !f.phone}>{busy ? '…' : 'ثبت نماینده'}</button>
        </form>

        <div className="pcard overflow-x-auto">
          <table className="table">
            <thead><tr>{['نام', 'کد ملی', 'موبایل', 'وضعیت', 'آخرین ورود', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {!rows ? <tr><td colSpan={6} className="text-center py-8"><span className="pspinner inline-block" /></td></tr>
                : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>هنوز نماینده‌ای ثبت نکرده‌اید.</td></tr>
                : rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.fullName || '—'}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.nationalCode}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.phone || '—'}</td>
                    <td>
                      {r.active ? <span className="badge badge-success">فعال</span> : <span className="badge badge-neutral">غیرفعال</span>}
                      {r.active && r.mustChangePassword && <span className="badge badge-warning mr-1" title="هنوز با کد ملی وارد می‌شود و باید رمز را تغییر دهد">رمز پیش‌فرض</span>}
                    </td>
                    <td className="text-xs">{r.lastLoginAt || '—'}</td>
                    <td>
                      <span className="flex gap-3 text-xs">
                        <button onClick={() => resetPassword(r)} disabled={busy} style={{ color: 'var(--brand)' }}>تعیین رمز</button>
                        {r.active
                          ? <button onClick={() => setActive(r, false)} disabled={busy} style={{ color: 'var(--warning)' }}>توقف ورود</button>
                          : <button onClick={() => setActive(r, true)} disabled={busy} style={{ color: 'var(--success)' }}>فعال‌سازی</button>}
                        <button onClick={() => remove(r)} disabled={busy} style={{ color: 'var(--danger)' }}>حذف</button>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
