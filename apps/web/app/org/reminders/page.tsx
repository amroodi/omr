'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { ORG_NAV } from '../nav';

interface Reminder {
  id: string; title: string; note: string | null; claimId: string | null; claimNumber: string | null; sms: boolean; smsSent: boolean;
  dueAt: string; dueAtFa: string; due: boolean; done: boolean; mine: boolean; byMe: boolean; assignee: string; createdBy: string;
}
interface Colleagues { smsAllowed: boolean; users: { id: string; name: string; me: boolean; hasPhone: boolean }[] }

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** «۱۴۰۵/۰۸/۱۰» + «۰۹:۳۰» (Tehran time) → ISO instant. */
function toInstant(date: string, time: string): string | null {
  const p = toAscii(date).split('/').map((x) => parseInt(x, 10));
  const t = toAscii(time || '09:00').split(':').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some(Number.isNaN) || t.length < 2 || t.some(Number.isNaN)) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  // Iran has no daylight saving: Tehran = UTC+03:30.
  const ms = Date.UTC(gy, gm - 1, gd, t[0], t[1]) - 210 * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * «یادآورها»: remind yourself or a colleague to do something at a time (optionally about a case). When it
 * falls due it appears in the notifications bell — and by SMS when chosen and allowed by the org admin.
 */
function Reminders() {
  const qs = useSearchParams();
  const [rows, setRows] = useState<Reminder[] | null>(null);
  const [col, setCol] = useState<Colleagues | null>(null);
  const [f, setF] = useState({ title: '', note: '', date: '', time: '09:00', assigneeId: '', sms: false });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'open' | 'done'>('open');
  const claimId = qs.get('claim') || '';
  const claimNumber = qs.get('n') || '';

  const load = () => client.get<Reminder[]>('/reminders', 'org').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    client.get<Colleagues>('/reminders/colleagues', 'org').then(setCol).catch(() => {});
    if (claimNumber) setF((x) => ({ ...x, title: `پیگیری پروندهٔ ${claimNumber}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setError(''); setOk('');
    const dueAt = toInstant(f.date, f.time);
    if (!dueAt) return setError('تاریخ و ساعت یادآوری را درست وارد کنید (نمونه: ۱۴۰۵/۰۸/۱۰ و ۰۹:۳۰).');
    setBusy(true);
    try {
      await client.post('/reminders', { title: f.title.trim(), note: f.note.trim() || undefined, dueAt, assigneeId: f.assigneeId || undefined, sms: f.sms, claimId: claimId || undefined }, 'org');
      setOk('یادآور ثبت شد.'); setF((x) => ({ ...x, title: '', note: '', date: '', sms: false }));
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const setDone = async (r: Reminder, done: boolean) => { try { await client.post(`/reminders/${r.id}/done`, { done }, 'org'); load(); } catch (e: any) { setError(e.message); } };
  const remove = async (r: Reminder) => { if (!window.confirm(`یادآور «${r.title}» حذف شود؟`)) return; try { await client.del(`/reminders/${r.id}`, 'org'); load(); } catch (e: any) { setError(e.message); } };

  const target = col?.users.find((u) => u.id === f.assigneeId) ?? col?.users.find((u) => u.me);
  const list = (rows ?? []).filter((r) => (show === 'done') === r.done);
  return (
    <Shell title="یادآورها" subtitle="یادآوری کار برای خودتان یا همکاران؛ در زمان مقرر در اعلان‌ها (و در صورت انتخاب، با پیامک) نمایش داده می‌شود" nav={ORG_NAV} realm="org">
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] gap-5">
        <div className="card p-4 space-y-3 h-fit">
          <h3 className="font-semibold text-sm">یادآور تازه{claimNumber ? ` — پروندهٔ ${claimNumber}` : ''}</h3>
          <ErrorBox message={error} />
          {ok && <div className="alert-success text-sm">{ok}</div>}
          <Field label="عنوان *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} placeholder="مثلاً تماس با بیمه‌گزار برای کسری مدارک" /></Field>
          <Field label="توضیحات"><textarea className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} /></Field>
          <Field label="یادآوری به">
            <select className="input" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">خودم</option>
              {col?.users.filter((u) => !u.me).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <Field label="تاریخ *"><JalaliDatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} placeholder="۱۴۰۵/۰۸/۱۰" /></Field>
            <Field label="ساعت"><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} style={{ direction: 'ltr' }} /></Field>
          </div>
          {col?.smsAllowed ? (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-1" checked={f.sms} onChange={(e) => setF({ ...f, sms: e.target.checked })} />
              <span>پیامک هم ارسال شود{target && !target.hasPhone ? <span className="block text-xs" style={{ color: 'var(--danger)' }}>برای این کاربر شمارهٔ همراه ثبت نشده است («کاربران و نقش‌ها»).</span> : null}</span>
            </label>
          ) : <p className="text-xs" style={{ color: 'var(--muted)' }}>ارسال پیامک یادآور را مدیر سازمان در «تنظیمات سازمان» فعال می‌کند.</p>}
          <button onClick={create} disabled={busy || !f.title.trim() || !f.date} className="btn btn-primary btn-sm w-full">{busy ? '…' : 'ثبت یادآور'}</button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(['open', 'done'] as const).map((k) => (
              <button key={k} onClick={() => setShow(k)} className="btn btn-sm" style={show === k ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                {k === 'open' ? 'باز' : 'انجام‌شده'}{rows ? ` (${rows.filter((r) => (k === 'done') === r.done).length.toLocaleString('fa-IR')})` : ''}
              </button>
            ))}
          </div>
          {!rows ? <div className="card p-8 flex justify-center"><Spinner /></div> : list.length === 0 ? (
            <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>یادآوری نیست.</div>
          ) : list.map((r) => (
            <div key={r.id} className="card p-4 space-y-1" style={{ borderInlineStart: `4px solid ${r.done ? 'var(--success)' : r.due ? 'var(--danger)' : 'var(--brand)'}` }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold">{r.title}</span>
                <span className="text-xs" style={{ color: r.due && !r.done ? 'var(--danger)' : 'var(--muted)' }}>{r.dueAtFa}{r.due && !r.done ? ' — موعد رسیده' : ''}</span>
              </div>
              {r.note && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{r.note}</p>}
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <span style={{ color: 'var(--muted)' }}>
                  {r.mine ? (r.byMe ? 'برای خودم' : `از طرف ${r.createdBy}`) : `برای ${r.assignee}`}
                  {r.claimId && <> — <a href={`/org/claims/${r.claimId}`} target="_blank" rel="noopener" style={{ color: 'var(--brand)' }}>پروندهٔ {r.claimNumber}</a></>}
                  {r.sms && <> — پیامک{r.smsSent ? ' ارسال شد' : ''}</>}
                </span>
                <span className="flex gap-3">
                  <button onClick={() => setDone(r, !r.done)} style={{ color: r.done ? 'var(--muted)' : 'var(--success)' }}>{r.done ? 'بازگشایی' : 'انجام شد'}</button>
                  {r.byMe && <button onClick={() => remove(r)} style={{ color: 'var(--danger)' }}>حذف</button>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export default function RemindersPage() {
  return <Suspense fallback={null}><Reminders /></Suspense>;
}
