'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '../components/ui';
import { BrandMark } from '../components/brand';
import { Icon } from '../components/Shell';

/**
 * مشاهده سریع و استعلام پرونده — shared pieces of the inquiry pages (/estelam and its five sub-pages).
 * The result lives in sessionStorage (put there by the landing-page inquiry), so every page reads it.
 */

export const fmtAmt = (v: any) => (v != null && String(v).trim() !== '' ? `${Number(String(v).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال` : null);
export const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);

export const ACTION_FA: Record<string, string> = {
  SUBMIT: 'ارسال مدارک', FORWARD: 'تایید و ارسال به مرحلهٔ بعد', REFER_COUNCIL: 'ارجاع به شورای فنی', PAY_ORDER: 'صدور دستور پرداخت',
  RETURN: 'عودت برای رفع نقص', RETURN_DIRECT: 'عودت برای رفع نقص', DOWN_FORWARD: 'ارسال به مرحلهٔ قبل', DOWN_DIRECT: 'ارسال به بیمه‌گزار',
  MARK_PAID: 'پرداخت خسارت', REJECT_FINAL: 'رد پرونده',
};
export const STATE_FA: Record<string, string> = {
  FORWARDED: 'تایید و ارسال', ESCALATED: 'ارجاع به سطح بالاتر', APPROVED: 'تایید شد', RETURNED_INCOMPLETE: 'عودت برای رفع نقص', REJECTED: 'رد شد', ACKED: 'دریافت و ارسال',
};

export function phaseText(r: any): string {
  if (r.status === 'PAID') return 'خسارت پرداخت شده است';
  if (r.status === 'REJECTED') return 'پرونده رد شده است';
  if (r.flowPurpose === 'PAYMENT') return 'دستور پرداخت صادر شده و پرونده در مسیر پرداخت است';
  if (r.flowDirection === 'DOWN') return 'پرونده برای رفع نقص مدارک بازگردانده شده است';
  if (r.currentStage === 'POLICYHOLDER') return 'در انتظار تکمیل و ارسال مدارک توسط بیمه‌گزار';
  return r.currentStageLabel ? `پرونده در ${r.currentStageLabel} در حال بررسی است` : 'پرونده در حال بررسی است';
}

/** The five actions under the info columns — each one is its own page. */
export const PANELS = [
  { href: '/estelam/track', label: 'پیگیری آخرین وضعیت', icon: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3' },
  { href: '/estelam/beneficiaries', label: 'ذینفع‌ها', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { href: '/estelam/online', label: 'پاسخگوی آنلاین', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  { href: '/estelam/faq', label: 'سوالات متداول', icon: 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z' },
  { href: '/estelam/contact', label: 'تماس و ارتباط', icon: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z' },
] as const;

/** Reads the inquiry result (and its short-lived token) from sessionStorage. */
export function useInquiry() {
  const [r, setR] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const s = sessionStorage.getItem('inquiryResult'); if (s) setR(JSON.parse(s));
      setToken(sessionStorage.getItem('inquiryToken'));
    } catch { /* private mode */ }
    setReady(true);
  }, []);
  return { r, token, ready };
}

/** «خروج» — forget the looked-up case in this tab and go home. */
export function useExit() {
  const router = useRouter();
  return () => {
    try { sessionStorage.removeItem('inquiryResult'); sessionStorage.removeItem('inquiryToken'); } catch { /* ignore */ }
    router.push('/');
  };
}

const EXIT_ICON = 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9';

/** White top bar, page body, footer line and the back-to-top button shared by every inquiry page. */
export function EstelamFrame({ children }: { children: (r: any, token: string | null) => ReactNode }) {
  const { r, token, ready } = useInquiry();
  const exit = useExit();
  const [showTop, setShowTop] = useState(false);
  const box = useRef<HTMLDivElement>(null); // the page scrolls inside this full-window layer
  useEffect(() => {
    const el = box.current; if (!el) return;
    const on = () => setShowTop(el.scrollTop > 300);
    on(); el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  return (
    <div className="est" ref={box}>
      <header className="est-top">
        <Link href="/" className="est-brand" aria-label="دامون">
          <BrandMark size={34} />
          <span>دامون</span>
        </Link>
        <nav className="est-links">
          <Link href="/"><Icon path="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" /> صفحه اصلی</Link>
          {r && <Link href="/estelam"><Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6" /> مشخصات پرونده</Link>}
          <button type="button" onClick={exit}><Icon path={EXIT_ICON} /> خروج</button>
        </nav>
      </header>

      <main className="est-main">
        {!ready ? (
          <div className="flex justify-center p-16"><Spinner /></div>
        ) : !r ? (
          <div className="est-card p-10 text-center space-y-4">
            <p style={{ color: 'var(--muted)' }}>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="est-btn inline-flex">استعلام جدید</Link>
          </div>
        ) : children(r, token)}

        <div className="est-card est-footer">کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>
      </main>

      {showTop && (
        <button type="button" className="est-totop" aria-label="بازگشت به بالا" onClick={() => box.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon path="M18 15l-6-6-6 6" />
        </button>
      )}
    </div>
  );
}

/** Dark heading card of a sub-page, with a way back to the case. */
export function SubHead({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="est-hero est-hero-sm">
      <div className="est-hero-title"><span className="est-hero-ico"><Icon path={icon} /></span>{title}</div>
      <Link href="/estelam" className="est-exit est-exit-ghost"><Icon path="M9 18l6-6-6-6" /> بازگشت به پرونده</Link>
    </div>
  );
}

/** One "label: value" box inside an info column. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="est-row">
      <span className="est-row-l">{label}:</span>
      <span className="est-row-v">{value ?? '—'}</span>
    </div>
  );
}

/** Info column: dark header with the orange dot, white body. */
export function InfoCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="est-col">
      <h3 className="est-col-h"><span className="est-dot" />{title}</h3>
      <div className="est-col-b">{children}</div>
    </section>
  );
}
