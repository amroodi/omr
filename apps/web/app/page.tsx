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
    <div className="relative">
      {/* full-bleed animated background */}
      <div className="aurora" style={{ position: 'fixed' }}><span /></div>
      <DotGrid />

      <Hero />
      <AuthHub />
      <Preview />
      <CTA />
    </div>
  );
}

/* ─────────────────────────────── Hero ─────────────────────────────── */
function Hero() {
  return (
    <section className="pt-10 lg:pt-16 pb-8 text-center">
      <Reveal>
        <h1 className="display text-4xl md:text-5xl lg:text-6xl">
          مدیریت هوشمند بیمه <span className="gradient-text">عمر و حوادث</span>
        </h1>
      </Reveal>
    </section>
  );
}

/* ───────────────────── Auth hub — one panel, three tabs ───────────────────── */
const TABS: { id: Tab; label: string }[] = [
  { id: 'inquiry', label: 'استعلام سریع پرونده' },
  { id: 'customer', label: 'پورتال بیمه‌گزار' },
  { id: 'org', label: 'ورود سازمان‌ها' },
];

function AuthHub() {
  const [tab, setTab] = useState<Tab>('inquiry');
  return (
    <section className="pb-16">
      <Reveal delay={120}>
        <div className="floaty glass max-w-4xl mx-auto overflow-hidden" style={{ borderRadius: 24, boxShadow: 'var(--shadow-lg)' }}>
          <div className="flex flex-col md:flex-row-reverse">
            {/* tab buttons (left on desktop, top on mobile) */}
            <div className="p-5 md:p-6 md:w-[38%] flex flex-col gap-3 justify-center" style={{ background: 'var(--surface-2)', borderLeft: '1px solid var(--border)' }}>
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl text-sm font-bold transition"
                    style={active
                      ? { background: 'linear-gradient(135deg, var(--brand), var(--brand-600))', color: '#fff', boxShadow: '0 10px 22px -10px rgba(255,120,0,.65)' }
                      : { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <span>{t.label}</span>
                    <Icon path="M5 12h14M13 6l6 6-6 6" />
                  </button>
                );
              })}
            </div>

            {/* active form (right on desktop) */}
            <div className="relative p-6 md:p-8 md:flex-1">
              <span style={{ position: 'absolute', top: 0, right: 0, width: '55%', height: 4, background: 'linear-gradient(90deg, transparent, var(--brand))' }} />
              {tab === 'inquiry' && <InquiryForm />}
              {tab === 'customer' && <CustomerForm />}
              {tab === 'org' && <OrgForm />}
              <PartnerLogos />
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

function PartnerLogos() {
  return (
    <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="partner-logos relative mx-auto" style={{ maxWidth: 360 }}>
        {/* Theme-specific variants (navy on light, white on dark) — swapped by CSS, no background. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo-light" src="/partners-light.webp" alt="بیمس و آتیه اندیشان دامون" style={{ width: '100%', height: 'auto' }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo-dark" src="/partners-dark.webp" alt="بیمس و آتیه اندیشان دامون" style={{ width: '100%', height: 'auto' }} />
        <a href="https://bimmes.ir" target="_blank" rel="noopener noreferrer" aria-label="بیمس" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: '52%' }} />
        <a href="https://damuon.com" target="_blank" rel="noopener noreferrer" aria-label="آتیه اندیشان دامون" style={{ position: 'absolute', top: 0, bottom: 0, left: '52%', right: 0 }} />
      </div>
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

/* ─────────────────────────────── Product preview ─────────────────────────────── */
function Preview() {
  return (
    <section className="py-16">
      <Reveal>
        <div className="text-center max-w-2xl mx-auto mb-8">
          <span className="badge badge-neutral mb-3">پنل سازمان</span>
          <h2 className="display text-3xl md:text-4xl">داشبورد حرفه‌ای، ساخته‌شده برای کارشناسان</h2>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <div className="glass p-3 md:p-4" style={{ borderRadius: 22, boxShadow: 'var(--shadow-lg)' }}>
          <div className="flex items-center gap-1.5 px-2 py-2">
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#ff5f57' }} />
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#febc2e' }} />
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#28c840' }} />
            <span className="text-xs mr-3" style={{ color: 'var(--muted)' }}>دامون — پنل سازمان</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="grid" style={{ gridTemplateColumns: '180px 1fr' }}>
              <div className="p-3 space-y-2 hidden sm:block" style={{ background: 'var(--surface-2)', borderLeft: '1px solid var(--border)' }}>
                {['پرونده‌ها', 'ارزیابی مدارک', 'ورود دسته‌ای', 'کاربران و نقش‌ها', 'اشتراک‌گذاری'].map((t, i) => (
                  <div key={t} className="text-xs px-2 py-2 rounded-lg" style={i === 0 ? { background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700 } : { color: 'var(--muted)' }}>{t}</div>
                ))}
              </div>
              <div className="p-4" style={{ background: 'var(--surface)' }}>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[['۲۴', 'کل پرونده‌ها'], ['۹', 'در حال بررسی'], ['۱۵', 'پرداخت‌شده']].map(([n, l]) => (
                    <div key={l} className="p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                      <div className="text-xl font-extrabold">{n}</div>
                      <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {[['CASE-0148', 'رضا محمدی', 'پرداخت شده', 'badge-success'], ['CASE-0147', 'مریم احمدی', 'در حال بررسی', 'badge-warning'], ['CASE-0146', 'علی کریمی', 'در حال بررسی', 'badge-warning']].map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 text-xs" style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                      <span className="font-semibold">{r[0]}</span>
                      <span style={{ color: 'var(--muted)' }}>{r[1]}</span>
                      <span className={`badge ${r[3]}`}>{r[2]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────── CTA ─────────────────────────────── */
function CTA() {
  return (
    <section className="py-16">
      <Reveal>
        <div className="relative overflow-hidden text-center p-10 md:p-14" style={{ borderRadius: 26, background: 'linear-gradient(135deg, #ff9500, #ff6a00)', boxShadow: '0 30px 60px -20px rgba(255,120,0,0.5)' }}>
          <h2 className="display text-3xl md:text-4xl text-white">آماده‌اید سازمان‌تان را دیجیتال کنید؟</h2>
          <p className="mt-3 text-white/90 max-w-xl mx-auto">پلتفرمی که می‌توانید با برند خودتان به شرکت‌های بیمه و کارگزاری‌های دیگر ارائه دهید.</p>
          <div className="flex flex-wrap gap-3 justify-center mt-7">
            <Link href="/org/login" className="btn" style={{ background: '#fff', color: '#c96e00', padding: '0.8rem 1.6rem', fontWeight: 700 }}>شروع کنید</Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
