'use client';
import { useEffect, useState } from 'react';
import { toGregorian } from 'jalaali-js';
import { client } from '../../lib/client';
import { Field, Overlay } from './ui';
import { JalaliDatePicker } from './JalaliDatePicker';
import { Flash } from './Toaster';

interface Colleagues { smsAllowed: boolean; users: { id: string; name: string; me: boolean; hasPhone: boolean }[] }
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
/** «۱۴۰۵/۰۸/۱۰» + «۰۹:۳۰» (Tehran, UTC+03:30) → ISO instant. */
function toInstant(date: string, time: string): string | null {
  const p = toAscii(date).split('/').map((x) => parseInt(x, 10));
  const t = toAscii(time || '09:00').split(':').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some(Number.isNaN) || t.length < 2 || t.some(Number.isNaN)) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  const ms = Date.UTC(gy, gm - 1, gd, t[0], t[1]) - 210 * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** «یادآور» of a case, set right on the case page (no leaving it). */
export function ReminderDialog({ claimId, claimNumber, onClose }: { claimId: string; claimNumber: string; onClose: () => void }) {
  const [col, setCol] = useState<Colleagues | null>(null);
  const [f, setF] = useState({ title: `پیگیری پروندهٔ ${claimNumber}`, note: '', date: '', time: '09:00', assigneeId: '', sms: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get<Colleagues>('/reminders/colleagues', 'org').then(setCol).catch(() => {}); }, []);
  const save = async () => {
    const dueAt = toInstant(f.date, f.time);
    if (!dueAt) return setMsg({ ok: false, text: 'تاریخ و ساعت یادآوری را درست وارد کنید.' });
    setBusy(true); setMsg(null);
    try {
      await client.post('/reminders', { title: f.title.trim(), note: f.note.trim() || undefined, dueAt, assigneeId: f.assigneeId || undefined, sms: f.sms, claimId }, 'org');
      setMsg({ ok: true, text: 'یادآور ثبت شد.' });
      setTimeout(onClose, 900);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <div className="pmodal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="pmodal-head"><span className="pmodal-title">یادآور — پروندهٔ {claimNumber}</span><button className="pmodal-x" onClick={onClose} aria-label="بستن">×</button></div>
        <div className="pmodal-body space-y-3">
          <Flash id={msg} text={msg?.text} ok={!!msg && msg.ok} />
          <Field label="عنوان *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
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
          {col?.smsAllowed && (
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.sms} onChange={(e) => setF({ ...f, sms: e.target.checked })} /> پیامک هم ارسال شود</label>
          )}
        </div>
        <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
          <button disabled={busy || !f.title.trim() || !f.date} onClick={save} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand-700)' }}>{busy ? '…' : 'ثبت یادآور'}</button>
        </div>
      </div>
    </Overlay>
  );
}
