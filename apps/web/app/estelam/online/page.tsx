'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { inquiryApi, InquiryThread } from '../../../lib/api';
import { EstelamFrame, SIDE_MENU, SubHead } from '../shared';

const REFRESH_MS = 20_000;
const expiredText = (e: any) => (/token|expired|منقضی|Unauthorized/i.test(e?.message ?? '') ? 'زمان این استعلام به پایان رسیده است؛ لطفاً دوباره استعلام کنید.' : e?.message);

/**
 * «گفتگو» (پاسخگوی آنلاین) — a two-way conversation with the کارگزاری about the looked-up case: the
 * requester's questions and the brokerage's answers (also texted to the verified mobile). The thread is
 * re-read every 20 seconds while the inquiry is valid.
 */
function Chat({ token }: { token: string }) {
  const [t, setT] = useState<InquiryThread | null>(null);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [expired, setExpired] = useState(false);

  const load = useCallback(() => inquiryApi.thread(token).then(setT).catch((e) => { setExpired(true); setNote({ ok: false, text: expiredText(e) }); }), [token]);
  useEffect(() => {
    load();
    const i = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(i);
  }, [load]);

  const send = async () => {
    setSending(true); setNote(null);
    try { const res = await inquiryApi.message(token, msg.trim()); setNote({ ok: true, text: res.message }); setMsg(''); load(); }
    catch (e: any) { setNote({ ok: false, text: expiredText(e) }); }
    finally { setSending(false); }
  };

  const broker = t?.brokerName ?? 'کارگزاری';
  return (
    <div className="est-card p-5 space-y-4">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>سوال خود را دربارهٔ این پرونده بنویسید. کارشناسان {broker} پاسخ می‌دهند؛ پاسخ همین‌جا نمایش داده می‌شود و با پیامک به شمارهٔ موبایلی که با آن استعلام کردید اطلاع داده می‌شود.</p>
      <div className="est-chat" aria-live="polite">
        {!t ? null : t.messages.length === 0 ? (
          <div className="est-chat-empty">هنوز پیامی ارسال نکرده‌اید.</div>
        ) : t.messages.map((m) => (
          <div key={m.id} className={`est-msg ${m.fromStaff ? 'is-staff' : 'is-me'}`}>
            <div className="est-msg-who">{m.fromStaff ? `کارشناس ${broker}` : 'شما'}</div>
            <div className="est-msg-b">{m.message}</div>
            <div className="est-msg-at">{m.at}{!m.fromStaff && (m.answered ? ' · پاسخ داده شد' : ' · در انتظار پاسخ')}</div>
          </div>
        ))}
      </div>
      {note && <div className={note.ok ? 'alert-success' : 'alert-error'}>{note.text}</div>}
      {expired ? <Link href="/" className="est-btn inline-flex">برای ادامهٔ گفتگو دوباره استعلام کنید</Link> : (
        <>
          <textarea className="input" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} placeholder="متن پیام…" />
          <button onClick={send} disabled={sending || msg.trim().length < 3} className="est-btn">{sending ? 'در حال ارسال…' : 'ارسال پیام'}</button>
        </>
      )}
    </div>
  );
}

export default function EstelamOnline() {
  const menu = SIDE_MENU[4];
  return (
    <EstelamFrame>
      {(_r, token) => (
        <>
          <SubHead title={menu.label} icon={menu.icon} />
          {token ? <Chat token={token} /> : (
            <div className="est-card p-5"><Link href="/" className="est-btn inline-flex">برای ارسال پیام دوباره استعلام کنید</Link></div>
          )}
        </>
      )}
    </EstelamFrame>
  );
}
