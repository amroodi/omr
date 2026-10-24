'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { Shell } from '../components/Shell';
import { Faq } from '../components/Faq';
import { CUSTOMER_NAV } from './nav';
import { BigIcon, CLAIM_TYPE_LABELS, ErrorBox, PanelStat, Spinner, StatusBadge } from '../components/ui';

interface MyCase {
  caseNumber: string; status: string;
  insuredName: string | null; nationalCodeMasked: string | null;
  policy: { policyNumber: string; carrier: string } | null;
  stageDate: string | null; paidAt: string | null;
  recentPayments: { date: string; amount: string; status: string }[];
}
interface MyClaim { id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null; lateNotice: boolean; needsAction: boolean; currentStageLabel?: string | null; eventDate?: string | null }

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

const IN_REVIEW = ['SUBMITTED', 'UNDER_REVIEW', 'RETURNED_INCOMPLETE', 'APPROVED', 'REVIEWING'];

// What is shown under the launcher — nothing until the user clicks a tile or a diamond.
type View = null | 'all' | 'reviewing' | 'paid' | 'action' | 'search' | 'faq';
const VIEW_TITLE: Record<Exclude<View, null>, string> = {
  all: 'همهٔ پرونده‌ها', reviewing: 'پرونده‌های در جریان بررسی', paid: 'پرونده‌های پرداخت‌شده',
  action: 'پرونده‌های نیازمند اقدام', search: 'جستجوی پرونده', faq: 'سوالات متداول',
};

/** Rotated-diamond action button on a soft plate (a link, or a button that opens a view below). */
function Diamond({ title, sub, icon, href, onClick, active, soon }: { title: string; sub: string; icon: string; href?: string; onClick?: () => void; active?: boolean; soon?: boolean }) {
  const inner = (
    <>
      <div className="pdiamond"><BigIcon path={icon} size={30} /></div>
      <div>
        <div className="pdiamond-title">{title}</div>
        <div className="pdiamond-sub">{sub}</div>
      </div>
    </>
  );
  if (soon) return <div className="pdiamond-wrap is-soon">{inner}</div>;
  if (href) return <Link href={href} className="pdiamond-wrap">{inner}</Link>;
  return <button type="button" onClick={onClick} className={`pdiamond-wrap${active ? ' is-active' : ''}`} aria-pressed={active}>{inner}</button>;
}

