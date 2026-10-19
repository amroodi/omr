'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { inquiryApi } from '../lib/api';
import { client, setToken, setTenantSlug } from '../lib/client';
import { ErrorBox, Field, StatusBadge } from './components/ui';
import { Icon } from './components/Shell';
import { Reveal } from './components/reveal';
import { DotGrid } from './components/DotGrid';

type Tab = 'inquiry' | 'customer' | 'org';

export default function Landing() {
  return (
    <div className="relative min-h-[68vh] flex items-center justify-center">
      {/* full-bleed animated background */}
      <div className="aurora" style={{ position: 'fixed' }}><span /></div>
      <DotGrid />
      <AuthHub />
    </div>
  );
}

/* ───────────────────── Auth hub — centered login card, three entries ───────────────────── */
const TABS: { id: Tab; label: string }[] = [
  { id: 'inquiry', label: 'استعلام سریع پرونده' },
  { id: 'customer', label: 'پورتال بیمه‌گزار' },
  { id: 'org', label: 'ورود سازمان‌ها' },
];

function AuthHub() {
  const [tab, setTab] = useState<Tab>('inquiry');
  return (
    <section className="w-full px-4 py-4">
      <Reveal delay={80}>
        <div className="glass max-w-5xl mx-auto overflow-hidden" style={{ borderRadius: 24, boxShadow: 'var(--shadow-lg)' }}>
          {/* Logo bar — Damuon (right) · Bimmes (left), like the reference */}
          <div className="flex items-center justify-between px-5 md:px-8 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <a href="https://damuon.com" target="_blank" rel="noopener noreferrer" className="plogo plogo-damuon" aria-label="آتیه اندیشان دامون" />
            <a href="https://bimmes.ir" target="_blank" rel="noopener noreferrer" className="plogo plogo-bimmes" aria-label="بیمس" />
          </div>

          <div className="grid md:grid-cols-[1fr_36%]">
            {/* Login side (right in RTL) — active form */}
            <div className="relative p-5 md:p-8">
              <div className="text-center mb-4">
                <h1 className="text-base md:text-lg font-extrabold">سامانه هوشمند مدیریت بیمه عمر و حوادث</h1>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>کارگزاری رسمی بیمه آتیه اندیشان دامون</p>
              </div>
              {tab === 'inquiry' && <InquiryForm />}
              {tab === 'customer' && <CustomerForm />}
              {tab === 'org' && <OrgForm />}
            </div>

            {/* Entry selector (left in RTL) — bigger buttons */}
            <div className="p-5 md:p-7 flex flex-col gap-3.5 md:justify-center" style={{ background: 'var(--surface-2)', borderRight: '1px solid var(--border)' }}>
              <h3 className="font-bold text-center mb-1">ورود به سامانه</h3>
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="flex items-center justify-between gap-2 px-5 py-4 rounded-2xl text-base font-bold transition"
                    style={active
                      ? { background: 'linear-gradient(135deg, var(--brand), var(--brand-600))', color: '#fff', boxShadow: '0 12px 26px -10px rgba(255,120,0,.65)' }
                      : { background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    <span>{t.label}</span>
                    <Icon path="M5 12h14M13 6l6 6-6 6" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────── shared bits ─────────────────────────── */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const faDigits = (s: string) => s.replace(/\d/g, (d) => FA[+d]);
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** 2-minute (default) countdown for OTP resend. */
function useCountdown() {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const start = (secs = 120) => {
    setLeft(secs);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((s) => {
      if (s <= 1) { if (timer.current) clearInterval(timer.current); return 0; }
      return s - 1;
    }), 1000);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return { left, start };
}

function FormHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>
    </div>
  );
}

/** Input with the shared vector icon inside (used for کد ملی / نام کاربری). */
function IconField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Field label={label}>
      <div className="relative">
        {children}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/field-icon.webp" alt="" aria-hidden="true" width={18} style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }} />
      </div>
    </Field>
  );
}

