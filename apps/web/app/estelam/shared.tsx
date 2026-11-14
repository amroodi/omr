'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '../components/ui';
import { BrandMark } from '../components/brand';
import { Icon } from '../components/Shell';
import { InquiryCase, inquiryApi, pickedClaim } from '../../lib/api';
import { CaseNo, notesTone } from '../components/case-ui';

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

/**
 * Colour of «توضیحات پرونده»: green = paid (or the payment order is out), red = rejected or waiting for
 * missing documents, yellow = still being processed. The organization's own note wins when it says so.
 */
export function phaseTone(r: any, text: string): 'ok' | 'wait' | 'bad' {
  if (r.status === 'PAID') return 'ok';
  if (r.status === 'REJECTED') return 'bad';
  const t = notesTone(text);
  if (t !== 'other') return t;
  if (r.flowPurpose === 'PAYMENT') return 'ok';
  if (r.flowDirection === 'DOWN' || r.status === 'RETURNED_INCOMPLETE') return 'bad';
  return 'wait';
}

export function phaseText(r: any): string {
  if (r.status === 'PAID') return 'خسارت پرداخت شده است';
  if (r.status === 'REJECTED') return 'پرونده رد شده است';
  if (r.flowPurpose === 'PAYMENT') return 'دستور پرداخت صادر شده و پرونده در مسیر پرداخت است';
  if (r.flowDirection === 'DOWN') return 'پرونده برای رفع نقص مدارک بازگردانده شده است';
  if (r.currentStage === 'POLICYHOLDER') return 'در انتظار تکمیل و ارسال مدارک توسط بیمه‌گزار';
  return r.currentStageLabel ? `پرونده در ${r.currentStageLabel} در حال بررسی است` : 'پرونده در حال بررسی است';
}

/** The five actions under the info columns — each one is its own page (the panel has no side menu). */
export const PANELS = [
  { href: '/estelam/process', label: 'وضعیت پرونده', sub: 'مراحل رسیدگی پرونده', icon: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3' },
  { href: '/estelam/documents', label: 'آخرین وضعیت مدارک', sub: 'مدارک ارسال‌شده و نواقص', icon: 'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7zM13 2v7h7M9 15l2 2 4-4' },
  { href: '/estelam/beneficiaries', label: 'ذینفع‌ها', sub: 'گیرندگان خسارت', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { href: '/estelam/online', label: 'پاسخگوی آنلاین', sub: 'پشتیبانی پرونده', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  { href: '/estelam/faq', label: 'سوالات متداول', sub: 'پرسش‌های رایج', icon: 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z' },
] as const;

/** «اعلام خسارت»: a بیمه‌شده files a case (on only where Super Admin turned it on, with فن‌آوران). */
export const NOTICE = { href: '/estelam/notice', label: 'اعلام خسارت', sub: 'ثبت پرونده خسارت', icon: 'M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5' };

/** The action tiles, Sinad-style: icon in a diamond, title, one line under it; a tile that can't be used is grey. */
export function EstelamTiles({ r }: { r: any }) {
  const tiles = [{ ...NOTICE, off: !r?.selfFiling }, ...PANELS.map((p) => ({ ...p, off: !!r?.selfEntry }))];
  return (
    <div className="sn-box est-tiles">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="est-tile-ico"><Icon path={t.icon} /></span>
            <span className="est-tile-t">{t.label}</span>
            <span className="est-tile-s">{t.sub}</span>
          </>
        );
        return t.off
          ? <span key={t.href} className="est-tile is-off" aria-disabled="true">{body}</span>
          : <Link key={t.href} href={t.href} className="est-tile">{body}</Link>;
      })}
    </div>
  );
}

/** Was this panel-3 visit a کد ملی + password login (its token names the کد ملی)? */
export function passwordLogin(token: string | null): boolean {
  if (!token) return false;
  try { return !!JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).nh; } catch { return false; }
}

