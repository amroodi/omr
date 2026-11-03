'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { Shell } from '../components/Shell';
import { Faq } from '../components/Faq';
import { CUSTOMER_NAV, POLICY_KEY, PolicyRow } from './nav';
import { BigIcon, ErrorBox, Spinner } from '../components/ui';
import { CaseTable, MyClaim } from './case-table';
import { Diamond, IC } from './launcher';

interface Dashboard {
  company: { id: string; name: string; code: string | null; hasLogo: boolean } | null;
  brokerName: string;
  agent?: boolean; // an insurer's نماینده بیمه: brokerName is the insurer
  contracts: PolicyRow[];
  selectedId: string | null;
  stats: { total: number; open: number; waiting: number; approvedCount: number; paidAmount: string };
}

const fa = (n: number | string) => Number(n).toLocaleString('fa-IR');

type View = null | 'search' | 'faq' | 'intro';
const VIEW_TITLE: Record<Exclude<View, null>, string> = {
  search: 'جستجوی پرونده', faq: 'سوالات متداول', intro: 'معرفی امکانات سامانه',
};

/** «۱۳/۱۰۵۷/۹۷۹ | کارگزاری … (عمر) | ۱۴۰۴/۰۹/۰۱ - ۱۴۰۵/۰۹/۰۱» — the reference portal's policy line. */
const policyLabel = (p: PolicyRow, broker: string) =>
  [p.policyNumber ?? '—', `${broker}${p.lineLabel ? ` (${p.lineLabel})` : ''}`, `${p.startDate ?? '…'} - ${p.endDate ?? '…'}`].join(' | ');

/**
 * بیمه‌گزار panel home, laid out like the insurer's reference portal: «مشخصات بیمه نامه» (pick one of
 * the company's عمر / حوادث policies of any year, with its dates and status), four summary cards for
 * that policy, the action launcher, and the standing notice.
 */
export default function CustomerHome() {
  const router = useRouter();
  const [me, setMe] = useState<{ mustChangePassword?: boolean } | null>(null);
  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ mustChangePassword?: boolean }>('/customer/me', 'customer').then(setMe).catch(() => setMe({}));
  }, [router]);
  if (!me) return <Shell title="اعلام و پیگیری خسارت عمر و حوادث" nav={CUSTOMER_NAV} realm="customer"><div className="pcard p-10 flex justify-center"><Spinner /></div></Shell>;
  return <CompanyDashboard mustChangePassword={!!me.mustChangePassword} />;
}