function ClaimRow({ c }: { c: MyClaim }) {
  return (
    <Link href={`/customer/claims/${c.id}`} className="pcard p-4 flex items-center justify-between gap-3 card-hover">
      <div className="min-w-0">
        <div className="font-bold">{c.claimNumber} <span className="font-normal" style={{ color: 'var(--muted)' }}>— {CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</span></div>
        <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          {c.deceasedName}{c.currentStageLabel ? ` · در اختیار: ${c.currentStageLabel}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {c.needsAction && <span className="badge badge-danger">نیازمند اقدام شما</span>}
        <StatusBadge status={c.status} />
      </div>
    </Link>
  );
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<MyCase[]>([]);
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MyClaim[] | null>(null);
  const [searching, setSearching] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    Promise.all([
      client.get<MyClaim[]>('/customer/claims', 'customer').then(setClaims).catch(() => {}),
      client.get<MyCase[]>('/customer/cases', 'customer').then(setCases).catch((e) => setError(e.message)),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => ({
    all: claims,
    reviewing: claims.filter((c) => IN_REVIEW.includes(c.status)),
    paid: claims.filter((c) => c.status === 'PAID'),
    action: claims.filter((c) => c.needsAction || c.status === 'RETURNED_INCOMPLETE'),
  }), [claims]);
  const legacy = useMemo(() => ({
    all: cases,
    reviewing: cases.filter((c) => IN_REVIEW.includes(c.status)),
    paid: cases.filter((c) => c.status === 'PAID'),
    action: [] as MyCase[],
  }), [cases]);
  const stats = {
    total: groups.all.length + legacy.all.length,
    reviewing: groups.reviewing.length + legacy.reviewing.length,
    paid: groups.paid.length + legacy.paid.length,
    action: groups.action.length,
  };

  const open = (v: Exclude<View, null>) => {
    setView((cur) => (cur === v ? null : v)); // a second click closes it again
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true); setError('');
    try { setFound(await client.get<MyClaim[]>(`/customer/claims?q=${encodeURIComponent(q.trim())}`, 'customer')); }
    catch (e: any) { setError(e.message); } finally { setSearching(false); }
  };

  const Tile = ({ v, label, value, icon, tone }: { v: 'all' | 'reviewing' | 'paid' | 'action'; label: string; value: number; icon: string; tone: 'navy' | 'warning' | 'success' | 'danger' }) => (
    <button type="button" onClick={() => open(v)} className={`pstat-btn${view === v ? ' is-active' : ''}`} aria-pressed={view === v} title={`نمایش ${VIEW_TITLE[v]}`}>
      <PanelStat label={label} value={fa(value)} icon={<BigIcon path={icon} />} tone={tone} unit={view === v ? 'در حال نمایش ▾' : 'برای مشاهده کلیک کنید'} />
    </button>
  );

  const listed = view && view !== 'search' && view !== 'faq' ? groups[view] : [];
  const listedCases = view && view !== 'search' && view !== 'faq' ? legacy[view] : [];

  return (
    <Shell title="پرونده‌های من" subtitle="وضعیت و سوابق پرونده‌های خسارت شما" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />

      {/* Stat tiles — each opens its list below */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Tile v="all" label="کل پرونده‌ها" value={stats.total} icon={IC.total} tone="navy" />
        <Tile v="reviewing" label="در جریان بررسی" value={stats.reviewing} icon={IC.clock} tone="warning" />
        <Tile v="paid" label="پرداخت‌شده" value={stats.paid} icon={IC.check} tone="success" />
        <Tile v="action" label="نیازمند اقدام" value={stats.action} icon={IC.alert} tone="danger" />
      </div>

      {/* Action launcher */}
      <div className="pcard p-6 mb-5">
        <div className="flex flex-wrap items-stretch justify-around gap-4">
          <Diamond href="/customer/claims/new" title="ثبت پرونده خسارت" sub="اعلام پرونده جدید" icon={IC.announce} />
          <Diamond onClick={() => open('all')} active={view === 'all'} title="پیگیری پرونده‌ها" sub="مشاهده وضعیت و مدارک" icon={IC.track} />
          <Diamond onClick={() => open('search')} active={view === 'search'} title="جستجوی پرونده" sub="با کد ملی، نام یا شماره پرونده" icon={IC.search} />
          <Diamond onClick={() => open('faq')} active={view === 'faq'} title="سوالات متداول" sub="پاسخ پرسش‌های رایج" icon={IC.faq} />
        </div>
      </div>

      {stats.action > 0 && (
        <div className="pinfobox mb-5 text-center font-bold">
          لطفا نسبت به رفع نقص یا تعیین تکلیف پرونده‌های نیازمند اقدام خود در اسرع وقت اقدام فرمایید.
        </div>
      )}

      {/* The chosen view (nothing until something is clicked) */}
      <div ref={resultsRef} className="scroll-mt-24">
        {view && (
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-extrabold">{VIEW_TITLE[view]}</h2>
            <button onClick={() => setView(null)} className="btn btn-ghost btn-sm">بستن ✕</button>
          </div>
        )}

        {view === 'faq' && <Faq />}

        {view === 'search' && (
          <div className="space-y-3">
            <div className="pcard p-4 flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[220px]" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="کد ملی متوفی، نام متوفی یا شماره پرونده" />
              <button onClick={search} disabled={searching || !q.trim()} className="btn btn-solid">{searching ? 'در حال جستجو…' : 'جستجو'}</button>
            </div>
            {found && (found.length === 0
              ? <div className="pcard p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای با این مشخصات در پرونده‌های شما یافت نشد.</div>
              : <div className="grid gap-3">{found.map((c) => <ClaimRow key={c.id} c={c} />)}</div>)}
          </div>
        )}

        {view && view !== 'faq' && view !== 'search' && (
          loading ? (
            <div className="pcard p-10 text-center"><Spinner /></div>
          ) : listed.length === 0 && listedCases.length === 0 ? (
            <div className="pcard p-8 text-center space-y-3">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{view === 'all' ? 'هنوز پرونده‌ای ندارید. برای شروع، یک پرونده خسارت ثبت کنید و سپس مدارک را بارگذاری کنید.' : 'پرونده‌ای در این دسته نیست.'}</p>
              {view === 'all' && <Link href="/customer/claims/new" className="btn btn-solid btn-solid-lg inline-flex">+ ثبت پرونده خسارت جدید</Link>}
            </div>
          ) : (
            <div className="grid gap-3">
              {listed.map((c) => <ClaimRow key={c.id} c={c} />)}
              {listedCases.map((c) => (
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
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </Shell>
  );
}
