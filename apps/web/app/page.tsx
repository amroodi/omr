'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { inquiryApi } from '../lib/api';
import { ErrorBox, Field, StatusBadge } from './components/ui';
import { Icon } from './components/Shell';
import { Reveal } from './components/reveal';
import { DotGrid } from './components/DotGrid';

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

/* ───────────────────── Auth hub — two-panel login card ───────────────────── */
function AuthHub() {
  return (
    <section className="w-full px-4 py-5">
      <Reveal delay={80}>
        <div className="glass max-w-4xl mx-auto overflow-hidden" style={{ borderRadius: 24, boxShadow: 'var(--shadow-lg)' }}>
          <div className="grid md:grid-cols-2">
            {/* RIGHT (RTL first): استعلام سریع form */}
            <div className="login-pills p-6 md:p-8" style={{ borderLeft: '1px solid var(--border)' }}>
              <div className="flex justify-center mb-4">
                <a href="https://damuon.com" target="_blank" rel="noopener noreferrer" className="plogo plogo-damuon" aria-label="آتیه اندیشان دامون" style={{ height: 42, width: 150 }} />
              </div>
              <InquiryForm />
            </div>

            {/* LEFT: separate login entries (each opens its own panel) */}
            <div className="p-6 md:p-8 flex flex-col">
              <div className="flex justify-center mb-4">
                <a href="https://bimmes.ir" target="_blank" rel="noopener noreferrer" className="plogo plogo-bimmes" aria-label="بیمس" style={{ height: 42, width: 150 }} />
              </div>
              <h3 className="font-bold text-center mb-5">ورود به سامانه</h3>
              <div className="flex flex-col gap-4 md:flex-1 md:justify-center">
                {([['پورتال بیمه‌گزار', '/customer/login'], ['ورود سازمان‌ها', '/org/login']] as const).map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center justify-between gap-2 px-6 py-4 rounded-2xl text-base font-bold transition"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    <span>{label}</span>
                    <Icon path="M5 12h14M13 6l6 6-6 6" />
                  </Link>
                ))}
              </div>
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