function CompanyDashboard({ mustChangePassword }: { mustChangePassword: boolean }) {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [policyId, setPolicyId] = useState<string>('');
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [sharedCount, setSharedCount] = useState(0);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MyClaim[] | null>(null);
  const [searching, setSearching] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  // The default-password reminder shows for 15 seconds after each login, then the page moves up.
  const [pwNotice, setPwNotice] = useState(false);
  useEffect(() => {
    if (!mustChangePassword) return;
    const NOTICE_MS = 15000;
    const login = (getToken('customer') ?? '').slice(-16);
    let at = Date.now();
    try {
      const seen = JSON.parse(sessionStorage.getItem('pwNotice') ?? 'null');
      if (seen?.login === login) at = seen.at; else sessionStorage.setItem('pwNotice', JSON.stringify({ login, at }));
    } catch { /* private mode */ }
    const left = at + NOTICE_MS - Date.now();
    if (left <= 0) return;
    setPwNotice(true);
    const t = setTimeout(() => setPwNotice(false), left);
    return () => clearTimeout(t);
  }, [mustChangePassword]);

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
    client.get<unknown[]>('/customer/shared-cases', 'customer').then((r) => setSharedCount(r.length)).catch(() => {});
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

  return (
    <Shell title="اعلام و پیگیری خسارت عمر و حوادث" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer"
      action={<button type="button" className="cu-intro-btn" onClick={() => open('intro')}>معرفی امکانات سامانه</button>}>
      <ErrorBox message={error} />
      {pwNotice && (
        <div className="alert-error mb-2 flex items-center justify-between gap-3 flex-wrap">
          <span>شما با رمز عبور پیش‌فرض وارد شده‌اید؛ برای امنیت حساب، همین حالا رمز عبور خود را تغییر دهید.</span>
          <Link href="/customer/password" className="cu-more">تغییر کلمه عبور</Link>
        </div>
      )}
      {!dash ? <div className="pcard p-10 flex justify-center"><Spinner /></div> : (
        <div className="cu-home">
          {/* مشخصات بیمه نامه */}
          <section className="pcard cu-spec">
            <h2 className="cu-spec-h"><span>مشخصات بیمه نامه</span></h2>
            {dash.contracts.length === 0 ? (
              <div className="alert-error">برای شرکت شما هنوز بیمه‌نامه‌ای ثبت نشده است؛ لطفاً با کارگزاری تماس بگیرید.</div>
            ) : (
              <div className="cu-spec-row">
                <label className="cu-select" title={`بیمه‌نامه‌های عمر و حوادث همهٔ سال‌ها در این فهرست هستند. اگر بیمه‌نامهٔ خود را نمی‌بینید، با ${dash.brokerName} تماس بگیرید.`}>
                  <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.policy} size={20} /></span>
                  <select value={policyId} onChange={(e) => { setPolicyId(e.target.value); loadDash(e.target.value); }} aria-label="بیمه‌نامه">
                    {dash.contracts.map((p) => <option key={p.id} value={p.id}>{policyLabel(p, dash.brokerName)}</option>)}
                  </select>
                </label>
                {policy && (
                  <div className="cu-spec-facts">
                    <span><span style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.cal} size={18} /></span> بازهٔ بیمه‌نامه: {policy.startDate ?? '—'} تا {policy.endDate ?? '—'}</span>
                    <span><i className={`cu-dot${policy.inForce ? ' is-on' : ''}`} /> وضعیت: {policy.inForce ? 'فعال' : 'پایان یافته'}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Four summary cards for the chosen policy */}
          <div className="cu-cards">
            <div className="pcard cu-card">
              {dash.agent ? (
                <div><div className="cu-card-t">نماینده بیمه</div><div className="cu-card-v">{dash.brokerName}</div>
                  <div className="cu-card-s">پرونده‌های مشتریان شما؛ با «ارسال» به شعبهٔ شما می‌روند.</div></div>
              ) : (
                <div><div className="cu-card-t">بیمه‌گزار</div><div className="cu-card-v">{dash.company?.name ?? '—'}</div>
                  <div className="cu-card-s">کد بیمه‌گزار: <span className="latin-digits">{dash.company?.code ?? '—'}</span></div>
                  <div className="cu-card-s">کارگزار: {dash.brokerName}</div></div>
              )}
              <span className="cu-card-ico"><BigIcon path={IC.user} size={34} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">بیمه نامه {policy && <span className={`cu-tag${policy.inForce ? ' is-on' : ''}`}>[{policy.inForce ? 'فعال' : 'پایان یافته'}]</span>}</div>
                <div className="cu-card-v latin-digits">{policy?.policyNumber ?? '—'}</div>
                <div className="cu-card-s">{policy ? `${policy.lineLabel ?? '—'} — ${policy.insurerName}` : '—'}</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.doc} size={34} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">جمع مبالغ پرداخت شده</div><div className="cu-card-v">{fa(dash.stats.paidAmount)}</div><div className="cu-card-s">ریال</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.check} size={34} /></span>
            </div>
            <div className="pcard cu-card">
              <div><div className="cu-card-t">تعداد خسارات تایید شده</div><div className="cu-card-v">{fa(dash.stats.approvedCount)}</div>
                <div className="cu-card-s">از {fa(dash.stats.total)} پرونده — {fa(dash.stats.open)} در جریان</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.bubble} size={34} /></span>
            </div>
          </div>

          {/* Action launcher */}
          <div className="pcard cu-launch">
            <div className="cu-tiles">
              <Diamond href={`/customer/claims/new${policyId ? `?policy=${policyId}` : ''}`} title="اعلام خسارت" sub="ثبت پروندهٔ خسارت جدید" icon={IC.clip} />
              <Diamond href="/customer/claims" title="پیگیری خسارت" sub="مشاهدهٔ جزئیات پرونده‌ها" icon={IC.tray} />
              <Diamond href="/customer/claims?tab=action" title="نیازمند اقدام" sub={action.length ? `${fa(action.length)} پرونده منتظر شماست` : 'رفع نقص مدارک'} icon={IC.alert} />
              <Diamond onClick={() => open('search')} active={view === 'search'} title="جستجوی پرونده" sub="کد ملی، نام یا شماره پرونده" icon={IC.search} />
              <Diamond onClick={() => open('faq')} active={view === 'faq'} title="سوالات متداول" sub="پاسخ پرسش‌های رایج" icon={IC.mail} />
              {sharedCount > 0 && <Diamond href="/customer/shared" title="پرونده‌های اشتراکی" sub={`${fa(sharedCount)} پرونده از کارگزاری`} icon={IC.doc} />}
            </div>
            <div className="cu-notice">لطفاً نسبت به تعیین تکلیف پرونده‌های نیازمند اقدام، ظرف مدت حداکثر یک ماه اقدام فرمایید ( رفع نقص مدارک یا انصراف از درخواست )</div>

            <div ref={resultsRef} className="scroll-mt-24">
              {view && (
                <div className="flex items-center justify-between mt-2 mb-2">
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
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input className="input flex-1 min-w-[220px]" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="کد ملی بیمه‌شده، نام یا شماره پرونده" />
                    <button onClick={search} disabled={searching || !q.trim()} className="btn btn-solid">{searching ? 'در حال جستجو…' : 'جستجو'}</button>
                  </div>
                  {found && (found.length === 0
                    ? <div className="text-center text-sm py-2" style={{ color: 'var(--muted)' }}>پرونده‌ای با این مشخصات در پرونده‌های شما یافت نشد.</div>
                    : <div className="cu-group"><CaseTable rows={found} /></div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
