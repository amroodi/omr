'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';

interface Rights { upload: boolean; submit: boolean }
interface Model { councilEnabled: boolean; requireLossNotice: boolean; requireOriginals: boolean; panels: { COMPANY: Rights; REPRESENTATIVE: Rights } }
interface Insurer { id: string; name: string; customized: boolean; casesAtCouncil: number; model: Model }

const PANEL_FA = { COMPANY: 'پنل بیمه‌گزار', REPRESENTATIVE: 'پنل نماینده' } as const;

function Toggle({ on, onChange, children, hint }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{children}</b>{hint && <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</span>}</span>
    </label>
  );
}

/** Model View: how each insurer's chain works. Only Super Admin reaches it; every save is in the audit log. */
export default function ModelView() {
  const router = useRouter();
  const [rows, setRows] = useState<Insurer[] | null>(null);
  const [defaults, setDefaults] = useState<Model | null>(null);
  const [id, setId] = useState('');
  const [m, setM] = useState<Model | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (keep?: string) => client.get<{ defaults: Model; insurers: Insurer[] }>('/admin/workflow-model', 'super').then((r) => {
    setRows(r.insurers); setDefaults(r.defaults);
    const pick = r.insurers.find((i) => i.id === keep) ?? r.insurers[0];
    if (pick) { setId(pick.id); setM(pick.model); }
  }).catch((e) => { setRows([]); setMsg({ t: 'err', m: e.message }); });
  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    load();
    // eslint-disable-next-line
  }, []);

  const cur = rows?.find((i) => i.id === id) ?? null;
  const dirty = !!m && !!cur && JSON.stringify(m) !== JSON.stringify(cur.model);
  const setPanel = (p: keyof Model['panels'], k: keyof Rights, v: boolean) => m && setM({ ...m, panels: { ...m.panels, [p]: { ...m.panels[p], [k]: v } } });
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await client.put(`/admin/workflow-model/${id}`, m, 'super'); await load(id); setMsg({ t: 'ok', m: 'ذخیره شد؛ از همین لحظه روی پرونده‌های این بیمه‌گر اعمال می‌شود.' }); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const chain = m ? ['بیمه‌گزار / نماینده', 'کارگزاری', 'شعبه', 'مدیریت ستاد', ...(m.councilEnabled ? ['شورای فنی'] : [])] : [];

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">Model View</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/network" className="btn btn-ghost btn-sm">نقشهٔ اتصال‌ها</Link>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
        </div>
      </div>
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      {!rows ? <div className="card p-8 text-center"><Spinner /></div> : !m || !cur ? <div className="card p-6 text-sm">بیمه‌گری ثبت نشده است.</div> : (
        <>
          <div className="card p-4 max-w-sm">
            <label className="text-sm">بیمه‌گر
              <select className="input mt-1" value={id} onChange={(e) => { const x = rows.find((i) => i.id === e.target.value)!; setId(x.id); setM(x.model); setMsg(null); }}>
                {rows.map((i) => <option key={i.id} value={i.id}>{i.name}{i.customized ? ' (سفارشی)' : ''}</option>)}
              </select>
            </label>
          </div>

          <div className="card p-4">
            <h3 className="font-extrabold mb-3">مسیر پرونده</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {chain.map((c, i) => <span key={c} className="flex items-center gap-2">{i > 0 && <span style={{ color: 'var(--muted)' }}>←</span>}<span className="badge badge-info">{c}</span></span>)}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="font-extrabold">پنل‌های بیمه‌گزار و نماینده</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {(['COMPANY', 'REPRESENTATIVE'] as const).map((p) => (
                <div key={p} className="space-y-2">
                  <div className="font-bold text-sm">{PANEL_FA[p]}</div>
                  <Toggle on={m.panels[p].upload} onChange={(v) => setPanel(p, 'upload', v)}>بارگذاری مدارک</Toggle>
                  <Toggle on={m.panels[p].submit} onChange={(v) => setPanel(p, 'submit', v)}>ارسال پرونده به مرحلهٔ بعد</Toggle>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="font-extrabold">شعبه</h3>
            <Toggle on={m.requireLossNotice} onChange={(v) => setM({ ...m, requireLossNotice: v })} hint="خاموش: شعبه بدون ثبت اعلام خسارت هم می‌تواند پرونده را ارسال کند.">ثبت اعلام خسارت الزامی است</Toggle>
            <Toggle on={m.requireOriginals} onChange={(v) => setM({ ...m, requireOriginals: v })} hint="خاموش: درخواست اصل مدارک همچنان ممکن است، اما شرط ارسال نیست.">دریافت اصل مدارک پیش از ارسال الزامی است</Toggle>
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="font-extrabold">مدیریت ستاد و شورای فنی</h3>
            <Toggle on={m.councilEnabled} onChange={(v) => setM({ ...m, councilEnabled: v })} hint="خاموش: ستاد خودش دستور پرداخت می‌دهد و سقف اختیار ستاد اعمال نمی‌شود.">شورای فنی فعال است</Toggle>
            {!m.councilEnabled && cur.casesAtCouncil > 0 && (
              <div className="text-xs rounded-lg p-2" style={{ background: 'var(--warning-soft)' }}>{cur.casesAtCouncil.toLocaleString('fa-IR')} پرونده اکنون نزد شورای فنی است و تا پایان همان‌جا می‌ماند.</div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? '…' : 'ذخیره'}</button>
            {defaults && <button className="btn btn-ghost" disabled={busy || JSON.stringify(m) === JSON.stringify(defaults)} onClick={() => setM(defaults)}>بازگشت به پیش‌فرض</button>}
          </div>
        </>
      )}
    </div>
  );
}
