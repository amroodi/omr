'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { Shell } from '../components/Shell';
import { CUSTOMER_NAV } from './nav';
import { BigIcon, CLAIM_TYPE_LABELS, ClaimTypeBadge, ErrorBox, PanelStat, StatusBadge } from '../components/ui';

interface MyCase {
  caseNumber: string; status: string;
  insuredName: string | null; nationalCodeMasked: string | null;
  policy: { policyNumber: string; carrier: string } | null;
  stageDate: string | null; paidAt: string | null;
  recentPayments: { date: string; amount: string; status: string }[];
}
interface MyClaim { id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null; lateNotice: boolean; needsAction: boolean }

const fa = (n: number) => n.toLocaleString('fa-IR');

const IC = {
  total: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  clock: 'M12 6v6l4 2M12 22a10 10 0 100-20 10 10 0 000 20z',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  announce: 'M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8l-9 6-9-6z',
  track: 'M5 5h14l3 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6l3-7zM2 12h6l2 3h4l2-3h6',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  faq: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
};

/** Rotated-diamond action launcher (link when enabled, muted «به زودی» otherwise). */
function Diamond({ title, sub, icon, href, soon }: { title: string; sub: string; icon: string; href?: string; soon?: boolean }) {
  const inner = (
    <>
      <div className="pdiamond"><BigIcon path={icon} size={30} /></div>
      <div>
        <div className="pdiamond-title">{title}</div>
        <div className="pdiamond-sub">{sub}</div>
      </div>
    </>
  );
  if (soon || !href) return <div className="pdiamond-wrap is-soon">{inner}</div>;
  if (href.startsWith('#') || href === '/') return <a href={href} className="pdiamond-wrap">{inner}</a>;
  return <Link href={href} className="pdiamond-wrap">{inner}</Link>;
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<MyCase[]>([]);
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    Promise.all([
      client.get<MyClaim[]>('/customer/claims', 'customer').then(setClaims).catch(() => {}),
      client.get<MyCase[]>('/customer/cases', 'customer').then(setCases).catch((e) => setError(e.message)),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const inReview = ['SUBMITTED', 'UNDER_REVIEW', 'RETURNED_INCOMPLETE', 'APPROVED', 'REVIEWING'];
    const reviewing = claims.filter((c) => inReview.includes(c.status)).length + cases.filter((c) => inReview.includes(c.status)).length;
    const paid = claims.filter((c) => c.status === 'PAID').length + cases.filter((c) => c.status === 'PAID').length;
    const action = claims.filter((c) => c.needsAction || c.status === 'RETURNED_INCOMPLETE').length;
    return { total: claims.length + cases.length, reviewing, paid, action };
  }, [claims, cases]);

  return (
    <Shell title="پرونده‌های من" subtitle="وضعیت و سوابق پرونده‌های خسارت شما" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <PanelStat label="کل پرونده‌ها" value={fa(stats.total)} icon={<BigIcon path={IC.total} />} tone="navy" />
        <PanelStat label="در جریان بررسی" value={fa(stats.reviewing)} icon={<BigIcon path={IC.clock} />} tone="warning" />
        <PanelStat label="پرداخت‌شده" value={fa(stats.paid)} icon={<BigIcon path={IC.check} />} tone="success" />
        <PanelStat label="نیازمند اقدام" value={fa(stats.action)} icon={<BigIcon path={IC.alert} />} tone="danger" />
      </div>

      {/* Action launcher (rotated diamonds, mirrors the reference main page) */}
      <div className="pcard p-6 mb-5">
        <div className="flex flex-wrap items-start justify-around gap-x-6 gap-y-8">
          <Diamond href="/customer/claims/new" title="ثبت پرونده خسارت" sub="اعلام پرونده جدید" icon={IC.announce} />
          <Diamond href="#claims" title="پیگیری پرونده‌ها" sub="مشاهده وضعیت و مدارک" icon={IC.track} />
          <Diamond href="/" title="استعلام سریع" sub="استعلام بدون ورود" icon={IC.search} />
          <Diamond soon title="سوالات متداول" sub="به زودی" icon={IC.faq} />
        </div>
      </div>

      {/* Info banner */}
      {stats.action > 0 && (
        <div className="pinfobox mb-5 text-center font-bold">
          لطفا نسبت به رفع نقص یا تعیین تکلیف پرونده‌های نیازمند اقدام خود در اسرع وقت اقدام فرمایید.
        </div>
      )}

      {/* Claims + cases list */}
      <div id="claims" className="scroll-mt-24">
        <h2 className="font-extrabold mb-3">پرونده‌های خسارت</h2>
        {loading ? (
          <div className="pcard p-10 text-center"><span className="pspinner inline-block" /></div>
        ) : claims.length === 0 && cases.length === 0 ? (
          <div className="pcard p-10 text-center space-y-3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>هنوز پرونده‌ای ندارید. برای شروع، یک پرونده خسارت ثبت کنید و سپس مدارک را بارگذاری کنید.</p>
            <Link href="/customer/claims/new" className="btn btn-solid btn-solid-lg inline-flex">+ ثبت پرونده خسارت جدید</Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {claims.map((c) => (
              <Link key={c.id} href={`/customer/claims/${c.id}`} className="pcard p-4 flex items-center justify-between card-hover">
                <div className="min-w-0">
                  <div className="font-bold">{c.claimNumber} <span className="font-normal" style={{ color: 'var(--muted)' }}>— {CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</span></div>
                  <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{c.deceasedName}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.status === 'RETURNED_INCOMPLETE' && <span className="badge badge-danger">نیازمند رفع نقص</span>}
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            ))}
            {cases.map((c) => (
              <div key={c.caseNumber} className="pcard p-5">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-bold">پرونده {c.caseNumber}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="text-sm space-y-1" style={{ color: 'var(--muted)' }}>
                  <div>{c.insuredName} — <span style={{ direction: 'ltr' }}>{c.nationalCodeMasked}</span></div>
                  {c.policy && <div>بیمه‌نامه {c.policy.policyNumber} · {c.policy.carrier}</div>}
                  {c.stageDate && <div>آخرین مرحله: {c.stageDate}</div>}
                </div>
                {c.recentPayments.length > 0 && (
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>پرداخت‌های اخیر</div>
                    {c.recentPayments.map((p, i) => (
                      <div key={i} className="flex justify-between text-sm py-0.5">
                        <span>{p.date}</span><span className="font-semibold">{p.amount}</span><StatusBadge status={p.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
