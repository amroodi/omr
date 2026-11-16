'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';
import { Flash } from '../../components/Toaster';

interface Doctor { id: string; fullName: string; username: string; phone: string | null; medicalCode: string | null; specialty: string | null; isActive: boolean; lastLoginAt: string | null; insurerIds: string[]; pending: number }
interface Data { insurers: { id: string; name: string }[]; doctors: Doctor[] }
type Form = { id?: string; fullName: string; username: string; password: string; phone: string; medicalCode: string; specialty: string; isActive: boolean; insurerIds: string[] };
const EMPTY: Form = { fullName: '', username: '', password: '', phone: '', medicalCode: '', specialty: '', isActive: true, insurerIds: [] };

/**
 * Super Admin › پزشکان معتمد: the doctors' own accounts and the insurers each one works with. Only a doctor
 * linked to an insurer is offered in that insurer's «انتخاب پزشک معتمد»; doctors sign in at /doctor/login.
 */
export default function AdminDoctors() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => client.get<Data>('/admin/doctors', 'super').then(setData).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { if (!getToken('super')) { router.push('/admin/login'); return; } load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!f) return;
    setBusy(true); setMsg(null);
    const body = { fullName: f.fullName, username: f.username, phone: f.phone, medicalCode: f.medicalCode, specialty: f.specialty, isActive: f.isActive, insurerIds: f.insurerIds, ...(f.password ? { password: f.password } : {}) };
    try {
      if (f.id) await client.put(`/admin/doctors/${f.id}`, body, 'super'); else await client.post('/admin/doctors', body, 'super');
      setF(null); await load(); setMsg({ ok: true, text: 'ذخیره شد' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const remove = async (d: Doctor) => {
    if (!window.confirm(`«${d.fullName}» حذف شود؟ اگر پرونده‌ای به او ارجاع شده باشد، فقط غیرفعال می‌شود.`)) return;
    try { const r = await client.del<{ removed: boolean }>(`/admin/doctors/${d.id}`, 'super'); await load(); setMsg({ ok: true, text: r?.removed ? 'حذف شد' : 'غیرفعال شد' }); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  const name = (id: string) => data?.insurers.find((i) => i.id === id)?.name ?? '—';

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">پزشکان معتمد</h1>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary btn-sm" onClick={() => setF({ ...EMPTY })}>+ پزشک جدید</button>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت</Link>
        </div>
      </div>
      <Flash id={msg} text={msg?.text} ok={!!msg && msg.ok} />
      {f && data && (
        <div className="card p-4 space-y-3">
          <h3 className="font-extrabold">{f.id ? 'ویرایش پزشک' : 'پزشک جدید'}</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block"><span className="label">نام و نام خانوادگی *</span><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={120} /></label>
            <label className="block"><span className="label">تخصص</span><input className="input" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} maxLength={80} /></label>
            <label className="block"><span className="label">شماره نظام پزشکی</span><input className="input" dir="ltr" value={f.medicalCode} onChange={(e) => setF({ ...f, medicalCode: e.target.value })} maxLength={30} /></label>
            <label className="block"><span className="label">شمارهٔ همراه</span><input className="input" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} /></label>
            <label className="block"><span className="label">نام کاربری *</span><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} maxLength={60} autoComplete="off" /></label>
            <label className="block"><span className="label">{f.id ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور *'}</span><input className="input" dir="ltr" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} maxLength={128} autoComplete="new-password" /></label>
          </div>
          <div>
            <span className="label">بیمه‌گرهایی که با او کار می‌کنند</span>
            <div className="flex flex-wrap gap-3 mt-1">
              {data.insurers.map((i) => (
                <label key={i.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={f.insurerIds.includes(i.id)} onChange={(e) => setF({ ...f, insurerIds: e.target.checked ? [...f.insurerIds, i.id] : f.insurerIds.filter((x) => x !== i.id) })} /> {i.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> فعال</label>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || f.fullName.trim().length < 2 || f.username.trim().length < 3 || (!f.id && f.password.length < 8)} onClick={save}>{busy ? '…' : 'ذخیره'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setF(null)}>انصراف</button>
          </div>
        </div>
      )}
      {!data ? <div className="card p-10 flex justify-center"><Spinner /></div> : (
        <div className="card overflow-x-auto">
          <table className="table text-sm w-full">
            <thead><tr><th>#</th><th>نام</th><th>تخصص</th><th>نظام پزشکی</th><th>نام کاربری</th><th>بیمه‌گرها</th><th>در انتظار</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              {data.doctors.length === 0 && <tr><td colSpan={9} className="text-center p-6" style={{ color: 'var(--muted)' }}>پزشکی تعریف نشده است.</td></tr>}
              {data.doctors.map((d, i) => (
                <tr key={d.id}>
                  <td>{(i + 1).toLocaleString('fa-IR')}</td>
                  <td className="font-bold">{d.fullName}</td>
                  <td>{d.specialty || '—'}</td>
                  <td dir="ltr">{d.medicalCode || '—'}</td>
                  <td dir="ltr">{d.username}</td>
                  <td>{d.insurerIds.length ? d.insurerIds.map(name).join('، ') : <span style={{ color: 'var(--danger)' }}>بدون بیمه‌گر</span>}</td>
                  <td>{d.pending.toLocaleString('fa-IR')}</td>
                  <td>{d.isActive ? <span className="badge badge-success">فعال</span> : <span className="badge badge-neutral">غیرفعال</span>}</td>
                  <td className="whitespace-nowrap">
                    <button className="text-xs ml-3" style={{ color: 'var(--brand)' }} onClick={() => setF({ id: d.id, fullName: d.fullName, username: d.username, password: '', phone: d.phone ?? '', medicalCode: d.medicalCode ?? '', specialty: d.specialty ?? '', isActive: d.isActive, insurerIds: d.insurerIds })}>ویرایش</button>
                    <button className="text-xs" style={{ color: 'var(--danger)' }} onClick={() => remove(d)}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
