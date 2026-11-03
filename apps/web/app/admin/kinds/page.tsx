'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';

interface KindRow { code?: string; label: string; active: boolean; contracts?: number; cases?: number }
interface Org { id: string; name: string; kind: 'BROKER' | 'INSURER'; kinds: string[] }
interface Data { kinds: KindRow[]; orgs: Org[] }

/**
 * Super Admin › انواع بیمه‌نامه: the catalog of kinds (add, rename, hide, delete — a kind with contracts
 * or cases can only be hidden), and which kinds each کارگزاری and بیمه‌گر offers on its panel 1. Each
 * kind's نوع پرونده and documents are set per insurer in Model View.
 */
export default function AdminKinds() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [rows, setRows] = useState<KindRow[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => client.get<Data>('/admin/policy-kinds', 'super').then((d) => { setData(d); setRows(d.kinds); }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { if (!getToken('super')) { router.push('/admin/login'); return; } load(); /* eslint-disable-next-line */ }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); setMsg({ ok: true, text: ok }); } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const saveKinds = () => run(() => client.put('/admin/policy-kinds', { kinds: rows.map(({ code, label, active }) => ({ code, label, active })) }, 'super'), 'انواع بیمه‌نامه ذخیره شد.');
  const setOrg = (o: Org, kinds: string[]) => run(() => client.put(`/admin/policy-kinds/org/${o.id}`, { kinds }, 'super'), `انواع بیمه‌نامهٔ «${o.name}» ذخیره شد.`);
  const changed = !!data && JSON.stringify(rows) !== JSON.stringify(data.kinds);
  const saved = (data?.kinds ?? []).filter((k) => k.active && k.code);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">انواع بیمه‌نامه</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/model" className="btn btn-ghost btn-sm">Model View</Link>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت</Link>
        </div>
      </div>
      {msg && <div className={msg.ok ? 'alert-success' : 'alert-error'}>{msg.text}</div>}
      {!data ? <div className="card p-10 flex justify-center"><Spinner /></div> : (
        <>
          <div className="card p-4 space-y-3">
            <h3 className="font-extrabold">فهرست انواع بیمه‌نامه</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              در ورود پنل ۱ (ورود برای بارگذاری مدارک) پیش از ورود انتخاب می‌شوند و پنل در همان نوع کار می‌کند. نوع پرونده و مدارک هر نوع را برای هر بیمه‌گر در Model View تعیین کنید؛ تا آن زمان ثبت پرونده در آن نوع بسته است.
              نوعی که قرارداد یا پرونده دارد حذف نمی‌شود؛ آن را غیرفعال کنید تا در ورودها دیده نشود.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.code ?? `new-${i}`} className="flex items-center gap-2 flex-wrap">
                  <input className="input flex-1 min-w-[200px]" aria-label="نام نوع بیمه‌نامه" value={r.label} maxLength={60} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={r.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /> فعال
                  </label>
                  <span className="text-xs" style={{ color: 'var(--muted)', minWidth: 140 }}>
                    {r.code ? `${(r.contracts ?? 0).toLocaleString('fa-IR')} قرارداد، ${(r.cases ?? 0).toLocaleString('fa-IR')} پرونده` : 'جدید'}
                  </span>
                  <button className="btn btn-ghost btn-sm" disabled={!!(r.contracts || r.cases)} title={r.contracts || r.cases ? 'قرارداد یا پرونده دارد؛ غیرفعالش کنید' : 'با ذخیره حذف می‌شود'}
                    style={{ color: 'var(--danger)' }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>حذف</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { label: 'نوع بیمه‌نامهٔ جدید', active: true }])}>افزودن نوع بیمه‌نامه</button>
              <button className="btn btn-primary" disabled={busy || !changed || rows.some((r) => r.label.trim().length < 2)} onClick={saveKinds}>ذخیره</button>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="font-extrabold">انواع بیمه‌نامهٔ هر سازمان در پنل ۱</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              انتخاب ورود پنل ۱ همان سازمان (کارکنان، بیمه‌گزار، نماینده و نماینده بیمه) فقط این انواع را نشان می‌دهد و پرونده فقط در همین انواع ثبت می‌شود. بدون تیک = همهٔ انواع فعال. پنل ۲ همهٔ انواع را می‌بیند.
            </p>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>سازمان</th>{saved.map((k) => <th key={k.code}>{k.label}</th>)}<th /></tr></thead>
                <tbody>
                  {data.orgs.map((o) => {
                    const all = o.kinds.length === 0;
                    return (
                      <tr key={o.id}>
                        <td><b>{o.name}</b> <span className="text-xs" style={{ color: 'var(--muted)' }}>{o.kind === 'INSURER' ? 'بیمه‌گر' : 'کارگزاری'}</span></td>
                        {saved.map((k) => (
                          <td key={k.code}>
                            <input type="checkbox" aria-label={`${k.label} برای ${o.name}`} disabled={busy} checked={all || o.kinds.includes(k.code!)}
                              onChange={(e) => {
                                const cur = all ? saved.map((x) => x.code!) : o.kinds;
                                const next = e.target.checked ? [...cur, k.code!] : cur.filter((c) => c !== k.code);
                                if (!next.length) { setMsg({ ok: false, text: 'هر سازمان دست‌کم یک نوع بیمه‌نامه دارد.' }); return; }
                                setOrg(o, next.length === saved.length ? [] : next);
                              }} />
                          </td>
                        ))}
                        <td className="text-xs" style={{ color: 'var(--muted)' }}>{all ? 'همهٔ انواع' : `${o.kinds.length.toLocaleString('fa-IR')} نوع`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
