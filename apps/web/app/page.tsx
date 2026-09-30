'use client';
import { useState } from 'react';
import { inquiryApi } from '../lib/api';

type Step = 'identify' | 'otp' | 'result';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

export default function InquiryPage() {
  const [step, setStep] = useState<Step>('identify');
  const [nationalCode, setNationalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setLoading(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || 'خطا');
    } finally {
      setLoading(false);
    }
  };

  const submitIdentify = () =>
    run(async () => {
      const r = await inquiryApi.requestOtp(nationalCode, phone);
      setMsg(r.message);
      setStep('otp');
    });

  const submitOtp = () =>
    run(async () => {
      const r = await inquiryApi.verifyOtp(nationalCode, phone, code);
      setToken(r.token);
      const c = await inquiryApi.getCase(r.token);
      setResult(c);
      setStep('result');
    });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">استعلام امن پرونده بیمه</h1>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        دسترسی به اطلاعات پرونده تنها با تایید کد پیامکی ممکن است. کد ملی در آدرس صفحه قرار نمی‌گیرد.
      </p>

      {error && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {step === 'identify' && (
        <div className="rounded-xl border p-4 space-y-3" style={card}>
          <label className="block text-sm">کد ملی</label>
          <input
            className="w-full rounded-lg border p-2 bg-transparent"
            style={{ borderColor: 'var(--border)' }}
            value={nationalCode}
            onChange={(e) => setNationalCode(e.target.value)}
            placeholder="کد ملی"
            inputMode="numeric"
          />
          <label className="block text-sm">شماره موبایل ثبت‌شده</label>
          <input
            className="w-full rounded-lg border p-2 bg-transparent"
            style={{ borderColor: 'var(--border)' }}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="۰۹۱۲..."
            inputMode="numeric"
          />
          <button
            onClick={submitIdentify}
            disabled={loading || !nationalCode || !phone}
            className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50"
          >
            {loading ? 'در حال ارسال...' : 'ارسال کد تایید'}
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div className="rounded-xl border p-4 space-y-3" style={card}>
          <p className="text-sm">{msg}</p>
          <label className="block text-sm">کد تایید</label>
          <input
            className="w-full rounded-lg border p-2 bg-transparent tracking-widest text-center"
            style={{ borderColor: 'var(--border)' }}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="------"
            inputMode="numeric"
          />
          <button
            onClick={submitOtp}
            disabled={loading || code.length < 4}
            className="w-full rounded-lg bg-brand py-2 text-white disabled:opacity-50"
          >
            {loading ? 'در حال بررسی...' : 'تایید و مشاهده پرونده'}
          </button>
        </div>
      )}

      {step === 'result' && result && <CaseView data={result} />}
    </div>
  );
}

function CaseView({ data }: { data: any }) {
  const Row = ({ label, value }: { label: string; value: any }) =>
    value ? (
      <div className="flex justify-between py-1 border-b" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span>{value}</span>
      </div>
    ) : null;

  return (
    <div className="rounded-xl border p-4 space-y-4" style={card}>
      <div className="flex justify-between items-center">
        <h2 className="font-bold">پرونده {data.caseNumber}</h2>
        <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)' }}>
          {statusLabel(data.status)}
        </span>
      </div>

      <section>
        <h3 className="text-sm font-bold mb-1">اطلاعات بیمه‌گذار</h3>
        <Row label="نام" value={data.insured?.fullName} />
        <Row label="کد ملی" value={data.insured?.nationalCodeMasked} />
        <Row label="تاریخ فوت" value={data.insured?.dateOfDeath} />
      </section>

      {data.policy && (
        <section>
          <h3 className="text-sm font-bold mb-1">بیمه‌نامه</h3>
          <Row label="شماره بیمه‌نامه" value={data.policy.policyNumber} />
          <Row label="شرکت بیمه" value={data.policy.carrier} />
          <Row label="تاریخ شروع" value={data.policy.startDate} />
        </section>
      )}

      <section>
        <h3 className="text-sm font-bold mb-1">مراحل پرونده</h3>
        <Row label="تاریخ مرحله" value={data.workflow?.stageDate} />
        <Row label="درخواست مدارک" value={data.workflow?.docsRequestedAt} />
        <Row label="ارسال مدارک" value={data.workflow?.docsSentAt} />
        <Row label="ارسال به ستاد" value={data.workflow?.sentToHqAt} />
        <Row label="تایید پرونده" value={data.workflow?.approvedAt} />
        <Row label="پرداخت" value={data.workflow?.paidAt} />
      </section>

      {data.payments?.length > 0 && (
        <section>
          <h3 className="text-sm font-bold mb-1">سوابق پرداخت</h3>
          {data.payments.map((p: any, i: number) => (
            <div key={i} className="flex justify-between py-1 border-b" style={{ borderColor: 'var(--border)' }}>
              <span>{p.date}</span>
              <span>{p.description}</span>
              <span>{p.amount}</span>
              <span>{p.status === 'PAID' ? 'پرداخت‌شده' : 'در انتظار'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function statusLabel(s: string): string {
  return (
    { PAID: 'پرداخت شده', REVIEWING: 'در حال بررسی', UNPAYABLE: 'غیرقابل پرداخت', OTHER: 'سایر' }[
      s
    ] || s
  );
}
