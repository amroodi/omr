'use client';
import Link from 'next/link';
import { useState } from 'react';
import { inquiryApi } from '../lib/api';
import { ErrorBox, Field, StatusBadge } from './components/ui';
import { Icon } from './components/Shell';
import { Reveal } from './components/reveal';

export default function Landing() {
  return (
    <div className="relative">
      {/* full-bleed animated background */}
      <div className="aurora" style={{ position: 'fixed' }}><span /></div>
      <div className="grid-overlay" style={{ position: 'fixed' }} />

      <Hero />
      <TrustStrip />
      <Features />
      <HowItWorks />
      <Preview />
      <CTA />
    </div>
  );
}

/* ─────────────────────────────── Hero ─────────────────────────────── */
function Hero() {
  return (
    <section className="grid lg:grid-cols-[1.1fr_.9fr] gap-10 items-center pt-8 lg:pt-16 pb-16">
      <div className="order-2 lg:order-1">
        <Reveal>
          <span className="badge badge-info mb-5" style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--brand)', display: 'inline-block' }} />
            پلتفرم چندسازمانی بیمه — نسل جدید
          </span>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="display text-4xl md:text-5xl lg:text-6xl">
            مدیریت هوشمند بیمه،
            <br /> با امنیت <span className="gradient-text">بی‌نظیر</span>
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mt-5 text-lg leading-8 max-w-xl" style={{ color: 'var(--muted)' }}>
            استعلام، پیگیری و صدور پرونده‌های بیمه در یک سامانه یکپارچه. رمزنگاری سطح بانکی،
            دسترسی نقش‌محور و گزارش‌گیری حرفه‌ای — آماده ارائه به کارگزاری‌های سراسر کشور.
          </p>
        </Reveal>
        <Reveal delay={240}>
          <div className="flex flex-wrap gap-3 mt-7">
            <Link href="/org/login" className="btn btn-primary" style={{ padding: '0.8rem 1.5rem', fontSize: '0.95rem' }}>
              ورود سازمان‌ها
              <Icon path="M5 12h14M13 6l6 6-6 6" />
            </Link>
            <Link href="/customer/login" className="btn btn-glass" style={{ padding: '0.8rem 1.5rem', fontSize: '0.95rem' }}>
              پورتال بیمه‌گزار
            </Link>
          </div>
        </Reveal>
        <Reveal delay={320}>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8 text-sm" style={{ color: 'var(--muted)' }}>
            {['رمزنگاری AES-256', 'احراز هویت پیامکی', 'تقویم شمسی', 'چند-مستأجری کامل'].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span style={{ color: 'var(--brand)' }}><Icon path="M20 6L9 17l-5-5" /></span>{t}
              </span>
            ))}
          </div>
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
            <span className="font-bold">پرونده {result.caseNumber}</span>
            <StatusBadge status={result.status} />
          </div>
          {[['نام', result.insured?.fullName], ['کد ملی', result.insured?.nationalCodeMasked], ['بیمه‌نامه', result.policy ? `${result.policy.policyNumber} — ${result.policy.carrier}` : null], ['تاریخ پرداخت', result.workflow?.paidAt]].map(([l, v]) => v ? (
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

/* ─────────────────────────── Trust / stats strip ─────────────────────────── */
function TrustStrip() {
  const items = [
    ['۲۵۶', 'بیتی رمزنگاری AES'],
    ['۳', 'لایه کنترل دسترسی'],
    ['۱۰۰٪', 'ایزوله‌سازی داده سازمان'],
    ['∞', 'سازمان و شعبه'],
  ];
  return (
    <Reveal>
      <div className="glass grid grid-cols-2 md:grid-cols-4 divide-x divide-x-reverse" style={{ borderRadius: 18, borderColor: 'var(--border)' }}>
        {items.map(([n, l], i) => (
          <div key={i} className="p-5 text-center" style={{ borderColor: 'var(--border)' }}>
            <div className="text-3xl font-extrabold gradient-text">{n}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{l}</div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

/* ─────────────────────────────── Features ─────────────────────────────── */
function Features() {
  const feats = [
    ['M12 2l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V5l7-3z', 'امنیت سطح بانکی', 'رمزنگاری میدانی AES-256، ایندکس کور برای جستجو، و حذف کامل آسیب‌پذیری افشای اطلاعات.'],
    ['M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01', 'معماری چند-مستأجری', 'هر سازمان با داده، برند و کاربران کاملاً مجزا. آماده ارائه به‌صورت سرویس به کارگزاری‌ها.'],
    ['M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z', 'کنترل دسترسی دقیق', 'نقش‌های سفارشی با مجوزهای تفکیک‌شده، شعبه‌محور و ضدارتقای دسترسی.'],
    ['M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 15l2 2 4-4', 'ارزیابی اصالت مدارک', 'صف بررسی اسناد، تایید/رد اصالت و ثبت کامل تصمیمات کارشناسان.'],
    ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', 'خروجی و ورود دسته‌ای', 'خروجی Excel و PDF با برند سازمان، و ورود انبوه بیمه‌گزاران با اعتبارسنجی پیش از ثبت.'],
    ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', 'تقویم شمسی یکپارچه', 'نمایش و ثبت همه تاریخ‌ها به‌صورت شمسی در سراسر سامانه، فیلترها و گزارش‌ها.'],
  ];
  return (
    <section className="py-16">
      <Reveal>
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="badge badge-neutral mb-3">امکانات</span>
          <h2 className="display text-3xl md:text-4xl">هرآنچه یک پلتفرم بیمه مدرن نیاز دارد</h2>
          <p className="mt-3" style={{ color: 'var(--muted)' }}>از امنیت تا گزارش‌گیری، همه در یک تجربه یکپارچه و حرفه‌ای.</p>
        </div>
      </Reveal>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {feats.map(([icon, title, desc], i) => (
          <Reveal key={title} delay={i * 70}>
            <div className="glass card-hover h-full p-6" style={{ borderRadius: 18 }}>
              <span className="feature-icon mb-4"><Icon path={icon} /></span>
              <h3 className="font-bold text-lg mb-1.5">{title}</h3>
              <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>{desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────── How it works ─────────────────────────────── */
function HowItWorks() {
  const steps = [
    ['۱', 'شناسایی', 'کد ملی و شماره موبایل ثبت‌شده را وارد کنید. هیچ اطلاعاتی در آدرس صفحه قرار نمی‌گیرد.'],
    ['۲', 'تایید پیامکی', 'کد یکبارمصرف به شماره شما ارسال می‌شود و یک توکن کوتاه‌مدت مخصوص همان پرونده صادر می‌گردد.'],
    ['۳', 'مشاهده امن', 'اطلاعات پرونده فقط برای شما و تنها برای همان رکورد نمایش داده می‌شود.'],
  ];
  return (
    <section className="py-16">
      <Reveal>
        <div className="text-center mb-10">
          <span className="badge badge-neutral mb-3">فرآیند استعلام</span>
          <h2 className="display text-3xl md:text-4xl">امنیت در سه گام ساده</h2>
        </div>
      </Reveal>
      <div className="grid md:grid-cols-3 gap-4">
        {steps.map(([n, t, d], i) => (
          <Reveal key={t} delay={i * 90}>
            <div className="relative p-6 h-full glass" style={{ borderRadius: 18 }}>
              <div className="text-5xl font-extrabold" style={{ color: 'color-mix(in srgb, var(--brand) 25%, transparent)' }}>{n}</div>
              <h3 className="font-bold text-lg mt-2 mb-1.5">{t}</h3>
              <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>{d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
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
            <span className="text-xs mr-3" style={{ color: 'var(--muted)' }}>بیمس — پنل سازمان</span>
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