/** «تماس و ارتباط» — in the top bar (not among the buttons). */
export const CONTACT = { href: '/estelam/contact', label: 'تماس و ارتباط', icon: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z' };

/**
 * The inquiry result: shown at once from sessionStorage, then re-read from the server while the
 * inquiry token is still valid, so the page always shows current data (never a copy saved earlier).
 */
export function useInquiry() {
  const [r, setR] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Every case the looked-up کد ملی covers (a main insured's family, each نوع بیمه‌نامه its own case).
  const [cases, setCases] = useState<InquiryCase[]>([]);
  const load = (t: string, id: string | null) => inquiryApi.getCase(t, id).then((fresh) => {
    setR(fresh);
    try { sessionStorage.setItem('inquiryResult', JSON.stringify(fresh)); } catch { /* ignore */ }
  });
  useEffect(() => {
    let t: string | null = null;
    try {
      const s = sessionStorage.getItem('inquiryResult'); if (s) setR(JSON.parse(s));
      t = sessionStorage.getItem('inquiryToken'); setToken(t);
    } catch { /* private mode */ }
    setReady(true);
    if (t) {
      load(t, pickedClaim()).catch(() => { /* token expired: keep what we have */ });
      inquiryApi.listCases(t).then(setCases).catch(() => setCases([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Show another of the looked-up cases (every inquiry page follows it). */
  const pick = (id: string) => {
    try { sessionStorage.setItem('inquiryClaimId', id); } catch { /* ignore */ }
    if (token) load(token, id).catch(() => {});
  };
  return { r, token, ready, cases, pick };
}

/** «خروج» — forget the looked-up case in this tab and go home. */
export function useExit() {
  const router = useRouter();
  return () => {
    try { sessionStorage.removeItem('inquiryResult'); sessionStorage.removeItem('inquiryToken'); sessionStorage.removeItem('inquiryClaimId'); } catch { /* ignore */ }
    router.push('/');
  };
}

const EXIT_ICON = 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9';

/** The inquiry panel's side menu: every page of the looked-up case. */
export const SIDE_MENU = [
  { href: '/estelam', label: 'مشخصات پرونده', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6' },
  { href: '/estelam/process', label: 'وضعیت پرونده', icon: PANELS[0].icon },
  { href: '/estelam/documents', label: 'آخرین وضعیت مدارک', icon: PANELS[1].icon },
  { href: '/estelam/online', label: 'گفتگو', icon: PANELS[3].icon },
  { href: '/estelam/beneficiaries', label: PANELS[2].label, icon: PANELS[2].icon },
  { href: '/estelam/faq', label: PANELS[4].label, icon: PANELS[4].icon },
  { href: CONTACT.href, label: CONTACT.label, icon: CONTACT.icon },
] as const;

/** Side menu of the inquiry panel (right side; a scrolling strip on phones). */
export function EstelamSide({ r }: { r: any }) {
  const path = usePathname();
  const exit = useExit();
  const nav = useRef<HTMLElement>(null);
  // On phones the menu is a scrolling strip: bring the current page's item into view.
  useEffect(() => { nav.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [path]);
  return (
    <aside className="est-side" aria-label="منوی پرونده">
      <div className="est-side-head">
        <span className="est-side-k">پرونده</span>
        {/* The person first; the number in its parts (year — policy — row) */}
        {r?.deceasedName && <span className="est-side-v">{r.deceasedName}</span>}
        <span className="est-side-n"><CaseNo n={r?.claimNumber || r?.caseNumber} /></span>
      </div>
      <nav className="est-side-nav" ref={nav}>
        {SIDE_MENU.map((m) => (
          <Link key={m.href} href={m.href} className={path === m.href ? 'is-active' : undefined} aria-current={path === m.href ? 'page' : undefined}>
            <Icon path={m.icon} /> {m.label}
          </Link>
        ))}
        <button type="button" onClick={exit} className="est-side-exit"><Icon path={EXIT_ICON} /> خروج</button>
      </nav>
    </aside>
  );
}

/** White top bar, page body, footer line and the back-to-top button shared by every inquiry page. */
export interface FrameCtx { cases: InquiryCase[]; pick: (id: string) => void }

/** The title in the top bar for each page (Sinad shows the current view's name there). */
const TITLES: Record<string, string> = {
  '/estelam': 'مشاهده و پیگیری پرونده خسارت', '/estelam/notice': 'اعلام خسارت', '/estelam/contact': 'تماس و ارتباط', '/estelam/password': 'تغییر رمز عبور',
};

export function EstelamFrame({ children }: { children: (r: any, token: string | null, ctx: FrameCtx) => ReactNode }) {
  const { r, token, ready, cases, pick } = useInquiry();
  const exit = useExit();
  const path = usePathname();
  const [showTop, setShowTop] = useState(false);
  const [open, setOpen] = useState(false); // Sinad's side menu: an icon strip until it is opened
  const box = useRef<HTMLDivElement>(null); // the page scrolls inside this full-window layer
  useEffect(() => {
    const el = box.current; if (!el) return;
    const on = () => setShowTop(el.scrollTop > 300);
    on(); el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  // Always light, like Sinad: the app's dark theme is set aside while panel 3 is open.
  useEffect(() => {
    const root = document.documentElement;
    const dark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => { if (dark) root.classList.add('dark'); };
  }, []);
  const noCase = !!r?.selfEntry;
  const items = [
    { href: '/estelam', label: 'مشخصات پرونده', icon: 'M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z', off: false },
    { href: NOTICE.href, label: NOTICE.label, icon: NOTICE.icon, off: !r?.selfFiling },
    ...PANELS.map((p) => ({ href: p.href as string, label: p.label as string, icon: p.icon as string, off: noCase })),
    { href: CONTACT.href, label: CONTACT.label, icon: CONTACT.icon, off: false },
    ...(passwordLogin(token) ? [{ href: '/estelam/password', label: 'تغییر رمز عبور', icon: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4', off: false }] : []),
  ];
  const title = TITLES[path] ?? PANELS.find((p) => p.href === path)?.label ?? TITLES['/estelam'];

  return (
    <div className={`est est-sn${open ? ' is-open' : ''}`} ref={box}>
      <div className="sn-side" aria-label="منوی پنل">
        <div className="sn-side-head">
          <Link href="/" className="sn-logo" aria-label="دامون"><BrandMark size={open ? 70 : 36} bare /></Link>
          {open && <div className="sn-side-org">کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>}
        </div>
        <button type="button" className="sn-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'بستن منو' : 'باز کردن منو'}>
          <Icon path={open ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />{open && <span>بستن منو</span>}
        </button>
        {r && items.map((m) => (m.off
          ? <span key={m.href} className="sn-row is-off" title={m.label}><Icon path={m.icon} />{open && <span>{m.label}</span>}</span>
          : <Link key={m.href} href={m.href} title={m.label} className={`sn-row${path === m.href ? ' is-active' : ''}`}><Icon path={m.icon} />{open && <span>{m.label}</span>}</Link>))}
        <button type="button" className="sn-row sn-exit" onClick={exit} title="خروج"><Icon path={EXIT_ICON} />{open && <span>خروج</span>}</button>
      </div>
      {open && <div className="sn-scrim" onClick={() => setOpen(false)} />}

      <div className="sn-head">
        <h1>{title}</h1>
        {r && <Link href={CONTACT.href} className="sn-head-btn">{CONTACT.label}</Link>}
      </div>

      <div className="sn-page">
        {!ready ? (
          <div className="flex justify-center p-16"><Spinner /></div>
        ) : !r ? (
          <div className="sn-box text-center space-y-4">
            <p>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="sn-btn">استعلام جدید</Link>
          </div>
        ) : children(r, token, { cases, pick })}
        <div className="sn-foot">امور مشتریان کارگزاری دامون: <bdi>۰۲۱-۵۷۳۸۹۰۰۰</bdi></div>
      </div>

      {showTop && (
        <button type="button" className="est-totop" aria-label="بازگشت به بالا" onClick={() => box.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon path="M18 15l-6-6-6 6" />
        </button>
      )}
    </div>
  );
}


/** Dark heading card of a sub-page, with a way back to the case. */
export function SubHead({ title }: { title: string; icon?: string }) {
  return (
    <div className="sn-box sn-subhead">
      <div className="sn-boxhead"><h3>{title}</h3><hr /><Link href="/estelam" className="sn-back">بازگشت به پرونده</Link></div>
    </div>
  );
}

/** One "label: value" box inside an info column. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="est-row">
      <span className="est-row-l">{label}:</span>
      <span className="est-row-v">{value == null || value === '' ? 'ندارد' : value}</span>
    </div>
  );
}

/** Info column: dark header with the orange dot, white body. */
export function InfoCol({ title, icon, children }: { title: string; icon?: string; children: ReactNode }) {
  return (
    <section className="sn-box sn-card">
      <h4>{title}</h4>
      {icon && <span className="sn-card-ico"><Icon path={icon} /></span>}
      <div className="sn-card-b">{children}</div>
    </section>
  );
}
