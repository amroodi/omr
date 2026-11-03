'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, getTenantSlug, setTenantSlug, setToken } from '../../lib/client';
import { PANELS, rememberPanel } from '../../lib/panel';
import { AuthCard, LoginNav } from './auth-card';
import { LineSelect } from './LineSelect';
import type { Line } from '../../lib/line';
import { applyTheme, TenantTheme } from '../../lib/theme';
import { ErrorBox, Field } from './ui';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * One login page for both customer panels (/customer/login): «نام کاربری» is the کد بیمه‌گزار (company)
 * or a نماینده's کد ملی, + password. On /entry/login it is one tab of a chosen organization (`slug`). After login each gets its own panel (پنل بیمه‌گزار /
 * پنل نماینده). «حساب کاربری ندارید؟» sends a نماینده's signup request: name, کد ملی and mobile are
 * checked with شاهکار (when on), the mobile is confirmed by SMS code, then the organization approves it.
 */
export function CustomerLoginPage({ slug: fixedSlug, switcher, agent }: { slug?: string; switcher?: React.ReactNode; agent?: boolean } = {}) {
  // `agent`: an insurer's نماینده بیمه (کد ملی only; the insurer adds them, so no sign-up).
  const info = agent ? { ...PANELS.REPRESENTATIVE, label: 'پنل نماینده بیمه', title: 'ورود نماینده بیمه', subtitle: '' } : PANELS.COMPANY;
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Panel 1 works in one نوع بیمه‌نامه, chosen here before signing in.
  const [line, setLine] = useState<Line | null>(null);
  // An insurer's نماینده بیمه sees the insurer's own login look (as its staff do): logo, colours, backdrop.
  const [brand, setBrand] = useState<{ slug: string; name: string; hasLogo: boolean; theme: TenantTheme | null } | null>(null);
  useEffect(() => {
    if (!agent || !fixedSlug) return;
    fetch(`${client.base}/tenant/branding`, { headers: { 'x-tenant-slug': fixedSlug } }).then((r) => (r.ok ? r.json() : null)).then((b) => {
      if (!b) return;
      setBrand({ slug: fixedSlug, name: b.name, hasLogo: !!b.logoUrl, theme: b.theme ?? null });
      applyTheme(b.theme ?? null);
    }).catch(() => {});
  }, [agent, fixedSlug]);
  // The brokerage this site belongs to (config); without it, the last-used organization if it is a
  // brokerage, else the first brokerage — never an insurer chosen on an org login in this browser.
  const [brokerSlug, setBrokerSlug] = useState<string>(fixedSlug || process.env.NEXT_PUBLIC_TENANT_SLUG || '');
  useEffect(() => {
    if (fixedSlug || process.env.NEXT_PUBLIC_TENANT_SLUG) return;
    fetch(`${client.base}/customer/orgs`).then((r) => (r.ok ? r.json() : [])).then((l: { slug: string; kind?: string }[]) => {
      const brokers = (Array.isArray(l) ? l : []).filter((o) => o.kind === 'BROKER');
      const last = getTenantSlug();
      setBrokerSlug(brokers.some((o) => o.slug === last) ? last : brokers[0]?.slug || last);
    }).catch(() => setBrokerSlug(getTenantSlug()));
  }, []);
  const slug = () => brokerSlug || getTenantSlug();

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!line) { setError('نوع بیمه‌نامه را انتخاب کنید'); return; }
    setError(''); setLoading(true);
    try {
      setTenantSlug(slug());
      const id = toAscii(code.trim());
      const r = await client.post<{ token: string }>('/customer/login/company', { code: id, password });
      setToken('customer', r.token);
      rememberPanel('customer', /^\d{10}$/.test(id) ? 'REPRESENTATIVE' : 'COMPANY');
      router.push('/customer');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  if (mode === 'signup') return <Signup slug={slug()} onBack={() => setMode('login')} />;

  const fields = (
    <>
        {switcher}
        <ErrorBox message={error} />
        <LineSelect slug={slug()} onChange={setLine} />
        <Field label="نام کاربری">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input latin-digits" autoComplete="username" autoCapitalize="off"
            placeholder={agent ? 'کد ملی' : 'کد بیمه‌گزار / کد ملی'} style={{ direction: 'ltr', textAlign: 'right' }} autoFocus />
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
    </>
  );
  const ready = !loading && !!code.trim() && !!password && !!line;

  // نماینده بیمه of an insurer with its own login look: the same page its staff see (Sinad-style).
  if (agent && brand?.theme?.loginBg) {
    const logo = brand.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${brand.slug}` : null;
    return (
      <div className="tlogin-bg flex items-center justify-center overflow-y-auto p-4" style={{ background: brand.theme.loginBg, zIndex: 50 }}>
        <div className="w-full max-w-md">
          <form className="tlogin-card space-y-4" onSubmit={login}>
            <div className="flex flex-col items-center text-center gap-2 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo && <img src={logo} alt={brand.name} style={{ height: 110, width: 'auto', maxWidth: 220, objectFit: 'contain' }} />}
              <div className="font-bold" style={{ color: brand.theme.title || 'var(--brand)' }}>{brand.name}</div>
              <div className="text-sm font-extrabold">سامانهٔ رسیدگی به پرونده‌های خسارت عمر و حادثه</div>
            </div>
            <div className="panel-tag" style={{ ['--panel-accent' as any]: brand.theme.loginButton || 'var(--brand)' }}>{info.label}</div>
            {fields}
            <button type="submit" disabled={!ready} className="tlogin-btn" style={{ background: brand.theme.loginButton || 'var(--brand)' }}>{loading ? '…' : `ورود به ${info.label}`}</button>
          </form>
          <LoginNav onDark org="INSURER" />
          <div className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.85)' }}>با همکاری کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>
        </div>
      </div>
    );
  }

  return (
    <AuthCard title={info.title} subtitle={info.subtitle || undefined} bg={{ light: ['cust-day-1', 'cust-day-2'], dark: ['cust-night-1'] }} org={fixedSlug ? (agent ? 'INSURER' : 'BROKER') : undefined}>
      <form className="space-y-4" onSubmit={login}>
        {fields}
        <button type="submit" disabled={!ready} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
        {!agent && <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>شرکت‌ها با کد بیمه‌گزار و نمایندگان با کد ملی وارد می‌شوند.</p>}
        {!agent && <p className="text-sm text-center">
          حساب کاربری ندارید؟{' '}
          <button type="button" className="font-bold underline" style={{ color: 'var(--brand)' }} onClick={() => { setError(''); setMode('signup'); }}>ثبت‌نام نماینده</button>
        </p>}
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
          <p className="text-xs" style={{ color: 'var(--muted)' }}>کد ملی و شمارهٔ همراه باید به نام یک نفر باشند. پس از تایید سازمان، با کد ملی به‌عنوان نام کاربری و رمز عبور اولیه وارد شوید.</p>
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
