'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken, setToken } from '../../../lib/client';

/** «پنل بیمه‌شده»: sign in with the mobile the بیمه‌گزار / نماینده invited, and an SMS code. */
export default function InsuredLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  // While Model View has the panel off everywhere, this page doesn't exist for anyone.
  useEffect(() => {
    client.get<{ enabled: boolean }>('/insured/status').then((s) => {
      if (!s.enabled) return router.replace('/');
      if (getToken('insured')) return router.replace('/insured');
      setOn(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const request = () => run(async () => { const r = await client.post<{ message: string }>('/insured/login/request-otp', { phone }); setSent(r.message); });
  const verify = () => run(async () => { const r = await client.post<{ token: string }>('/insured/login/verify-otp', { phone, code }); setToken('insured', r.token); router.push('/insured'); });

  if (!on) return null;
  return (
    <div className="min-h-screen flex items-center justify-center p-4" dir="rtl" style={{ background: 'var(--bg)' }}>
      <div className="card p-6 w-full max-w-md space-y-4">
        <h1 className="text-xl font-extrabold">ورود به پنل بیمه‌شده</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>با شماره‌ای وارد شوید که برای پرونده به شما دعوت‌نامه پیامک شده است.</p>
        {error && <div className="alert-error">{error}</div>}
        {sent && <div className="alert-success text-sm">{sent}</div>}
        <div>
          <label className="label" htmlFor="ins-phone">شماره موبایل</label>
          <input id="ins-phone" className="input latin-digits" inputMode="numeric" autoComplete="tel" style={{ direction: 'ltr', textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" disabled={!!sent} />
        </div>
        {sent ? (
          <>
            <div>
              <label className="label" htmlFor="ins-code">کد پیامکی</label>
              <input id="ins-code" className="input latin-digits" inputMode="numeric" autoComplete="one-time-code" style={{ direction: 'ltr', textAlign: 'right' }} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button className="btn btn-primary w-full" disabled={busy || code.length < 4} onClick={verify}>{busy ? '…' : 'ورود'}</button>
            <button className="btn btn-ghost w-full" disabled={busy} onClick={() => { setSent(''); setCode(''); }}>تغییر شماره</button>
          </>
        ) : (
          <button className="btn btn-primary w-full" disabled={busy || phone.length < 10} onClick={request}>{busy ? '…' : 'دریافت کد'}</button>
        )}
      </div>
    </div>
  );
}
