'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { ErrorBox, Spinner } from '../../components/ui';
import { Flash } from '../../components/Toaster';

interface SessionRow {
  id: string; realm: string; realmLabel: string; actorId: string; actorLabel: string | null; tenantName: string | null;
  deviceId: string | null; fingerprint: string | null; deviceLabel: string | null; userAgent: string | null; ip: string | null; location: string | null;
  createdAt: string; lastSeenAt: string; activeNow: boolean; endedAt: string | null; endReason: string | null; alerts: number;
}
interface AlertRow {
  id: string; kind: string; kindLabel: string; realm: string; actorId: string; actorLabel: string | null; message: string; smsSent: boolean; seen: boolean; createdAt: string;
  sessionId: string; session: { deviceLabel: string | null; ip: string | null; location: string | null; deviceId: string | null; tenantName: string | null } | null;
}
interface Settings {
  smsEnabled: boolean; phones: string[]; kinds: string[]; realms: string[]; workHoursStart: number; workHoursEnd: number; offHoursFriday: boolean;
  allKinds: { key: string; label: string }[]; allRealms: { key: string; label: string }[];
}

const KIND_COLOR: Record<string, string> = { NEW_DEVICE: 'badge-warning', CONCURRENT: 'badge-danger', IMPOSSIBLE_TRAVEL: 'badge-danger', SHARED_DEVICE: 'badge-danger', OFF_HOURS: 'badge-neutral' };
const END_FA: Record<string, string> = { LOGOUT: 'خروج کاربر', ADMIN: 'پایان توسط مدیر سامانه' };
const short = (v: string | null) => (v ? v.slice(0, 8) : '—');
const tab = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });

/**
 * «امنیت ورود» (Super Admin): every sign-in with the device and place it came from, the alerts that may
 * mean someone is using another person's account, and who gets those alerts by SMS.
 */
export default function AdminSecurity() {
  const router = useRouter();
  const [view, setView] = useState<'alerts' | 'sessions' | 'settings'>('alerts');
  const [error, setError] = useState('');
  const [unseen, setUnseen] = useState(0);
  useEffect(() => { if (!getToken('super')) router.push('/admin/login'); }, [router]);

  return (
    <div>
      <div className="flex justify-between items-center mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">امنیت ورود</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>هر ورود با دستگاه، نشانی IP و مکان آن؛ هشدار ورودهای مشکوک و پیامک به شمارهٔ شما</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت</Link>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <button className="btn btn-sm" style={tab(view === 'alerts')} onClick={() => setView('alerts')}>هشدارها{unseen ? ` (${unseen.toLocaleString('fa-IR')} تازه)` : ''}</button>
        <button className="btn btn-sm" style={tab(view === 'sessions')} onClick={() => setView('sessions')}>نشست‌ها و دستگاه‌ها</button>
        <button className="btn btn-sm" style={tab(view === 'settings')} onClick={() => setView('settings')}>تنظیمات هشدار و پیامک</button>
      </div>
      <ErrorBox message={error} />
      {view === 'alerts' && <Alerts setError={setError} setUnseen={setUnseen} />}
      {view === 'sessions' && <Sessions setError={setError} />}
      {view === 'settings' && <AlertSettings setError={setError} />}
      <p className="text-xs mt-6" style={{ color: 'var(--muted)' }}>
        وب‌سایت‌ها به نشانی MAC دسترسی ندارند؛ به‌جای آن «شناسهٔ دستگاه» (در همان مرورگر نگه داشته می‌شود) و «اثر انگشت مرورگر»
        (از ویژگی‌های سیستم، صفحه، زبان و کارت گرافیک؛ با پاک کردن مرورگر هم تغییر نمی‌کند) ثبت می‌شود.
      </p>
    </div>
  );
}

