'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { Spinner } from '../../components/ui';
import { ORG_NAV } from '../nav';
import { Flash } from '../../components/Toaster';

interface Msg { id: string; claimId: string; claimNumber: string; companyName: string | null; phone: string; message: string; createdAt: string; handled: boolean; replies?: { id: string; message: string; at: string; by: string | null }[] }

/** «پاسخگوی آنلاین»: questions sent from the public استعلام page about a case, and the answers. */
export default function OnlineSupport() {
  const [rows, setRows] = useState<Msg[] | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => client.get<Msg[]>('/policyholder-companies/messages', 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);

  // «گفتگو»: the answer joins the requester's thread and is texted to them.
  const reply = async (m: Msg) => {
    setBusy(true);
    try {
      const r = await client.post<{ ok: boolean; sms: boolean }>(`/policyholder-companies/messages/${m.id}/reply`, { message: draft.trim() }, 'org');
      setMsg({ t: 'ok', m: r.sms ? 'پاسخ ثبت و برای استعلام‌کننده پیامک شد' : 'پاسخ ثبت شد (پیامک ارسال نشد؛ استعلام‌کننده آن را در گفتگو می‌بیند)' });
      setDraft(''); setOpen(null); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const done = async (m: Msg) => { try { await client.post(`/policyholder-companies/messages/${m.id}/handled`, {}, 'org'); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };

  return (
    <Shell title="پاسخگوی آنلاین" subtitle="پرسش‌های استعلام‌کنندگان دربارهٔ پرونده‌ها و پاسخ‌های کارگزاری" nav={ORG_NAV} realm="org">
      <Flash id={msg} text={msg?.m} ok={msg?.t === 'ok'} />
      {!rows ? <div className="card p-8 text-center"><Spinner /></div>
        : rows.length === 0 ? <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>پیامی از استعلام‌کنندگان دریافت نشده است.</div>
        : (
          <div className="space-y-2">
            {rows.map((m) => (
              <div key={m.id} className="card p-4" style={{ opacity: m.handled ? 0.6 : 1 }}>
                <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
                  <span className="font-bold">پرونده <a href={`/org/claims/${m.claimId}`} target="_blank" rel="noopener" style={{ color: 'var(--brand)' }}>{m.claimNumber}</a>{m.companyName ? ` — ${m.companyName}` : ''}</span>
                  <span style={{ color: 'var(--muted)' }}>{m.createdAt}</span>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{m.message}</p>
                {(m.replies ?? []).map((x) => (
                  <div key={x.id} className="text-sm mt-2 rounded-md p-2 whitespace-pre-wrap" style={{ background: 'var(--surface-2)', borderInlineStart: '3px solid var(--brand)' }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>پاسخ کارگزاری{x.by ? ` — ${x.by}` : ''} · {x.at}</div>{x.message}
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 mt-2 text-sm flex-wrap">
                  <span>تماس با استعلام‌کننده: <a href={`tel:${m.phone}`} dir="ltr" style={{ color: 'var(--brand)', fontWeight: 700 }}>{m.phone}</a></span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => setOpen(open === m.id ? null : m.id)} className="btn btn-primary btn-sm">{m.replies?.length ? 'پاسخ دیگر' : 'پاسخ'}</button>
                    {m.handled ? <span className="badge badge-success">پاسخ داده شد</span> : <button onClick={() => done(m)} className="btn btn-ghost btn-sm">ثبت «پاسخ داده شد» (تماس تلفنی)</button>}
                  </span>
                </div>
                {open === m.id && (
                  <div className="mt-2 space-y-2">
                    <textarea className="input" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} placeholder="پاسخ به استعلام‌کننده — در گفتگوی او نمایش داده و پیامک می‌شود" />
                    <button onClick={() => reply(m)} disabled={busy || draft.trim().length < 2} className="btn btn-primary btn-sm">{busy ? '…' : 'ارسال پاسخ و پیامک'}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </Shell>
  );
}
