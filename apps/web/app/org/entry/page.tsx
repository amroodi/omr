'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { client, getToken, hasPerm } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { Faq } from '../../components/Faq';
import { BigIcon, ErrorBox, Spinner } from '../../components/ui';
import { CaseTable, MyClaim } from '../../customer/case-table';
import { Diamond, IC } from '../../customer/launcher';
import { ORG_NAV } from '../nav';
import { entryCaseHref, entryCases, matchCase } from './cases';
import { getLine } from '../../../lib/line';

/** One بیمه‌نامه of «مشخصات بیمه نامه» (GET /claims/entry-policies). */
interface EntryPolicy { id: string; companyName: string; policyNumber: string | null; line: string | null; lineLabel: string | null; insurerName: string | null; brokerName: string | null; startDate: string | null; endDate: string | null; inForce: boolean }
const POLICY_KEY = 'entry_policy';

const fa = (n: number | string) => Number(n).toLocaleString('fa-IR');
type View = null | 'search' | 'faq' | 'intro';
const VIEW_TITLE: Record<Exclude<View, null>, string> = { search: 'جستجوی پرونده', faq: 'سوالات متداول', intro: 'معرفی امکانات سامانه' };

/**
 * Panel 1 «پیشخوان» of an organization's own staff (کارگزاری or بیمه‌گر): the بیمه‌گزار / نماینده
 * panel's home — summary cards and the action launcher — for filing cases, ورود دسته‌ای and «میز کار
 * مستقل». Assessment stays on panel 2.
 */