function Alerts({ setError, setUnseen }: { setError: (s: string) => void; setUnseen: (n: number) => void }) {
  const [onlyNew, setOnlyNew] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; unseen: number; items: AlertRow[] } | null>(null);
  const load = () => client.get<{ total: number; unseen: number; items: AlertRow[] }>(`/platform/security/alerts?page=${page}${onlyNew ? '&unseen=1' : ''}`, 'super')
    .then((d) => { setData(d); setUnseen(d.unseen); }).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, onlyNew]);
  const seen = async (ids?: string[]) => { try { await client.post('/platform/security/alerts/seen', { ids }, 'super'); load(); } catch (e: any) { setError(e.message); } };

  if (!data) return <div className="card p-8 text-center"><Spinner /></div>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={onlyNew} onChange={(e) => { setPage(1); setOnlyNew(e.target.checked); }} /> فقط هشدارهای تازه</label>
        {data.unseen > 0 && <button onClick={() => seen()} className="btn btn-ghost btn-sm mr-auto">همه را دیدم</button>}
      </div>
      {data.items.length === 0 ? <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>هشداری نیست.</div> : data.items.map((a) => (
        <div key={a.id} className="card p-4" style={{ borderInlineStart: a.seen ? undefined : '4px solid var(--danger)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <span className={`badge ${KIND_COLOR[a.kind] ?? 'badge-neutral'}`}>{a.kindLabel}</span>
              <b className="text-sm">{a.actorLabel || a.actorId}</b>
              {a.session?.tenantName && <span className="text-xs" style={{ color: 'var(--muted)' }}>— {a.session.tenantName}</span>}
            </span>
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--muted)' }}>
              {a.smsSent && <span className="badge badge-success">پیامک شد</span>}
              {a.createdAt}
            </span>
          </div>
          <p className="text-sm mt-2">{a.message}</p>
          <div className="text-xs mt-2 flex gap-3 flex-wrap" style={{ color: 'var(--muted)' }}>
            {a.session?.deviceLabel && <span>دستگاه: {a.session.deviceLabel}</span>}
            {a.session?.ip && <span dir="ltr">IP: {a.session.ip}</span>}
            {a.session?.location && <span>مکان: {a.session.location}</span>}
            {a.session?.deviceId && <span dir="ltr">شناسهٔ دستگاه: {short(a.session.deviceId)}</span>}
            {!a.seen && <button onClick={() => seen([a.id])} className="mr-auto" style={{ color: 'var(--brand)' }}>دیدم</button>}
          </div>
        </div>
      ))}
      <Pager page={page} total={data.total} setPage={setPage} />
    </div>
  );
}

