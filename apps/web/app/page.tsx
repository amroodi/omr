'use client';
import { useState } from 'react';
import { inquiryApi } from '../lib/api';
import { ErrorBox, Field, StatusBadge } from './components/ui';
import { Icon } from './components/Shell';

type Step = 'identify' | 'otp' | 'result';

export default function InquiryPage() {
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
  const submitOtp = () => run(async () => {
    const r = await inquiryApi.verifyOtp(nationalCode, phone, code);
    setResult(await inquiryApi.getCase(r.token));
    setStep('result');
  });

  return (
    <div className="grid lg:grid-cols-2 gap-8 items-start">
      {/* Hero / value prop */}
      <div className="pt-4 lg:pt-8 order-2 lg:order-1">
        <span className="badge badge-info mb-4">سامانه چندسازمانی بیمه</span>
        <h1 className="text-3xl lg:text-4xl font-extrabold leading-tight">
          استعلام <span style={{ color: 'var(--brand)' }}>امن</span> پرونده بیمه،
          <br /> بدون افشای اطلاعات هویتی
        </h1>
        <p className="mt-4 text-base leading-7" style={{ color: 'var(--muted)' }}>
          دسترسی به اطلاعات پرونده تنها با تایید کد پیامکی امکان‌پذیر است. کد ملی هرگز در آدرس صفحه قرار نمی‌گیرد
          و تمام اطلاعات حساس به‌صورت رمزنگاری‌شده نگهداری می‌شود.
        </p>
        <div className="mt-6 space-y-3">
          {[
            ['M12 2l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V5l7-3z', 'احراز هویت دومرحله‌ای با کد یکبارمصرف'],
            ['M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', 'رمزنگاری AES-256 اطلاعات حساس'],
            ['M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11', 'ثبت کامل رخدادها (Audit) و کنترل دسترسی'],
          ].map(([p, t]) => (
            <div key={t} className="flex items-center gap-3">
              <span className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                <Icon path={p} />
              </span>
              <span className="text-sm">{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Inquiry card */}
      <div className="order-1 lg:order-2">
        <div className="card p-6 lg:p-7 fade-up" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <StepHeader step={step} />
          <ErrorBox message={error} />

          {step === 'identify' && (
            <div className="space-y-4 mt-4">
              <Field label="کد ملی">
                <input className="input" value={nationalCode} onChange={(e) => setNationalCode(e.target.value)} placeholder="کد ملی ۱۰ رقمی" inputMode="numeric" />
              </Field>
              <Field label="شماره موبایل ثبت‌شده">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="۰۹۱۲۳۴۵۶۷۸۹" inputMode="numeric" />
              </Field>
              <button onClick={submitIdentify} disabled={loading || !nationalCode || !phone} className="btn btn-primary w-full">
                {loading ? 'در حال ارسال…' : 'ارسال کد تایید'}
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-4 mt-4">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>
              <Field label="کد تایید">
                <input className="input text-center tracking-[0.5em] text-lg" value={code} onChange={(e) => setCode(e.target.value)} placeholder="––––––" inputMode="numeric" />
              </Field>
              <button onClick={submitOtp} disabled={loading || code.length < 4} className="btn btn-primary w-full">
                {loading ? 'در حال بررسی…' : 'تایید و مشاهده پرونده'}
              </button>
              <button onClick={() => setStep('identify')} className="btn btn-ghost btn-sm w-full">بازگشت</button>
            </div>
          )}

          {step === 'result' && result && <CaseResult data={result} onReset={() => { setStep('identify'); setResult(null); setCode(''); }} />}
        </div>
      </div>
    </div>
  );
}

function StepHeader({ step }: { step: Step }) {
  const steps = [['۱', 'شناسایی'], ['۲', 'کد تایید'], ['۳', 'پرونده']];
  const idx = step === 'identify' ? 0 : step === 'otp' ? 1 : 2;
  return (
    <div className="flex items-center gap-2 mb-2">
      {steps.map(([n, l], i) => (
        <div key={l} className="flex items-center gap-2">
          <span className="badge" style={i <= idx ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)' }}>{n}</span>
          <span className="text-xs" style={{ color: i === idx ? 'var(--text)' : 'var(--muted)', fontWeight: i === idx ? 700 : 400 }}>{l}</span>
          {i < 2 && <span style={{ width: 16, height: 1, background: 'var(--border-strong)' }} />}
        </div>
      ))}
    </div>
  );
}

function CaseResult({ data, onReset }: { data: any; onReset: () => void }) {
  const Row = ({ label, value }: { label: string; value: any }) =>
    value ? (
      <div className="flex justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--muted)' }} className="text-sm">{label}</span>
        <span className="text-sm font-semibold">{value}</span>
      </div>
    ) : null;
  return (
    <div className="mt-4 fade-up">
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold">پرونده {data.caseNumber}</span>
        <StatusBadge status={data.status} />
      </div>
      <Row label="نام بیمه‌گذار" value={data.insured?.fullName} />
      <Row label="کد ملی" value={data.insured?.nationalCodeMasked} />
      <Row label="تاریخ فوت" value={data.insured?.dateOfDeath} />
      {data.policy && <Row label="بیمه‌نامه" value={`${data.policy.policyNumber} — ${data.policy.carrier}`} />}
      <Row label="تاریخ مرحله" value={data.workflow?.stageDate} />
      <Row label="تاریخ پرداخت" value={data.workflow?.paidAt} />
      {data.payments?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>سوابق پرداخت</div>
          {data.payments.map((p: any, i: number) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span>{p.date}</span><span>{p.amount}</span><StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      )}
      <button onClick={onReset} className="btn btn-ghost btn-sm w-full mt-4">استعلام جدید</button>
    </div>
  );
}
