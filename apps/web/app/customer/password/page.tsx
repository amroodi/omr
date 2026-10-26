'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { CUSTOMER_NAV } from '../nav';

/** «تغییر کلمه عبور» of the بیمه‌گزار panel, as a page of its own (like the insurer's portal). */
export default function CustomerPassword() {
  const router = useRouter();
  const [f, setF] = useState({ cur: '', next: '', again: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!getToken('customer')) router.push('/customer/login'); }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (f.next.length < 8) return setMsg({ ok: false, text: 'کلمه عبور جدید باید دست‌کم ۸ نویسه باشد.' });
    if (f.next !== f.again) return setMsg({ ok: false, text: '«تکرار کلمه عبور جدید» با کلمه عبور جدید یکسان نیست.' });
    setBusy(true);
    try {
      await client.post('/customer/password', { current: f.cur, next: f.next }, 'customer');
      setMsg({ ok: true, text: 'کلمه عبور شما تغییر کرد؛ از این پس با کلمه عبور جدید وارد شوید.' });
      setF({ cur: '', next: '', again: '' });
    } catch (err: any) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  };

  return (
    <Shell title="تغییر کلمه عبور" breadcrumb="تغییر کلمه عبور" nav={CUSTOMER_NAV} realm="customer">
      <form onSubmit={submit} className="pcard cu-pw">
        <div className="cu-tips">
          <p>کلمه عبور فعلی، گذرواژه‌ای است که با آن وارد سامانه شده‌اید.</p>
          <p>کلمه عبور جدید باید دست‌کم ۸ نویسه باشد؛ پیشنهاد می‌کنیم ترکیبی از حروف انگلیسی و عدد باشد.</p>
          <p>در قسمت «تکرار کلمه عبور جدید»، کلمه عبور جدید را عیناً تکرار کنید.</p>
          <p>کلمه عبوری انتخاب کنید که به‌راحتی به خاطر بسپارید؛ این کلمه عبور برای همهٔ همکاران شرکت شما که از این پنل استفاده می‌کنند یکسان است.</p>
        </div>
        <span className="cu-pw-ico" aria-hidden>
          <svg viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" /></svg>
        </span>
        <div className="cu-pw-fields">
          <input className="input cu-pill" type="password" autoComplete="current-password" placeholder="کلمه عبور فعلی" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} />
          <input className="input cu-pill" type="password" autoComplete="new-password" placeholder="کلمه عبور جدید" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          <input className="input cu-pill" type="password" autoComplete="new-password" placeholder="تکرار کلمه عبور جدید" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
          {msg && <div className={msg.ok ? 'alert-success' : 'alert-error'}>{msg.text}</div>}
          <button type="submit" className="cu-go" disabled={busy || !f.cur || !f.next || !f.again}>{busy ? '…' : 'کلمه عبور من را تغییر بده'}</button>
        </div>
      </form>
    </Shell>
  );
}
