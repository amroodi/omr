'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon, Shell } from './Shell';
import { CUSTOMER_NAV } from '../customer/nav';
import { ORG_NAV } from '../org/nav';

/** What the case page leaves for this page (sessionStorage `submitResult:<id>`). */
export interface SubmitOutcome { ok: boolean; reason?: string; items?: string[]; receiptCode?: string | null; claimNumber?: string | null; sentTo?: string | null }
export const RESULT_KEY = (id: string) => `submitResult:${id}`;

const faDigits = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/**
 * Outcome of «ثبت نهایی» on every panel 1 (بیمه‌گزار / نماینده and the organizations' own staff): a big green
 * check with the case's «کد پذیرش» to follow it up by, or a big red ✕ with the reason in Persian (and which
 * documents are missing or rejected). The case page set the outcome before coming here.
 */
export function SubmitResult({ realm }: { realm: 'customer' | 'org' }) {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<SubmitOutcome | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    try { const s = sessionStorage.getItem(RESULT_KEY(id)); setR(s ? JSON.parse(s) : null); } catch { setR(null); }
  }, [id]);
  const base = realm === 'org' ? `/org/claims/${id}` : `/customer/claims/${id}`;
  const list = realm === 'org' ? '/org/entry/claims' : '/customer/claims';
  const copy = (code: string) => { navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {}); };

  return (
    <Shell title="ثبت نهایی مدارک" breadcrumb="ثبت نهایی مدارک" sectionLabel="خسارت عمر و حادثه" nav={realm === 'org' ? ORG_NAV : CUSTOMER_NAV} realm={realm}>
      <div className="pcard cu-result max-w-2xl mx-auto">
        {r === undefined ? null : r === null ? (
          <p className="text-center" style={{ color: 'var(--muted)' }}>نتیجه‌ای برای نمایش وجود ندارد.</p>
        ) : r.ok ? (
          <>
            <span className="cu-big is-ok" aria-hidden><Icon path="M20 6L9 17l-5-5" /></span>
            <h2 className="cu-result-t">ثبت مدارک با موفقیت انجام شد</h2>
            {r.receiptCode && (
              <div className="cu-receipt">
                <span className="cu-receipt-l">کد پذیرش</span>
                <bdi className="cu-receipt-v">{faDigits(r.receiptCode)}</bdi>
                <button type="button" className="cu-view" onClick={() => copy(r.receiptCode!)}>{copied ? 'کپی شد' : 'کپی'}</button>
              </div>
            )}
            {r.claimNumber && <p className="text-sm" style={{ color: 'var(--muted)' }}>شماره پرونده: <bdi>{r.claimNumber}</bdi></p>}
            <p className="cu-result-p">
              پرونده برای بررسی به {r.sentTo || 'مرحلهٔ بعد'} ارسال شد. این کد پذیرش را نگه دارید؛ با آن می‌توانید پرونده را در «پیگیری خسارت» پیدا کنید و روند بررسی را از «روند پرونده» دنبال کنید. اگر مدرکی نیاز به اصلاح داشته باشد به شما اطلاع داده می‌شود.
            </p>
          </>
        ) : (
          <>
            <span className="cu-big is-no" aria-hidden><Icon path="M18 6L6 18M6 6l12 12" /></span>
            <h2 className="cu-result-t">ثبت مدارک انجام نشد</h2>
            <p className="cu-result-p">{r.reason || 'خطایی رخ داد؛ لطفاً دوباره تلاش کنید.'}</p>
            {r.items && r.items.length > 0 && <ul className="cu-result-list">{r.items.map((x) => <li key={x}>{x}</li>)}</ul>}
          </>
        )}
        <div className="cu-result-btns">
          <Link href={base} className="cs-btn-back"><Icon path="M9 18l6-6-6-6" /> مرحله قبل</Link>
          {r?.ok
            ? <Link href={list} className="cs-btn-back">پیگیری خسارت <Icon path="M15 18l-6-6 6-6" /></Link>
            : <Link href={`${base}/workflow`} className="cs-btn-back">مرحله بعد <Icon path="M15 18l-6-6 6-6" /></Link>}
        </div>
      </div>
    </Shell>
  );
}
