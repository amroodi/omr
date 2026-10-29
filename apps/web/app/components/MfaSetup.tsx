'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { client } from '../../lib/client';
import { ErrorBox, Field } from './ui';

type Realm = 'org' | 'super';
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * «ورود دومرحله‌ای»: set up (scan the QR into Google / Microsoft Authenticator, confirm one code),
 * or turn off. Used by org operators and the super admin. `onEnabled` runs once it is on.
 */
export function MfaSetup({ realm, onEnabled }: { realm: Realm; onEnabled?: () => void }) {
  const [st, setSt] = useState<{ enabled: boolean; required: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(false);

  const load = () => client.get<{ enabled: boolean; required: boolean }>('/auth/mfa', realm).then(setSt).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const run = async (fn: () => Promise<void>) => { setError(''); setOk(''); setBusy(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const start = () => run(async () => {
    const r = await client.post<{ secret: string; uri: string }>('/auth/mfa/setup', { password }, realm);
    setSetup({ ...r, qr: await QRCode.toDataURL(r.uri, { width: 220, margin: 1 }) });
    setPassword(''); setCode('');
  });
  const enable = () => run(async () => {
    await client.post('/auth/mfa/enable', { code: toAscii(code.trim()) }, realm);
    setSetup(null); setCode(''); setOk('ورود دومرحله‌ای فعال شد. از این پس هنگام ورود، کد برنامه را هم وارد کنید.');
    await load(); onEnabled?.();
  });
  const disable = () => run(async () => {
    await client.post('/auth/mfa/disable', { password, code: toAscii(code.trim()) }, realm);
    setOff(false); setPassword(''); setCode(''); setOk('ورود دومرحله‌ای خاموش شد.');
    await load();
  });

  if (!st) return error ? <ErrorBox message={error} /> : null;
  return (
    <div className="space-y-3 text-sm">
      <ErrorBox message={error} />
      {ok && <div className="alert-success">{ok}</div>}
      <div className="flex items-center gap-2">
        <span className="font-semibold">وضعیت:</span>
        {st.enabled ? <span className="badge badge-success">فعال</span> : <span className="badge badge-warning">غیرفعال</span>}
        {st.required && <span className="badge badge-neutral">الزامی برای سازمان شما</span>}
      </div>
      <p style={{ color: 'var(--muted)' }}>
        با ورود دومرحله‌ای، علاوه بر رمز عبور یک کد ۶ رقمی از برنامهٔ احراز هویت گوشی (Google Authenticator یا Microsoft Authenticator) لازم است؛ حتی اگر رمز عبور لو برود، کسی بدون گوشی شما وارد نمی‌شود.
      </p>

      {!st.enabled && !setup && (
        <div className="space-y-2 max-w-sm">
          <Field label="رمز عبور فعلی (برای شروع)">
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && password && start()} />
          </Field>
          <button onClick={start} disabled={busy || !password} className="btn btn-primary btn-sm">{busy ? '…' : 'راه‌اندازی ورود دومرحله‌ای'}</button>
        </div>
      )}

      {setup && (
        <div className="space-y-3">
          <ol className="list-decimal pr-5 space-y-1">
            <li>برنامهٔ Google Authenticator یا Microsoft Authenticator را روی گوشی نصب کنید.</li>
            <li>در برنامه «افزودن حساب» را بزنید و این کد QR را اسکن کنید (یا کلید را دستی وارد کنید).</li>
            <li>کد ۶ رقمی‌ای که برنامه نشان می‌دهد را اینجا وارد کنید.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="کد QR ورود دومرحله‌ای" width={220} height={220} style={{ background: '#fff', borderRadius: 12, padding: 6 }} />
            <div className="space-y-1">
              <div className="text-xs" style={{ color: 'var(--muted)' }}>کلید دستی:</div>
              <code className="latin-digits block p-2 rounded" style={{ background: 'var(--surface-2)', direction: 'ltr', letterSpacing: '0.1em', wordBreak: 'break-all' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <button type="button" className="text-xs underline" style={{ color: 'var(--brand)' }} onClick={() => navigator.clipboard?.writeText(setup.secret)}>کپی کلید</button>
            </div>
          </div>
          <div className="flex items-end gap-2 max-w-sm">
            <Field label="کد ۶ رقمی برنامه">
              <input className="input latin-digits" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
                style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '0.3em' }} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && enable()} />
            </Field>
            <button onClick={enable} disabled={busy || toAscii(code).trim().length !== 6} className="btn btn-primary btn-sm mb-0.5">تایید و فعال‌سازی</button>
          </div>
        </div>
      )}

      {st.enabled && !st.required && (
        off ? (
          <div className="space-y-2 max-w-sm">
            <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="کد ۶ رقمی برنامه"><input className="input latin-digits" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} style={{ direction: 'ltr', textAlign: 'center' }} /></Field>
            <div className="flex gap-2">
              <button onClick={disable} disabled={busy || !password || toAscii(code).trim().length !== 6} className="btn btn-sm" style={{ color: 'var(--danger)' }}>خاموش کردن</button>
              <button onClick={() => setOff(false)} className="btn btn-ghost btn-sm">انصراف</button>
            </div>
          </div>
        ) : <button onClick={() => { setOff(true); setError(''); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>خاموش کردن ورود دومرحله‌ای</button>
      )}
    </div>
  );
}
