'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { inquiryApi } from '../lib/api';
import { client, setToken, setTenantSlug } from '../lib/client';
import { ErrorBox, Field, StatusBadge } from './components/ui';
import { Icon } from './components/Shell';
import { Reveal } from './components/reveal';
import { DotGrid } from './components/DotGrid';

export default function Landing() {
  return (
    <div className="relative">
      {/* full-bleed animated background */}
      <div className="aurora" style={{ position: 'fixed' }}><span /></div>
      <DotGrid />

      <Hero />
      <LoginSection />
      <Preview />
      <CTA />
    </div>
  );
}

/* ─────────────────────────────── Hero ─────────────────────────────── */
function Hero() {
  return (
    <section className="grid lg:grid-cols-[1.1fr_.9fr] gap-10 items-center pt-8 lg:pt-16 pb-10">
      <div className="order-2 lg:order-1">
        <Reveal delay={80}>
          <h1 className="display text-4xl md:text-5xl lg:text-6xl">
            مدیریت هوشمند بیمه <span className="gradient-text">عمر و حوادث</span>
          </h1>
        </Reveal>
      </div>

      <div className="order-1 lg:order-2">
        <Reveal delay={160}>
          <div className="floaty">
            <InquiryCard />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ───────────────────────── Inquiry card (functional) ───────────────────────── */
type Step = 'identify' | 'otp' | 'result';
function InquiryCard() {
  const [step, setStep] = useState<Step>('identify');
  const [nationalCode, setNationalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(''); setLoading(true);
    try { await fn(); } catch (e: any) { setError(e.message || 'خطا'); } finally { setLoading(false); }
  };
  const submitIdentify = () => run(async () => { const r = await inquiryApi.requestOtp(nationalCode, phone); setMsg(r.message); setStep('otp'); });
  const submitOtp = () => run(async () => { const r = await inquiryApi.verifyOtp(nationalCode, phone, code); setResult(await inquiryApi.getCase(r.token)); setStep('result'); });

  return (
    <div className="glass p-6 lg:p-7" style={{ borderRadius: 22, boxShadow: 'var(--shadow-lg)' }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="font-bold text-lg">استعلام سریع پرونده</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>امن، بدون درج کد ملی در آدرس</div>
        </div>
        <span className="feature-icon" style={{ width: 40, height: 40 }}><Icon path="M12 2l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V5l7-3z" /></span>
      </div>

      <div className="flex items-center gap-1.5 mb-5">
        {(['identify', 'otp', 'result'] as Step[]).map((s, i) => {
          const idx = step === 'identify' ? 0 : step === 'otp' ? 1 : 2;
          return <span key={s} className="h-1.5 rounded-full flex-1 transition-all" style={{ background: i <= idx ? 'var(--brand)' : 'var(--border-strong)' }} />;
        })}
      </div>

      <ErrorBox message={error} />

      {step === 'identify' && (
        <div className="space-y-3.5">
          <Field label="کد ملی"><input className="input" value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} placeholder="کد ملی ۱۰ رقمی" inputMode="numeric" /></Field>
          <Field label="شماره موبایل"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="۰۹۱۲۳۴۵۶۷۸۹" inputMode="numeric" /></Field>
          <button onClick={submitIdentify} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full" style={{ padding: '0.75rem' }}>{loading ? 'در حال ارسال…' : 'دریافت کد تایید'}</button>
        </div>
      )}
      {step === 'otp' && (
        <div className="space-y-3.5">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>
          <Field label="کد تایید"><input className="input text-center text-xl tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="––––––" inputMode="numeric" /></Field>
          <button onClick={submitOtp} disabled={loading || code.length < 4} className="btn btn-primary w-full" style={{ padding: '0.75rem' }}>{loading ? 'در حال بررسی…' : 'مشاهده پرونده'}</button>
          <button onClick={() => setStep('identify')} className="btn btn-glass btn-sm w-full">بازگشت</button>
        </div>
      )}
      {step === 'result' && result && (
        <div className="fade-up">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold">پرونده {result.kind === 'claim' ? result.claimNumber : result.caseNumber}</span>
            <StatusBadge status={result.status} />
          </div>
          {(result.kind === 'claim'
            ? [['بیمه‌گر', result.insurerName], ['بیمه‌شده (متوفی)', result.deceasedName], ['تاریخ وقوع', result.eventDate], ['تاریخ ثبت', result.createdAt], ['توضیحات', result.description]]
            : [['نام', result.insured?.fullName], ['کد ملی', result.insured?.nationalCodeMasked], ['بیمه‌نامه', result.policy ? `${result.policy.policyNumber} — ${result.policy.carrier}` : null], ['تاریخ پرداخت', result.workflow?.paidAt]]
          ).map(([l, v]) => v ? (
            <div key={l as string} className="flex justify-between py-2 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: 'var(--muted)' }}>{l}</span><span className="font-semibold">{v}</span>
            </div>
          ) : null)}
          <button onClick={() => { setStep('identify'); setResult(null); setCode(''); }} className="btn btn-glass btn-sm w-full mt-4">استعلام جدید</button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Side-by-side logins (functional) ─────────────────────── */
function LoginSection() {
  return (
    <section className="pb-16">
      <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
        <Reveal><CustomerLoginCard /></Reveal>
        <Reveal delay={100}><OrgLoginCard /></Reveal>
      </div>
    </section>
  );
}

const PERSON_ICON = 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z';
const ORG_ICON = 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01';

function CardShell({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="glass p-6 lg:p-7 h-full" style={{ borderRadius: 22, boxShadow: 'var(--shadow-lg)' }}>
      <div className="flex items-center gap-3 mb-5">
        <span className="feature-icon" style={{ width: 40, height: 40 }}><Icon path={icon} /></span>
        <div>
          <div className="font-bold text-lg">{title}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** بیمه‌گزار login — National ID + phone → OTP → /customer. Signup goes to the full page. */
function CustomerLoginCard() {
  const router = useRouter();
  const [tenant, setTenant] = useState('damuon');
  const [nationalCode, setNid] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'otp'>('id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const wrap = async (fn: () => Promise<void>) => { setError(''); setLoading(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setLoading(false); } };
  const request = () => wrap(async () => { setTenantSlug(tenant); await client.post('/customer/login/request-otp', { nationalCode, phone }); setStep('otp'); });
  const verify = () => wrap(async () => { const r = await client.post<{ token: string }>('/customer/login/verify-otp', { nationalCode, phone, code }); setToken('customer', r.token); router.push('/customer'); });

  return (
    <CardShell icon={PERSON_ICON} title="پورتال بیمه‌گزار" subtitle="پیگیری پرونده و بارگذاری مدارک">
      <div className="space-y-3.5">
        <ErrorBox message={error} />
        {step === 'id' ? (
          <>
            <Field label="شناسه سازمان"><input className="input" value={tenant} onChange={(e) => setTenant(e.target.value)} style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
            <Field label="کد ملی"><input className="input" value={nationalCode} onChange={(e) => setNid(e.target.value)} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
            <Field label="موبایل ثبت‌شده"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} onKeyDown={(e) => e.key === 'Enter' && nationalCode && phone && request()} /></Field>
            <button onClick={request} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full" style={{ padding: '0.75rem' }}>{loading ? '…' : 'ارسال کد'}</button>
            <Link href="/customer/login" className="btn btn-ghost btn-sm w-full">حساب ندارید؟ ثبت‌نام بیمه‌گزار</Link>
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>کد تایید به شماره {phone} ارسال شد.</p>
            <Field label="کد تایید"><input className="input text-center tracking-[0.5em] text-lg" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="––––––" onKeyDown={(e) => e.key === 'Enter' && code.length >= 4 && verify()} /></Field>
            <button onClick={verify} disabled={loading || code.length < 4} className="btn btn-primary w-full" style={{ padding: '0.75rem' }}>{loading ? '…' : 'ورود'}</button>
            <button onClick={() => { setStep('id'); setError(''); }} className="btn btn-ghost btn-sm w-full">بازگشت</button>
          </>
        )}
      </div>
    </CardShell>
  );
}

/** Organization login — slug + username + password → /org. */
function OrgLoginCard() {
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
    <CardShell icon={ORG_ICON} title="ورود سازمان‌ها" subtitle="پنل مدیریت پرونده‌های سازمان">
      <div className="space-y-3.5">
        <ErrorBox message={error} />
        <Field label="شناسه سازمان"><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="damuon" style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="نام کاربری"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && username && password && submit()} /></Field>
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full" style={{ padding: '0.75rem' }}>{loading ? '…' : 'ورود'}</button>
      </div>
    </CardShell>
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
            <Link href="/admin/login" className="btn" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '0.8rem 1.6rem' }}>پنل مدیر سکو</Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
