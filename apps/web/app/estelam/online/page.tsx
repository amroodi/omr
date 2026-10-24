'use client';
import { useState } from 'react';
import Link from 'next/link';
import { inquiryApi } from '../../../lib/api';
import { EstelamFrame, PANELS, SubHead } from '../shared';

/** پاسخگوی آنلاین — leave a question about the case; the کارگزاری calls back on the verified phone. */
export default function EstelamOnline() {
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (token: string) => {
    setSending(true); setSent(null);
    try { const res = await inquiryApi.message(token, msg.trim()); setSent({ ok: true, text: res.message }); setMsg(''); }
    catch (e: any) { setSent({ ok: false, text: /token|expired|منقضی|Unauthorized/i.test(e.message) ? 'زمان این استعلام به پایان رسیده است؛ لطفاً دوباره استعلام کنید و سپس پیام بفرستید.' : e.message }); }
    finally { setSending(false); }
  };

  return (
    <EstelamFrame>
      {(_r, token) => (
        <>
          <SubHead title={PANELS[2].label} icon={PANELS[2].icon} />
          <div className="est-card p-5 space-y-3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>سوال خود را دربارهٔ این پرونده بنویسید. پیام برای بیمه‌گزار و کارگزاری ارسال می‌شود و کارشناس با شمارهٔ موبایلی که با آن استعلام کردید تماس می‌گیرد.</p>
            {sent && <div className={sent.ok ? 'alert-success' : 'alert-error'}>{sent.text}</div>}
            {token ? (
              <>
                <textarea className="input" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} placeholder="متن پیام…" />
                <button onClick={() => send(token)} disabled={sending || msg.trim().length < 3} className="est-btn">{sending ? 'در حال ارسال…' : 'ارسال پیام'}</button>
              </>
            ) : <Link href="/" className="est-btn inline-flex">برای ارسال پیام دوباره استعلام کنید</Link>}
          </div>
        </>
      )}
    </EstelamFrame>
  );
}
