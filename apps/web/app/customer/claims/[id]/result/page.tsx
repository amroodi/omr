'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon, Shell } from '../../../../components/Shell';
import { CUSTOMER_NAV } from '../../../nav';

interface Result { ok: boolean; reason?: string; items?: string[] }

/**
 * Outcome of «ثبت نهایی»: a big green check with «ثبت مدارک با موفقیت انجام شد», or a big red ✕ with the
 * reason in Persian (and which documents are missing or rejected). The page set the result before coming here.
 */
export default function SubmitResult() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Result | null | undefined>(undefined);
  useEffect(() => {
    try { const s = sessionStorage.getItem(`submitResult:${id}`); setR(s ? JSON.parse(s) : null); } catch { setR(null); }
  }, [id]);

  return (
    <Shell title="ثبت نهایی مدارک" breadcrumb="ثبت نهایی مدارک" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <div className="pcard cu-result max-w-2xl mx-auto">
        {r === undefined ? null : r === null ? (
          <p className="text-center" style={{ color: 'var(--muted)' }}>نتیجه‌ای برای نمایش وجود ندارد.</p>
        ) : r.ok ? (
          <>
            <span className="cu-big is-ok" aria-hidden><Icon path="M20 6L9 17l-5-5" /></span>
            <h2 className="cu-result-t">ثبت مدارک با موفقیت انجام شد</h2>
            <p className="cu-result-p">پرونده برای بررسی به کارگزاری ارسال شد. روند بررسی را می‌توانید از «روند پرونده» پیگیری کنید؛ اگر مدرکی نیاز به اصلاح داشته باشد به شما اطلاع داده می‌شود.</p>
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
          <Link href={`/customer/claims/${id}`} className="cs-btn-back"><Icon path="M9 18l6-6-6-6" /> بازگشت</Link>
          <Link href="/customer" className="cs-btn-exit"><Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج</Link>
        </div>
      </div>
    </Shell>
  );
}
