'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '../components/ui';
import { BrandMark } from '../components/brand';

const fmtAmt = (v: any) => (v != null && String(v).trim() !== '' ? `${Number(String(v).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال` : null);

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
      <span style={{ color: 'rgba(255,255,255,0.65)' }}>{label}: </span>
      <span className="font-bold" dir="ltr" style={{ unicodeBidi: 'isolate' }}>{value}</span>
    </span>
  );
}

/** مشاهده سریع و استعلام پرونده — the inquiry result, shown on its own page (SVG «Group 872» design). */
export default function EstelamResult() {
  const [r, setR] = useState<any>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const s = sessionStorage.getItem('inquiryResult'); if (s) setR(JSON.parse(s)); } catch { /* private mode */ }
    setReady(true);
  }, []);

  const fields: [string, any][] = r
    ? [
        ['بیمه‌گر', r.insurerName],
        ['بیمه‌شده (متوفی)', r.deceasedName],
        ['کد ملی', r.nationalCodeMasked],
        ['تاریخ تولد', r.birthDate],
        ['نام شرکت / محل فعالیت', r.companyName],
        ['شماره بیمه‌نامه', r.policyNumber],
        ['تاریخ شروع بیمه‌نامه', r.policyStartDate],
        ['سرمایه فوت', fmtAmt(r.deathCapital)],
        ['سرمایه حادثه', fmtAmt(r.accidentCapital)],
        ['مبلغ قابل پرداخت', fmtAmt(r.payableAmount)],
        ['علت فوت', r.causeOfDeath],
        ['تاریخ وقوع', r.eventDate],
        ['تاریخ ثبت', r.createdAt],
      ]
    : [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--panel-bg)' }}>
      {/* Navy top bar */}
      <div style={{ background: '#012141', height: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '0 clamp(16px,4vw,48px)' }}>
        <Link href="/" className="flex items-center gap-2 text-sm font-bold" style={{ color: '#fff' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" /></svg>
          صفحه اصلی
        </Link>
        <span style={{ flex: 1 }} />
        <span className="flex items-center gap-2" style={{ color: '#fff' }}>
          <BrandMark size={28} />
          <span className="font-extrabold">دامون</span>
        </span>
      </div>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px,3vw,34px)' }}>
        {!ready ? (
          <div className="flex justify-center p-16"><span className="pspinner" /></div>
        ) : !r ? (
          <div className="pcard p-10 text-center space-y-3" style={{ marginTop: 24 }}>
            <p style={{ color: 'var(--muted)' }}>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="btn btn-solid btn-solid-lg inline-flex">استعلام جدید</Link>
          </div>
        ) : (
          <>
            {/* Navy header card */}
            <div style={{ background: '#012141', borderRadius: 22, color: '#fff', padding: 'clamp(18px,3vw,30px)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-extrabold text-lg">مشاهده و استعلام پرونده</div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="font-bold text-lg">پرونده {r.claimNumber}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.companyName && <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>{r.companyName}</div>}
                </div>
                <Link href="/" className="btn btn-solid btn-sm shrink-0">استعلام جدید</Link>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {r.createdAt && <Chip label="تاریخ ثبت" value={r.createdAt} />}
                {r.eventDate && <Chip label="تاریخ وقوع" value={r.eventDate} />}
                {r.payableAmount && <Chip label="مبلغ قابل پرداخت" value={`${Number(String(r.payableAmount).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال`} />}
              </div>
            </div>

            {/* Info fields grid (replaces the documents/steps table of the mockup) */}
            <div className="grid gap-3 mt-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {fields.filter(([, v]) => v).map(([l, v]) => (
                <div key={l} className="pcard p-4">
                  <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{l}</div>
                  <div className="font-bold" style={{ wordBreak: 'break-word' }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="text-center mt-6 no-print">
              <Link href="/" className="btn btn-ghost btn-sm">بازگشت به صفحهٔ اصلی</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
