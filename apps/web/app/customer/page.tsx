'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { Shell } from '../components/Shell';
import { Faq } from '../components/Faq';
import { CUSTOMER_NAV, POLICY_KEY, PolicyRow } from './nav';
import { BigIcon, CLAIM_TYPE_LABELS, ErrorBox, Spinner, StatusBadge } from '../components/ui';
import { caseTitle } from '../../lib/caseTitle';
import { BrokerHome } from './broker-home';

interface MyClaim { id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; deceasedName: string | null; lateNotice: boolean; needsAction: boolean; currentStageLabel?: string | null; eventDate?: string | null }
interface Dashboard {
  company: { id: string; name: string; code: string | null; hasLogo: boolean } | null;
  brokerName: string;
  contracts: PolicyRow[];
  selectedId: string | null;
  stats: { total: number; open: number; waiting: number; approvedCount: number; approvedAmount: string };
}

const fa = (n: number | string) => Number(n).toLocaleString('fa-IR');

const IC = {
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  doc: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  bubble: 'M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.9-.9L3 21l1.9-5.1A8.4 8.4 0 1121 11.5z',
  policy: 'M9 2h6l1 3h3a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h3zM9 12l2 2 4-4',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
  tray: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
  alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  mail: 'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6l-10 7L2 6',
};

type View = null | 'all' | 'action' | 'search' | 'faq' | 'intro';
const VIEW_TITLE: Record<Exclude<View, null>, string> = {
  all: 'پیگیری خسارت‌ها', action: 'پرونده‌های نیازمند اقدام', search: 'جستجوی پرونده', faq: 'سوالات متداول', intro: 'معرفی امکانات سامانه',
};

/** «۱۳/۱۰۵۷/۹۷۹ | کارگزاری … (عمر) | ۱۴۰۴/۰۹/۰۱ - ۱۴۰۵/۰۹/۰۱» — the reference portal's policy line. */
const policyLabel = (p: PolicyRow, broker: string) =>
  [p.policyNumber ?? '—', `${broker}${p.lineLabel ? ` (${p.lineLabel})` : ''}`, `${p.startDate ?? '…'} - ${p.endDate ?? '…'}`].join(' | ');

function Diamond({ title, sub, icon, href, onClick, active }: { title: string; sub: string; icon: string; href?: string; onClick?: () => void; active?: boolean }) {
  const inner = (
    <>
      <div className="pdiamond"><BigIcon path={icon} size={30} /></div>
      <div><div className="pdiamond-title">{title}</div><div className="pdiamond-sub">{sub}</div></div>
    </>
  );
  if (href) return <Link href={href} className="pdiamond-wrap">{inner}</Link>;
  return <button type="button" onClick={onClick} className={`pdiamond-wrap${active ? ' is-active' : ''}`} aria-pressed={active}>{inner}</button>;
}

function ClaimRow({ c }: { c: MyClaim }) {
  return (
    <Link href={`/customer/claims/${c.id}`} className="pcard p-4 flex items-center justify-between gap-3 card-hover">
      <div className="min-w-0">
        <div className="font-bold">{caseTitle(c)} <span className="font-normal" style={{ color: 'var(--muted)' }}>— {CLAIM_TYPE_LABELS[c.claimType] || c.claimType}</span></div>
        <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{c.deceasedName}{c.currentStageLabel ? ` · در اختیار: ${c.currentStageLabel}` : ''}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {c.needsAction && <span className="badge badge-danger">نیازمند اقدام شما</span>}
        <StatusBadge status={c.status} />
      </div>
    </Link>
  );
}

/**
 * بیمه‌گزار panel home, laid out like the insurer's reference portal: «مشخصات بیمه نامه» (pick one of
 * the company's عمر / حوادث policies of any year, with its dates and status), four summary cards for
 * that policy, the action launcher, and the standing notice.
 */
export default function CustomerHome() {
  const router = useRouter();
  const [me, setMe] = useState<{ brokerPanel?: boolean; mustChangePassword?: boolean } | null>(null);
  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ brokerPanel?: boolean; mustChangePassword?: boolean }>('/customer/me', 'customer').then(setMe).catch(() => setMe({}));
  }, [router]);
  if (!me) return <Shell title="اعلام و پیگیری خسارت عمر و حوادث" nav={CUSTOMER_NAV} realm="customer"><div className="pcard p-10 flex justify-center"><Spinner /></div></Shell>;
  return me.brokerPanel ? <BrokerHome /> : <CompanyDashboard mustChangePassword={!!me.mustChangePassword} />;
}