export default function EntryHome() {
  const [claims, setClaims] = useState<MyClaim[] | null>(null);
  const [me, setMe] = useState<{ name: string | null; panel?: string | null; spareDesk?: boolean } | null>(null);
  const [org, setOrg] = useState('');
  const [can, setCan] = useState({ file: false, onBehalf: false, import: false, spare: false });
  const [error, setError] = useState('');
  const [view, setView] = useState<View>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MyClaim[] | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [policies, setPolicies] = useState<EntryPolicy[] | null>(null);
  const [policyId, setPolicyId] = useState('');

  useEffect(() => {
    if (!getToken('org')) return;
    setCan({ file: hasPerm('org', 'claim:file'), onBehalf: hasPerm('org', 'claim:file-on-behalf'), import: hasPerm('org', 'import:batch'), spare: hasPerm('org', 'spare:work') });
    entryCases().then(setClaims).catch((e) => setError(e.message));
    client.get<{ name: string | null; panel?: string | null; spareDesk?: boolean }>('/auth/me', 'org').then(setMe).catch(() => {});
    client.get<{ name: string }>('/tenant/branding', 'org').then((b) => setOrg(b.name)).catch(() => {});
    // «مشخصات بیمه نامه»: only the بیمه‌نامه‌ها of the نوع بیمه‌نامه this panel works in.
    client.get<EntryPolicy[]>('/claims/entry-policies', 'org').then((l) => {
      const line = getLine();
      const list = l.filter((p) => !line || !p.line || p.line === line);
      setPolicies(list);
      let saved = ''; try { saved = localStorage.getItem(POLICY_KEY) ?? ''; } catch { /* ignore */ }
      setPolicyId(list.some((p) => p.id === saved) ? saved : (list.find((p) => p.inForce) ?? list[0])?.id ?? '');
    }).catch(() => setPolicies([]));
  }, []);
  const policy = policies?.find((p) => p.id === policyId) ?? null;
  const pickPolicy = (id: string) => { setPolicyId(id); try { localStorage.setItem(POLICY_KEY, id); } catch { /* ignore */ } };

  const broker = me?.panel === 'BROKER';
  const stats = useMemo(() => {
    const l = claims ?? [];
    return {
      total: l.length,
      open: l.filter((c) => !['PAID', 'REJECTED'].includes(c.status)).length,
      approved: l.filter((c) => ['APPROVED', 'PAID'].includes(c.status)).length,
      paid: l.filter((c) => c.status === 'PAID').reduce((t, c) => t + Number(c.payableAmount || c.claimedAmount || 0), 0),
      action: l.filter((c) => c.needsAction).length,
    };
  }, [claims]);

  const open = (v: Exclude<View, null>) => {
    setView((cur) => (cur === v ? null : v));
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const search = () => setFound((claims ?? []).filter((c) => matchCase(c, q)));
  // A brokerage files for its بیمه‌گزاران; an insurer files with its own entry rules.
  const fileHref = broker && can.onBehalf ? '/org/claims/on-behalf' : can.file ? '/org/claims/new' : null;

  return (
    <Shell title="ثبت و پیگیری خسارت عمر و حوادث" sectionLabel="خسارت عمر و حادثه" nav={ORG_NAV} realm="org"
      action={<button type="button" className="cu-intro-btn" onClick={() => open('intro')}>معرفی امکانات سامانه</button>}>
      <ErrorBox message={error} />
      {!claims ? <div className="pcard p-10 flex justify-center"><Spinner /></div> : (
        <div className="cu-home is-fill">
          {/* «مشخصات بیمه نامه» — Sinad's first block: the بیمه‌نامه picked, its period and status, and who works here */}
          <section className="pcard cu-spec">
            <h2 className="cu-spec-h"><span>مشخصات بیمه نامه</span></h2>
            <p className="cu-spec-note">در صورتی که بیمه‌گزار یا بیمه‌نامهٔ مورد نظر را در فهرست نمی‌بینید، با مدیر سامانهٔ {org || 'سازمان'} تماس بگیرید.</p>
            <div className="cu-spec-row">
              <label className="cu-select" title="بیمه‌نامه‌های بیمه‌گزاران، از جدیدترین">
                <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.policy} size={20} /></span>
                <select value={policyId} onChange={(e) => pickPolicy(e.target.value)} aria-label="بیمه‌نامه" disabled={!policies?.length}>
                  {!policies ? <option value="">…</option> : policies.length === 0 ? <option value="">بیمه‌نامه‌ای ثبت نشده است</option>
                    : policies.map((p) => <option key={p.id} value={p.id}>{[p.policyNumber || '—', p.companyName, broker ? p.insurerName : p.brokerName, p.lineLabel, p.startDate && p.endDate ? `${p.startDate} - ${p.endDate}` : null].filter(Boolean).join(' | ')}</option>)}
                </select>
              </label>
              {policy && (
                <div className="cu-spec-facts">
                  <span><span style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.cal} size={18} /></span> تاریخ شروع: {policy.startDate ?? '—'}</span>
                  <span><span style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.cal} size={18} /></span> تاریخ پایان: {policy.endDate ?? '—'}</span>
                  <span><i className={`cu-dot${policy.inForce ? ' is-on' : ''}`} /> وضعیت: {policy.inForce ? 'فعال' : 'پایان یافته'}</span>
                </div>
              )}
            </div>
            <div className="cu-spec-row is-solo">
              <label className="cu-select" title="کاربر وارد شده">
                <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.user} size={20} /></span>
                <select value="me" onChange={() => {}} aria-label="کاربر"><option value="me">{me?.name ?? '—'}{org ? ` — ${org}` : ''} — پنل ورود داده</option></select>
              </label>
            </div>
          </section>

          <div className="cu-cards">
            <div className="pcard cu-card">
              <div><div className="cu-card-t">{broker ? 'کارگزاری' : 'بیمه‌گر'}</div><div className="cu-card-v">{org || '—'}</div>
                <div className="cu-card-s">کاربر: {me?.name ?? '—'}</div>
                <div className="cu-card-s">پنل ورود داده</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.user} size={34} /></span>
            </div>
            {/* The three figures open the list of those cases. */}
            <Link href="/org/entry/claims?tab=open" className="pcard cu-card is-link" title="فهرست پرونده‌های در جریان">
              <div><div className="cu-card-t">پرونده‌ها</div><div className="cu-card-v">{fa(stats.total)}</div>
                <div className="cu-card-s">{fa(stats.open)} پرونده در جریان</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.doc} size={34} /></span>
            </Link>
            <Link href="/org/entry/claims?tab=paid" className="pcard cu-card is-link" title="فهرست پرونده‌های پرداخت‌شده">
              <div><div className="cu-card-t">جمع مبالغ پرداخت شده</div><div className="cu-card-v">{fa(stats.paid)}</div><div className="cu-card-s">ریال</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.check} size={34} /></span>
            </Link>
            <Link href="/org/entry/claims?tab=approved" className="pcard cu-card is-link" title="فهرست خسارات تاییدشده">
              <div><div className="cu-card-t">تعداد خسارات تایید شده</div><div className="cu-card-v">{fa(stats.approved)}</div>
                <div className="cu-card-s">از {fa(stats.total)} پرونده</div></div>
              <span className="cu-card-ico"><BigIcon path={IC.bubble} size={34} /></span>
            </Link>
          </div>

          <div className="pcard cu-launch">
            <div className="cu-tiles">
              {fileHref && <Diamond href={fileHref} title="اعلام خسارت" sub={broker ? 'ثبت پرونده برای بیمه‌گزار' : 'ثبت پروندهٔ خسارت جدید'} icon={IC.clip} />}
              <Diamond href="/org/entry/claims" title="پیگیری خسارت" sub="مشاهدهٔ جزئیات پرونده‌ها" icon={IC.tray} />
              <Diamond href="/org/entry/claims?tab=action" title="نیازمند اقدام" sub={stats.action ? `${fa(stats.action)} پرونده منتظر رفع نقص` : 'رفع نقص مدارک'} icon={IC.alert} />
              <Diamond onClick={() => open('search')} active={view === 'search'} title="جستجوی پرونده" sub="کد ملی، نام یا شماره پرونده" icon={IC.search} />
              {broker && can.import && <Diamond href="/org/import" title="ورود دسته‌ای" sub="ثبت پرونده‌ها از فایل اکسل" icon={IC.doc} />}
              {broker && can.spare && me?.spareDesk && <Diamond href="/org/spare" title="میز کار مستقل" sub="پرونده‌های بیرون از سلسله‌مراتب" icon={IC.policy} />}
              <Diamond onClick={() => open('faq')} active={view === 'faq'} title="سوالات متداول" sub="پاسخ پرسش‌های رایج" icon={IC.mail} />
            </div>
            <div className="cu-notice">پرونده‌های نیازمند اقدام را ظرف مدت حداکثر یک ماه تعیین تکلیف کنید<br />( رفع نقص مدارک یا انصراف از درخواست )</div>

            <div ref={resultsRef} className="scroll-mt-24">
              {view && (
                <div className="flex items-center justify-between mt-2 mb-2">
                  <h2 className="font-extrabold">{VIEW_TITLE[view]}</h2>
                  <button onClick={() => setView(null)} className="btn btn-ghost btn-sm">بستن ✕</button>
                </div>
              )}
              {view === 'intro' && (
                <ul className="cu-intro">
                  <li><b>اعلام خسارت:</b> پروندهٔ فوت یا حادثه را {broker ? 'برای هر یک از بیمه‌گزاران کارگزاری' : 'برای کارگزاران و نمایندگان'} ثبت و مدارک مورد نیاز را بارگذاری کنید.</li>
                  <li><b>پیگیری خسارت:</b> پرونده‌ها را به تفکیک وضعیت، نوع خسارت، مرحله یا ماه ثبت ببینید و هر پرونده را تا پرداخت دنبال کنید.</li>
                  <li><b>نیازمند اقدام:</b> پرونده‌هایی که برای رفع نقص برگشته‌اند و باید مدرک صحیح جایگزین شود.</li>
                  {broker && <li><b>ورود دسته‌ای و میز کار مستقل:</b> پرونده‌ها را از فایل اکسل وارد کنید و پرونده‌های بیرون از سلسله‌مراتب را نگه دارید.</li>}
                  <li><b>رسیدگی و ارزیابی</b> از «ورود برای ارزیابی پرونده‌ها» در صفحهٔ اصلی انجام می‌شود.</li>
                </ul>
              )}
              {view === 'faq' && <Faq />}
              {view === 'search' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input className="input flex-1 min-w-[220px]" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="کد ملی بیمه‌شده، نام یا شماره پرونده" />
                    <button onClick={search} disabled={!q.trim()} className="btn btn-solid">جستجو</button>
                  </div>
                  {found && (found.length === 0
                    ? <div className="text-center text-sm py-2" style={{ color: 'var(--muted)' }}>پرونده‌ای با این مشخصات یافت نشد.</div>
                    : <div className="cu-group"><CaseTable rows={found} href={entryCaseHref} /></div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