function ResendRow({ left, onResend, loading, onBack }: { left: number; onResend: () => void; loading: boolean; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button onClick={onBack} className="btn btn-ghost btn-sm">بازگشت</button>
      {left > 0
        ? <span className="text-xs" style={{ color: 'var(--muted)' }}>ارسال مجدد کد تا {faDigits(mmss(left))} دیگر</span>
        : <button onClick={onResend} disabled={loading} className="btn btn-ghost btn-sm" style={{ color: 'var(--brand)' }}>ارسال مجدد کد</button>}
    </div>
  );
}


/* ─────────────────────── استعلام سریع (inquiry) ─────────────────────── */
function InquiryForm() {
  const [step, setStep] = useState<'id' | 'otp' | 'result'>('id');
  const [nid, setNid] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { left, start } = useCountdown();

  const fmtAmt = (v: any) => v != null && String(v).trim() !== '' ? `${Number(String(v).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال` : null;
  const run = async (fn: () => Promise<void>) => { setError(''); setLoading(true); try { await fn(); } catch (e: any) { setError(e.message || 'خطا'); } finally { setLoading(false); } };
  const request = () => run(async () => {
    const r = await inquiryApi.requestClaim(nid, phone);
    if (r.otpRequired === false) { // OTP disabled platform-wide → view directly
      const t = await inquiryApi.directClaim(nid, phone);
      setResult(await inquiryApi.getCase(t.token)); setStep('result'); return;
    }
    setMsg(r.message); setStep('otp'); start(120);
  });
  const verify = () => run(async () => { const r = await inquiryApi.verifyOtp(nid, phone, code); setResult(await inquiryApi.getCase(r.token)); setStep('result'); });

  return (
    <div>
      <FormHeader title="استعلام سریع پرونده" subtitle="کد ملی متوفی و شمارهٔ موبایل خودتان را وارد کنید؛ کد تایید به موبایل شما ارسال می‌شود." />
      <div className="space-y-3.5">
        <ErrorBox message={error} />
        {step === 'id' && (
          <>
            <IconField label="کد ملی متوفی"><input className="input" style={{ paddingRight: 40, direction: 'ltr', textAlign: 'right' }} value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" placeholder="کد ملی ۱۰ رقمی متوفی" /></IconField>
            <Field label="شماره موبایل شما"><input className="input" style={{ direction: 'ltr', textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="۰۹۱۲۳۴۵۶۷۸۹" onKeyDown={(e) => e.key === 'Enter' && nid && phone && request()} /></Field>
            <button onClick={request} disabled={loading || !nid || !phone} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? 'در حال ارسال…' : 'دریافت کد تایید'}</button>
          </>
        )}
        {step === 'otp' && (
          <>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>
            <Field label="کد تایید"><input className="input text-center tracking-[0.5em] text-lg" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="––––––" onKeyDown={(e) => e.key === 'Enter' && code.length >= 4 && verify()} /></Field>
            <button onClick={verify} disabled={loading || code.length < 4} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? 'در حال بررسی…' : 'مشاهده پرونده'}</button>
            <ResendRow left={left} onResend={request} loading={loading} onBack={() => setStep('id')} />
          </>
        )}
        {step === 'result' && result && (
          <div className="fade-up">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold">پرونده {result.kind === 'claim' ? result.claimNumber : result.caseNumber}</span>
              <StatusBadge status={result.status} />
            </div>
            {(result.kind === 'claim'
              ? [
                  ['بیمه‌گر', result.insurerName],
                  ['بیمه‌شده (متوفی)', result.deceasedName],
                  ['کد ملی', result.nationalCodeMasked],
                  ['تاریخ تولد', result.birthDate],
                  ['نام شرکت / محل فعالیت', result.companyName],
                  ['شماره بیمه‌نامه', result.policyNumber],
                  ['تاریخ شروع بیمه‌نامه', result.policyStartDate],
                  ['سرمایه فوت', fmtAmt(result.deathCapital)],
                  ['سرمایه حادثه', fmtAmt(result.accidentCapital)],
                  ['مبلغ قابل پرداخت', fmtAmt(result.payableAmount)],
                  ['علت فوت', result.causeOfDeath],
                  ['تاریخ وقوع', result.eventDate],
                  ['تاریخ ثبت', result.createdAt],
                ]
              : [['نام', result.insured?.fullName], ['کد ملی', result.insured?.nationalCodeMasked], ['بیمه‌نامه', result.policy ? `${result.policy.policyNumber} — ${result.policy.carrier}` : null], ['تاریخ پرداخت', result.workflow?.paidAt]]
            ).map(([l, v]) => v ? (
              <div key={l as string} className="flex justify-between py-2 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--muted)' }}>{l}</span><span className="font-semibold">{v}</span>
              </div>
            ) : null)}
            <button onClick={() => { setStep('id'); setResult(null); setCode(''); }} className="btn btn-glass btn-sm w-full mt-4">استعلام جدید</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── پورتال بیمه‌گزار (customer) ─────────────────────── */
function CustomerForm() {
  const router = useRouter();
  const [tenant, setTenant] = useState('damuon');
  const [nid, setNid] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'otp'>('id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { left, start } = useCountdown();

  const run = async (fn: () => Promise<void>) => { setError(''); setLoading(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };
  const request = () => run(async () => {
    setTenantSlug(tenant);
    const r = await client.post<{ otpRequired?: boolean }>('/customer/login/request-otp', { nationalCode: nid, phone });
    if (r.otpRequired === false) { // OTP disabled platform-wide → log in directly
      const t = await client.post<{ token: string }>('/customer/login/direct', { nationalCode: nid, phone });
      setToken('customer', t.token); router.push('/customer'); return;
    }
    setStep('otp'); start(120);
  });
  const verify = () => run(async () => { const r = await client.post<{ token: string }>('/customer/login/verify-otp', { nationalCode: nid, phone, code }); setToken('customer', r.token); router.push('/customer'); });

  return (
    <div>
      <FormHeader title="پورتال بیمه‌گزار" subtitle="پیگیری پرونده‌های خسارت و بارگذاری مدارک" />
      <div className="space-y-3.5">
        <ErrorBox message={error} />
        {step === 'id' ? (
          <>
            <Field label="شناسه سازمان"><input className="input" style={{ direction: 'ltr', textAlign: 'left' }} value={tenant} onChange={(e) => setTenant(e.target.value)} /></Field>
            <IconField label="کد ملی"><input className="input" style={{ paddingRight: 40, direction: 'ltr', textAlign: 'right' }} value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" placeholder="کد ملی خود را وارد کنید" /></IconField>
            <Field label="موبایل ثبت‌شده"><input className="input" style={{ direction: 'ltr', textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="۰۹۱۲…" onKeyDown={(e) => e.key === 'Enter' && nid && phone && request()} /></Field>
            <button onClick={request} disabled={loading || !nid || !phone} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? '…' : 'ارسال کد'}</button>
            <Link href="/customer/login" className="btn btn-ghost btn-sm w-full">حساب ندارید؟ ثبت‌نام بیمه‌گزار</Link>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>کد تایید به شماره {faDigits(phone)} ارسال شد.</p>
            <Field label="کد تایید"><input className="input text-center tracking-[0.5em] text-lg" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="––––––" onKeyDown={(e) => e.key === 'Enter' && code.length >= 4 && verify()} /></Field>
            <button onClick={verify} disabled={loading || code.length < 4} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? '…' : 'ورود'}</button>
            <ResendRow left={left} onResend={request} loading={loading} onBack={() => setStep('id')} />
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── ورود سازمان‌ها (org) ─────────────────────── */
function OrgForm() {
  const router = useRouter();
  const [slug, setSlug] = useState('damuon');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(''); setLoading(true);
    try {
      setTenantSlug(slug);
      const r = await client.post<{ token: string }>('/auth/org/login', { tenantSlug: slug, username, password });
      setToken('org', r.token); router.push('/org');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div>
      <FormHeader title="ورود سازمان‌ها" subtitle="پنل مدیریت پرونده‌های سازمان" />
      <div className="space-y-3.5">
        <ErrorBox message={error} />
        <Field label="شناسه سازمان"><input className="input" style={{ direction: 'ltr', textAlign: 'left' }} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="damuon" /></Field>
        <IconField label="نام کاربری"><input className="input" style={{ paddingRight: 40 }} value={username} onChange={(e) => setUsername(e.target.value)} /></IconField>
        <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && username && password && submit()} /></Field>
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? '…' : 'ورود به سامانه'}</button>
      </div>
    </div>
  );
}