function CompanyDashboard({ mustChangePassword }: { mustChangePassword: boolean }) {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [policyId, setPolicyId] = useState<string>('');
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MyClaim[] | null>(null);
  const [searching, setSearching] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadDash = (id?: string) =>
    client.get<Dashboard>(`/customer/dashboard${id ? `?contractId=${encodeURIComponent(id)}` : ''}`, 'customer')
      .then((d) => { setDash(d); setPolicyId(d.selectedId ?? ''); try { if (d.selectedId) localStorage.setItem(POLICY_KEY, d.selectedId); } catch { /* ignore */ } })
      .catch((e) => setError(e.message));

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    let saved: string | undefined;
    try { saved = localStorage.getItem(POLICY_KEY) ?? undefined; } catch { /* ignore */ }
    loadDash(saved);
    client.get<MyClaim[]>('/customer/claims', 'customer').then(setClaims).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const policy = dash?.contracts.find((c) => c.id === policyId) ?? null;
  const action = useMemo(() => claims.filter((c) => c.needsAction || c.status === 'RETURNED_INCOMPLETE'), [claims]);

  const open = (v: Exclude<View, null>) => {
    setView((cur) => (cur === v ? null : v));
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const search = async () => {
    if (!q.trim()) return;
    setSearching(true); setError('');
    try { setFound(await client.get<MyClaim[]>(`/customer/claims?q=${encodeURIComponent(q.trim())}`, 'customer')); }
    catch (e: any) { setError(e.message); } finally { setSearching(false); }
  };
  const listed = view === 'all' ? claims : view === 'action' ? action : [];

  return (
    <Shell title="اعلام و پیگیری خسارت عمر و حوادث" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer"
      action={<button type="button" className="cu-intro-btn" onClick={() => open('intro')}>معرفی امکانات سامانه</button>}>
      <ErrorBox message={error} />
      {mustChangePassword && (
        <div className="alert-error mb-4 flex items-center justify-between gap-3 flex-wrap">
          <span>شما با رمز عبور پیش‌فرض وارد شده‌اید؛ برای امنیت حساب، همین حالا رمز عبور خود را تغییر دهید.</span>
          <Link href="/customer/password" className="cu-more">تغییر کلمه عبور</Link>
        </div>
      )}
      {!dash ? <div className="pcard p-10 flex justify-center"><Spinner /></div> : (
        <div className="space-y-5">
          {/* مشخصات بیمه نامه */}
          <section className="pcard cu-spec">
            <h2 className="cu-spec-h"><span>مشخصات بیمه نامه</span></h2>
            <p className="cu-spec-note">
              بیمه‌نامهٔ مورد نظر را انتخاب کنید؛ بیمه‌نامه‌های عمر و حوادث همهٔ سال‌ها در این فهرست هستند. اگر بیمه‌نامهٔ خود را نمی‌بینید، با {dash.brokerName} تماس بگیرید.
            </p>
            {dash.contracts.length === 0 ? (
              <div className="alert-error">برای شرکت شما هنوز بیمه‌نامه‌ای ثبت نشده است؛ لطفاً با کارگزاری تماس بگیرید.</div>
            ) : (
              <div className="cu-spec-row">
                <label className="cu-select">
                  <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.policy} size={24} /></span>
                  <select value={policyId} onChange={(e) => { setPolicyId(e.target.value); loadDash(e.target.value); }} aria-label="بیمه‌نامه">
                    {dash.contracts.map((p) => <option key={p.id} value={p.id}>{policyLabel(p, dash.brokerName)}</option>)}
                  </select>
                </label>
                {policy && (
                  <div className="cu-spec-facts">
                    <span><span style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.cal} size={20} /></span> تاریخ شروع: {policy.startDate ?? '—'}</span>
                    <span><span style={{ color: 'var(--danger)' }}><BigIcon path={IC.cal} size={20} /></span> تاریخ پایان: {policy.endDate ?? '—'}</span>
                    <span><i className={`cu-dot${policy.inForce ? ' is-on' : ''}`} /> وضعیت: {policy.inForce ? 'فعال' : 'پایان یافته'}</span>
                  </div>
                )}
              </div>
            )}
            <div className="cu-select is-static">
              <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.user} size={24} /></span>
              <span className="truncate">{dash.company?.name ?? '—'}{dash.company?.code ? ` — کد بیمه‌گزار ${dash.company.code}` : ''}</span>
            </div>
          </section>

          {/* Four summary cards for the chosen policy */}
          <div className="cu-cards">
            <div className="pcard cu-card">
              <div><div className="cu-card-t">بیمه‌گزار</div><div className="cu-card-v">{dash.company?.name ?? '—'}</div>
                <div className="cu-card-k">کد بیمه‌گزار</div><div className="cu-card-s latin-digits">{dash.company?.code ?? '—'}</div>
                <div className="cu-card-k">کارگزار</div><div className="cu-card-s">{dash.brokerName}</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.user} size={52} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">بیمه نامه {policy && <span className={`cu-tag${policy.inForce ? ' is-on' : ''}`}>[{policy.inForce ? 'فعال' : 'پایان یافته'}]</span>}</div>
                <div className="cu-card-k">شماره</div><div className="cu-card-v latin-digits">{policy?.policyNumber ?? '—'}</div>
                <div className="cu-card-k">رشته / بیمه‌گر</div><div className="cu-card-s">{policy ? `${policy.lineLabel ?? '—'} — ${policy.insurerName}` : '—'}</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.doc} size={52} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">جمع مبالغ تایید شده</div><div className="cu-card-v">{fa(dash.stats.approvedAmount)}</div><div className="cu-card-s">ریال</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.check} size={52} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">تعداد خسارات تایید شده</div><div className="cu-card-v">{fa(dash.stats.approvedCount)}</div>
                <div className="cu-card-s">از {fa(dash.stats.total)} پرونده — {fa(dash.stats.open)} در جریان</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.bubble} size={52} /></span>
            </div>
          </div>

          {/* Action launcher */}
          <div className="pcard p-6">
            <div className="flex flex-wrap items-stretch justify-around gap-4">
              <Diamond href={`/customer/claims/new${policyId ? `?policy=${policyId}` : ''}`} title="اعلام خسارت" sub="ثبت پروندهٔ خسارت جدید" icon={IC.clip} />
              <Diamond href="/customer/claims" title="پیگیری خسارت" sub="مشاهدهٔ جزئیات پرونده‌های اعلام‌شده" icon={IC.tray} />
              <Diamond onClick={() => open('action')} active={view === 'action'} title="نیازمند اقدام" sub={action.length ? `${fa(action.length)} پرونده منتظر شماست` : 'رفع نقص مدارک'} icon={IC.alert} />
              <Diamond onClick={() => open('search')} active={view === 'search'} title="جستجوی پرونده" sub="با کد ملی، نام یا شماره پرونده" icon={IC.search} />
              <Diamond onClick={() => open('faq')} active={view === 'faq'} title="سوالات متداول" sub="پاسخ پرسش‌های رایج" icon={IC.mail} />
            </div>
          </div>

          <div className="pcard p-6">
            <div className="cu-notice">
              لطفاً نسبت به تعیین تکلیف پرونده‌های نیازمند اقدام، ظرف مدت حداکثر یک ماه اقدام فرمایید<br />( رفع نقص مدارک یا انصراف از درخواست )
            </div>

            <div ref={resultsRef} className="scroll-mt-24">
              {view && (
                <div className="flex items-center justify-between mt-5 mb-3">
                  <h2 className="font-extrabold">{VIEW_TITLE[view]}</h2>
                  <button onClick={() => setView(null)} className="btn btn-ghost btn-sm">بستن ✕</button>
                </div>
              )}
              {view === 'intro' && (
                <ul className="cu-intro">
                  <li><b>مشخصات بیمه نامه:</b> بیمه‌نامه‌های عمر و حوادث شرکت را برای هر سال انتخاب کنید و خلاصهٔ خسارت‌های همان بیمه‌نامه را ببینید.</li>
                  <li><b>اعلام خسارت:</b> پروندهٔ فوت یا حادثهٔ یکی از کارکنان را ثبت و مدارک مورد نیاز را بارگذاری کنید.</li>
                  <li><b>پیگیری خسارت:</b> هر پرونده را تا پرداخت دنبال کنید؛ تایید یا رد هر مدرک در کارگزاری، شعبه و ستاد را می‌بینید.</li>
                  <li><b>نیازمند اقدام:</b> پرونده‌هایی که نقص مدرک دارند و باید مدرک صحیح را جایگزین کنید.</li>
                </ul>
              )}
              {view === 'faq' && <Faq />}
              {view === 'search' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <input className="input flex-1 min-w-[220px]" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="کد ملی متوفی، نام متوفی یا شماره پرونده" />
                    <button onClick={search} disabled={searching || !q.trim()} className="btn btn-solid">{searching ? 'در حال جستجو…' : 'جستجو'}</button>
                  </div>
                  {found && (found.length === 0
                    ? <div className="text-center text-sm py-4" style={{ color: 'var(--muted)' }}>پرونده‌ای با این مشخصات در پرونده‌های شما یافت نشد.</div>
                    : <div className="grid gap-3">{found.map((c) => <ClaimRow key={c.id} c={c} />)}</div>)}
                </div>
              )}
              {(view === 'all' || view === 'action') && (listed.length === 0 ? (
                <div className="text-center space-y-3 py-4">
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>{view === 'all' ? 'هنوز پرونده‌ای ثبت نکرده‌اید.' : 'پرونده‌ای منتظر اقدام شما نیست.'}</p>
                  {view === 'all' && <Link href="/customer/claims/new" className="btn btn-solid inline-flex">+ اعلام خسارت</Link>}
                </div>
              ) : <div className="grid gap-3">{listed.map((c) => <ClaimRow key={c.id} c={c} />)}</div>)}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