function Sessions({ setError }: { setError: (s: string) => void }) {
  const [f, setF] = useState({ active: true, realm: '', actor: '', device: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: SessionRow[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = new URLSearchParams({ page: String(page), ...(f.active ? { active: '1' } : {}), ...(f.realm ? { realm: f.realm } : {}), ...(f.actor ? { actor: f.actor } : {}), ...(f.device ? { device: f.device } : {}) });
  const load = () => client.get<{ total: number; items: SessionRow[] }>(`/platform/security/sessions?${q}`, 'super').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, f.active, f.realm, f.actor, f.device]);
  const end = async (s: SessionRow) => {
    if (!window.confirm(`نشست «${s.actorLabel || s.actorId}» روی ${s.deviceLabel || 'این دستگاه'} پایان یابد؟ همان لحظه از سامانه خارج می‌شود.`)) return;
    try { await client.post(`/platform/security/sessions/${s.id}/end`, {}, 'super'); load(); } catch (e: any) { setError(e.message); }
  };
  const endAll = async (s: SessionRow) => {
    if (!window.confirm(`همهٔ نشست‌های باز «${s.actorLabel || s.actorId}» پایان یابد؟`)) return;
    try { await client.post('/platform/security/sessions/end-all', { realm: s.realm, actorId: s.actorId }, 'super'); load(); } catch (e: any) { setError(e.message); }
  };
  const filterBy = (patch: Partial<typeof f>) => { setPage(1); setF({ ...f, active: false, ...patch }); };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.active} onChange={(e) => { setPage(1); setF({ ...f, active: e.target.checked }); }} /> فقط نشست‌های باز</label>
        <select className="input" style={{ maxWidth: 220 }} value={f.realm} onChange={(e) => { setPage(1); setF({ ...f, realm: e.target.value }); }}>
          <option value="">همهٔ کاربران</option><option value="ORG">کاربران سازمان‌ها</option><option value="CUSTOMER">بیمه‌گزار و نمایندگان</option><option value="SUPER">مدیر سامانه</option>
        </select>
        {(f.actor || f.device) && <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, actor: '', device: '' })}>حذف فیلتر {f.actor ? 'کاربر' : 'دستگاه'} ✕</button>}
      </div>
      {!data ? <div className="card p-8 text-center"><Spinner /></div> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{['کاربر', 'دستگاه', 'IP و مکان', 'ورود', 'آخرین فعالیت', 'وضعیت', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.items.length === 0 ? <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>نشستی نیست</td></tr> : data.items.map((s) => (
                <Fragment key={s.id}>
                  <tr>
                    <td>
                      <button className="font-semibold text-right" style={{ color: 'var(--brand)' }} title="همهٔ ورودهای این کاربر" onClick={() => filterBy({ actor: s.actorId, device: '' })}>{s.actorLabel || s.actorId}</button>
                      <div className="text-xs" style={{ color: 'var(--muted)' }}>{s.realmLabel}{s.tenantName ? ` — ${s.tenantName}` : ''}</div>
                    </td>
                    <td className="text-xs">
                      {s.deviceLabel || '—'}
                      <div>{s.deviceId ? <button dir="ltr" style={{ color: 'var(--brand)' }} title="همهٔ ورودها از این دستگاه" onClick={() => filterBy({ device: s.deviceId!, actor: '' })}>#{short(s.deviceId)}</button> : <span style={{ color: 'var(--muted)' }}>بدون شناسه</span>}</div>
                    </td>
                    <td className="text-xs"><span dir="ltr">{s.ip || '—'}</span><div style={{ color: 'var(--muted)' }}>{s.location || 'مکان نامشخص'}</div></td>
                    <td className="text-xs">{s.createdAt}</td>
                    <td className="text-xs">{s.lastSeenAt}</td>
                    <td className="text-xs">
                      {s.endedAt ? <span className="badge badge-neutral" title={s.endedAt}>{END_FA[s.endReason || ''] || 'پایان‌یافته'}</span> : s.activeNow ? <span className="badge badge-success">فعال اکنون</span> : <span className="badge badge-warning">باز</span>}
                      {s.alerts > 0 && <span className="badge badge-danger mr-1">{s.alerts.toLocaleString('fa-IR')} هشدار</span>}
                    </td>
                    <td className="text-xs">
                      <span className="flex gap-2 flex-wrap">
                        <button onClick={() => setOpen(open === s.id ? null : s.id)} style={{ color: 'var(--muted)' }}>جزئیات</button>
                        {!s.endedAt && <button onClick={() => end(s)} style={{ color: 'var(--danger)' }}>پایان نشست</button>}
                        {!s.endedAt && <button onClick={() => endAll(s)} style={{ color: 'var(--danger)' }}>پایان همهٔ نشست‌های این کاربر</button>}
                      </span>
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr><td colSpan={7} className="text-xs" style={{ background: 'var(--surface-2)' }}>
                      <div dir="ltr" style={{ textAlign: 'left' }}>
                        <div>device id: {s.deviceId || '—'}</div>
                        <div>fingerprint: {s.fingerprint ? <button style={{ color: 'var(--brand)' }} onClick={() => filterBy({ device: s.fingerprint!, actor: '' })}>{s.fingerprint}</button> : '—'}</div>
                        <div>user agent: {s.userAgent || '—'}</div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} setPage={setPage} />}
    </div>
  );
}

function AlertSettings({ setError }: { setError: (s: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get<Settings>('/platform/security/settings', 'super').then(setS).catch((e) => setError(e.message)); }, [setError]);
  if (!s) return <div className="card p-8 text-center"><Spinner /></div>;

  const save = async (patch: Partial<Settings>) => {
    setError(''); setMsg(''); setBusy(true);
    try {
      const { smsEnabled, phones, kinds, realms, workHoursStart, workHoursEnd, offHoursFriday } = { ...s, ...patch };
      setS(await client.put<Settings>('/platform/security/settings', { smsEnabled, phones, kinds, realms, workHoursStart, workHoursEnd, offHoursFriday }, 'super'));
      setMsg('ذخیره شد');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const test = async () => {
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await client.post<{ results: { phone: string; ok: boolean; error?: string }[] }>('/platform/security/settings/test-sms', {}, 'super');
      setMsg(r.results.map((x) => `${x.phone}: ${x.ok ? 'ارسال شد' : `ناموفق (${x.error})`}`).join(' — '));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-5 space-y-4">
        <h3 className="font-bold">پیامک هشدار</h3>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={s.smsEnabled} disabled={busy} onChange={(e) => save({ smsEnabled: e.target.checked })} />
          <b>ارسال پیامک هشدار فعال باشد</b>
        </label>
        <div>
          <div className="text-sm font-semibold mb-2">شماره‌های دریافت هشدار (فقط شماره‌های شما — حداکثر ۵)</div>
          {s.phones.length === 0 && <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>هنوز شماره‌ای ثبت نشده است.</div>}
          {s.phones.map((p) => (
            <div key={p} className="flex items-center justify-between rounded-lg px-3 py-2 mb-1.5 text-sm" style={{ background: 'var(--surface-2)' }}>
              <span dir="ltr">{p}</span>
              <button className="text-xs" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => save({ phones: s.phones.filter((x) => x !== p), ...(s.phones.length === 1 ? { smsEnabled: false } : {}) })}>حذف</button>
            </div>
          ))}
          {s.phones.length < 5 && (
            <div className="flex gap-2 mt-2">
              <input className="input" placeholder="09xxxxxxxxx یا +98…" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
              <button className="btn btn-primary btn-sm" disabled={busy || !phone.trim()} onClick={async () => { await save({ phones: [...s.phones, phone.trim()] }); setPhone(''); }}>افزودن</button>
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy || !s.phones.length} onClick={test}>ارسال پیامک آزمایشی</button>
        <Flash id={msg} text={msg} ok />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>پیامک‌ها از درگاه پیامک سکو ارسال می‌شوند. یک هشدار تکراری دربارهٔ یک حساب، حداکثر هر ۶ ساعت یک بار پیامک می‌شود (ولی همیشه در «هشدارها» ثبت می‌شود).</p>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold">برای چه هشدارهایی پیامک بیاید</h3>
        <div className="space-y-1.5">
          {s.allKinds.map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={s.kinds.includes(k.key)} disabled={busy} onChange={() => save({ kinds: toggle(s.kinds, k.key) })} /> {k.label}
            </label>
          ))}
        </div>
        <div>
          <div className="text-sm font-semibold mb-1.5">ورود چه کسانی پیامک داشته باشد</div>
          {s.allRealms.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={s.realms.includes(r.key)} disabled={busy} onChange={() => save({ realms: toggle(s.realms, r.key) })} /> {r.label}
            </label>
          ))}
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>ورود با کد بیمه‌گزار معمولاً بین همکاران شرکت مشترک است و هشدار «دستگاه جدید» زیادی می‌سازد؛ برای همین پیش‌فرض خاموش است. همهٔ هشدارها در هر حال ثبت می‌شوند.</p>
        </div>
        <div>
          <div className="text-sm font-semibold mb-1.5">ساعت کاری (به وقت تهران)</div>
          <div className="flex items-center gap-2 text-sm">
            از <input className="input" type="number" min={0} max={23} style={{ width: 80 }} value={s.workHoursStart} onChange={(e) => setS({ ...s, workHoursStart: Number(e.target.value) })} />
            تا <input className="input" type="number" min={1} max={24} style={{ width: 80 }} value={s.workHoursEnd} onChange={(e) => setS({ ...s, workHoursEnd: Number(e.target.value) })} />
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save({})}>ذخیره</button>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-2">
            <input type="checkbox" checked={s.offHoursFriday} disabled={busy} onChange={(e) => save({ offHoursFriday: e.target.checked })} /> ورود در روز جمعه هم «خارج از ساعت کاری» حساب شود
          </label>
        </div>
      </div>
    </div>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 50));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center text-sm">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</button>
      <span>{page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>بعدی</button>
    </div>
  );
}
