'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client, getTenantSlug, setTenantSlug, setToken } from '../../../lib/client';
import { AuthCard } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * ورود بیمه‌گزار: «نام کاربری» (کد بیمه‌گزار — or a نماینده's کد ملی — or «broker») + password.
 * «حساب کاربری ندارید؟» sends a نماینده's signup request: name, کد ملی and mobile are checked with
 * شاهکار (when on), the mobile is confirmed by SMS code, then the organization approves it.
 */
export default function CustomerLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const slug = () => process.env.NEXT_PUBLIC_TENANT_SLUG || getTenantSlug(); // the brokerage this site belongs to

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(''); setLoading(true);
    try {
      setTenantSlug(slug());
      const r = await client.post<{ token: string }>('/customer/login/company', { code: toAscii(code.trim()), password });
      setToken('customer', r.token);
      router.push('/customer');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  if (mode === 'signup') return <Signup slug={slug()} onBack={() => setMode('login')} />;

  return (
    <AuthCard title="ورود بیمه‌گزار" subtitle="اعلام و پیگیری خسارت عمر و حوادث" bg={{ light: ['cust-day-1', 'cust-day-2'], dark: ['cust-night-1'] }}>
      <form className="space-y-4" onSubmit={login}>
        <ErrorBox message={error} />
        <Field label="نام کاربری">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input latin-digits" autoComplete="username" autoCapitalize="off"
            placeholder="کد بیمه‌گزار / کد ملی" style={{ direction: 'ltr', textAlign: 'right' }} autoFocus />
        </Field>
        <Field label="رمز عبور">
          <div className="relative">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input" type={show ? 'text' : 'password'} autoComplete="current-password"
              style={{ direction: 'ltr', textAlign: 'right', paddingLeft: 64 }} />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: 'var(--brand)' }}>
              {show ? 'پنهان' : 'نمایش'}
            </button>
          </div>
        </Field>
        <button type="submit" disabled={loading || !code.trim() || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
        <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>شرکت‌ها با کد بیمه‌گزار و نمایندگان با کد ملی وارد می‌شوند.</p>
        <p className="text-sm text-center">
          حساب کاربری ندارید؟{' '}
          <button type="button" className="font-bold underline" style={{ color: 'var(--brand)' }} onClick={() => { setError(''); setMode('signup'); }}>ثبت‌نام نماینده</button>
        </p>
      </form>
    </AuthCard>
  );
}

/** نماینده signup: name + کد ملی + mobile → (شاهکار) → SMS code → request awaits the organization's approval. */
function Signup({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [f, setF] = useState({ fullName: '', nationalCode: '', phone: '' });
  const [otp, setOtp] = useState<null | string>(null); // null = not asked yet; '' = code sent, typing
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const body = () => ({ tenantSlug: slug, fullName: f.fullName.trim(), nationalCode: toAscii(f.nationalCode.trim()), phone: toAscii(f.phone.trim()) });

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    if (!/^\d{10}$/.test(body().nationalCode)) return setError('کد ملی باید ۱۰ رقم باشد.');
    if (!/^0?9\d{9}$/.test(body().phone)) return setError('شمارهٔ همراه نامعتبر است (نمونه: ۰۹۱۲۱۲۳۴۵۶۷).');
    setLoading(true);
    try {
      const r = await client.post<{ otpRequired: boolean; message: string }>('/customer/signup/request-otp', body());
      if (r.otpRequired) setOtp('');
      else setDone((await client.post<{ message: string }>('/customer/signup/direct', body())).message);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };
  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(''); setLoading(true);
    try { setDone((await client.post<{ message: string }>('/customer/signup/verify-otp', { ...body(), code: toAscii(otp ?? '') })).message); }
    catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <AuthCard title="ثبت‌نام نماینده" subtitle="درخواست دسترسی به پنل بیمه‌گزار" bg={{ light: ['cust-day-1', 'cust-day-2'], dark: ['cust-night-1'] }}>
      {done ? (
        <div className="space-y-4 text-center">
          <div className="alert-success text-sm">{done}</div>
          <button type="button" className="btn btn-primary w-full" onClick={onBack}>بازگشت به ورود</button>
        </div>
      ) : otp === null ? (
        <form className="space-y-4" onSubmit={send}>
          <ErrorBox message={error} />
          <Field label="نام و نام خانوادگی"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoComplete="name" autoFocus /></Field>
          <Field label="کد ملی"><input className="input latin-digits" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="شمارهٔ همراه (به نام خودتان)"><input className="input latin-digits" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <button type="submit" disabled={loading || f.fullName.trim().length < 2 || !f.nationalCode.trim() || !f.phone.trim()} className="btn btn-primary w-full">{loading ? '…' : 'دریافت کد تایید'}</button>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>کد ملی و شمارهٔ همراه باید به نام یک نفر باشند (استعلام شاهکار). پس از تایید سازمان، با کد ملی به‌عنوان نام کاربری و رمز عبور اولیه وارد شوید.</p>
          <button type="button" className="text-sm w-full" style={{ color: 'var(--brand)' }} onClick={onBack}>بازگشت به ورود</button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={verify}>
          <ErrorBox message={error} />
          <p className="text-sm">کد تایید به شمارهٔ <bdi className="latin-digits">{f.phone}</bdi> پیامک شد.</p>
          <Field label="کد تایید"><input className="input latin-digits" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '0.3em' }} /></Field>
          <button type="submit" disabled={loading || (otp ?? '').trim().length < 4} className="btn btn-primary w-full">{loading ? '…' : 'ارسال درخواست ثبت‌نام'}</button>
          <button type="button" className="text-sm w-full" style={{ color: 'var(--brand)' }} onClick={() => { setOtp(null); setError(''); }}>ویرایش مشخصات</button>
        </form>
      )}
    </AuthCard>
  );
}
