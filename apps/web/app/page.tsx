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
const IC_UPLOAD = 'M12 15V3m0 0L8 7m4-4l4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4';
const IC_PHONE = 'M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2';
const IC_EVAL = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0 2 2 0 00-4 0zM9 14l2 2 4-4';

/** A soft entry button inside a group (link when enabled, muted «به زودی» when coming soon). */
function EntryBtn({ label, href, icon, soon }: { label: string; href?: string; icon: string; soon?: boolean }) {
  const inner = (
    <>
      <Icon path={icon} />
      <span>{label}</span>
    </>
  );
  const cls = 'flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold transition';
  if (soon || !href) {
    return <button disabled className={cls} style={{ background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'default' }}>{inner}</button>;
  }
  return <Link href={href} className={cls} style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>{inner}</Link>;
}

/** A titled group of entry buttons (mirrors the reference's grouped boxes). */
function EntryGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h3 className="font-bold text-center mb-3">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function AuthHub() {
  return (
    <section className="w-full px-4 py-2">
      <Reveal delay={80}>
        <div className="glass mx-auto overflow-hidden" style={{ borderRadius: 22, boxShadow: 'var(--shadow-lg)', maxWidth: 800 }}>
          <div className="grid md:grid-cols-2" style={{ minHeight: 560 }}>
            {/* RIGHT (RTL first): brand + استعلام سریع form */}
            <div className="login-pills p-6 md:p-8 md:flex md:flex-col md:justify-center text-center" style={{ borderLeft: '1px solid var(--border)' }}>
              <div className="flex justify-center mb-3">
                <a href="https://damuon.com" target="_blank" rel="noopener noreferrer" className="plogo plogo-damuon" aria-label="آتیه اندیشان دامون" style={{ height: 48, width: 140 }} />
              </div>
              <h2 className="font-extrabold text-lg" style={{ color: 'var(--brand)' }}>کارگزاری بیمه مستقیم برخط دامون</h2>
              <p className="font-bold text-sm mt-1 mb-5">سامانه کنترل و ارزیابی عمر و حادثه</p>
              <InquiryForm />
            </div>

            {/* LEFT: grouped entry buttons (each primary opens its own login panel) */}
            <div className="p-6 md:p-8 flex flex-col gap-5 md:justify-center">
              <div className="flex justify-center mb-1">
                <a href="https://bimmes.ir" target="_blank" rel="noopener noreferrer" className="plogo plogo-bimmes" aria-label="بیمس" style={{ height: 48, width: 140 }} />
              </div>
              <div className="flex flex-col gap-4" style={{ maxWidth: 300, width: '100%', margin: '0 auto' }}>
                <EntryGroup title="پورتال بیمه‌گزار">
                  <EntryBtn label="ورود برای بارگزاری مدارک" href="/customer/login" icon={IC_UPLOAD} />
                  <EntryBtn label="نرم‌افزار گوشی هوشمند به‌زودی" icon={IC_PHONE} soon />
                </EntryGroup>
                <EntryGroup title="ورود سازمان‌">
                  <EntryBtn label="ورود برای ارزیابی پرونده‌ها" href="/org/login" icon={IC_EVAL} />
                  <EntryBtn label="نرم‌افزار گوشی‌های هوشمند به‌زودی" icon={IC_PHONE} soon />
                </EntryGroup>
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
    <div className="space-y-3.5" style={{ maxWidth: 300, width: '100%', margin: '0 auto' }}>
        <ErrorBox message={error} />
        {step === 'id' && (
          <>
            <input className="input" style={{ textAlign: 'center' }} value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" placeholder="کد ملی ۱۰ رقمی متوفی" />
            <input className="input" style={{ textAlign: 'center' }} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="شماره موبایل شما" onKeyDown={(e) => e.key === 'Enter' && nid && phone && request()} />
            <button onClick={request} disabled={loading || !nid || !phone} className="btn btn-primary w-full" style={{ padding: '0.8rem' }}>{loading ? 'در حال ارسال…' : 'دریافت کد تایید'}</button>
            <p className="text-sm font-bold text-center pt-1">امور مشتریان کارگزاری دامون: ۰۲۱-۵۷۳۸۹۰۰۰</p>
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
  );
}


