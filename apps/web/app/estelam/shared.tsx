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
    <div className="est-tiles">
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
export function EstelamFrame({ children }: { children: (r: any, token: string | null) => ReactNode }) {
  const { r, token, ready, cases, pick } = useInquiry();
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
          {r && <Link href={CONTACT.href}><Icon path={CONTACT.icon} /> {CONTACT.label}</Link>}
          {r && passwordLogin(token) && <Link href="/estelam/password"><Icon path="M5 11h14v10H5zM8 11V7a4 4 0 018 0v4" /> تغییر رمز عبور</Link>}
          <button type="button" onClick={exit}><Icon path={EXIT_ICON} /> خروج</button>
        </nav>
      </header>

      <div>
      <main className="est-main">
        {!ready ? (
          <div className="flex justify-center p-16"><Spinner /></div>
        ) : !r ? (
          <div className="est-card p-10 text-center space-y-4">
            <p style={{ color: 'var(--muted)' }}>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="est-btn inline-flex">استعلام جدید</Link>
          </div>
        ) : (
          <>
            {cases.length > 1 && <CasePicker cases={cases} current={r?.id} onPick={pick} />}
            {children(r, token)}
          </>
        )}

        <div className="est-card est-footer">کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>
      </main>
      </div>

      {showTop && (
        <button type="button" className="est-totop" aria-label="بازگشت به بالا" onClick={() => box.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon path="M18 15l-6-6-6 6" />
        </button>
      )}
    </div>
  );
}

/**
 * The looked-up کد ملی covers several cases: a main insured's own (one per نوع بیمه‌نامه — a death in an
 * accident may have a عمر and a حوادث case) and their dependents'. Pick which one the pages show.
 */
function CasePicker({ cases, current, onPick }: { cases: InquiryCase[]; current?: string; onPick: (id: string) => void }) {
  return (
    <div className="est-card est-cases">
      <div className="est-cases-h">پرونده‌های این کد ملی ({cases.length.toLocaleString('fa-IR')})</div>
      <div className="est-cases-list">
        {cases.map((c) => (
          <button key={c.id} type="button" className={c.id === current ? 'is-on' : undefined} onClick={() => onPick(c.id)} aria-pressed={c.id === current}>
            <b>{c.name || '—'}</b>
            <span>{c.relation}{c.line ? ` — ${c.line}` : ''}</span>
            <span>{c.claimType}{c.eventDate ? ` — ${c.eventDate}` : ''}</span>
            <span><CaseNo n={c.claimNumber} /></span>
          </button>
        ))}
      </div>
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
      <span className="est-row-v">{value == null || value === '' ? 'ندارد' : value}</span>
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
