'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox } from './ui';
import { JalaliDatePicker } from './JalaliDatePicker';
import { Shell } from './Shell';
import { CUSTOMER_NAV, POLICY_KEY, PolicyRow } from '../customer/nav';
import { ORG_NAV } from '../org/nav';
import { CAUSE_LABEL, EVENT_DATE_LABEL, INSURED_RELATIONS, insuredNameLabel } from './claim-wording';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
// Death claims ask for the date of death; accident disability / medical claims for the accident date.
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);

/** Whole years between two ISO dates (age at death); null when either is missing or implausible. */
function ageBetween(birthIso: string | null, atIso: string | null): number | null {
  if (!birthIso) return null;
  const b = new Date(birthIso); const e = atIso ? new Date(atIso) : new Date();
  let a = e.getUTCFullYear() - b.getUTCFullYear();
  if (e.getUTCMonth() < b.getUTCMonth() || (e.getUTCMonth() === b.getUTCMonth() && e.getUTCDate() < b.getUTCDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

function jalaliToIso(input: string): string | null {
  const parts = toAscii(input).split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(parts[0], parts[1], parts[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Field with a right-aligned bold label and an optional orange help bubble beside it. */
function PField({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        {help && <span className="phelp" title={help}>؟</span>}
      </div>
    </div>
  );
}

/** A بیمه‌گزار company a brokerage's staff may file for (panel 1). */
interface StaffCompany { id: string; name: string; contracts: unknown[]; accounts: { id: string; fullName: string }[] }

/**
 * «ثبت پرونده خسارت» of the بیمه‌گزار / نماینده panel — and of a brokerage's panel 1 (`realm="org"`), where
 * the staff first pick the بیمه‌گزار company (and may name its نماینده and an estimated amount).
 */
export function PolicyholderClaimForm({ realm }: { realm: 'customer' | 'org' }) {
  const router = useRouter();
  const org = realm === 'org';
  const [staffCos, setStaffCos] = useState<StaffCompany[] | null>(null);
  const [extra, setExtra] = useState({ policyHolderId: '', claimedAmount: '' });
  const [company, setCompany] = useState<{ name: string } | null | undefined>(undefined);
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [broker, setBroker] = useState('');
  const [policyId, setPolicyId] = useState('');
  // «broker» login: which company this claim is for (from ?company=…)
  const [brokerFor, setBrokerFor] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [isBroker, setIsBroker] = useState(false);
  const [f, setF] = useState({ claimType: 'DEATH_ILLNESS', eventDate: '', birthDate: '', deceasedFullName: '', deceasedNationalCode: '', relation: '', mainName: '', mainCode: '', causeOfDeath: '', description: '', startStage: '' });
  // «اعلام خسارت»: is filing allowed from this login, and to which desks?
  const [notice, setNotice] = useState<{ enabled: boolean; targets: string[]; default: string; labels: Record<string, string> } | null>(null);
  useEffect(() => { client.get<any>(org ? '/claims/notice-options' : '/customer/notice-options', realm).then(setNotice).catch(() => setNotice(null)); }, []);
  const [causes, setCauses] = useState<string[]>([]);
  // فن‌آوران coverage inquiry; stays null while Super Admin has it off for this insurer.
  const [coverage, setCoverage] = useState<{ status: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Panel 1: the staff pick the بیمه‌گزار; its بیمه‌نامه‌ها then come exactly as on its own panel. */
  const pickCompany = (co: StaffCompany | null) => {
    setBrokerFor(co ? { id: co.id, name: co.name } : null); setCompany(co ? { name: co.name } : null);
    setExtra({ policyHolderId: co?.accounts.length === 1 ? co.accounts[0].id : '', claimedAmount: '' });
    setPolicies(co ? null : []); setPolicyId(''); setCoverage(null);
    if (!co) return;
    client.get<{ contracts: PolicyRow[]; selectedId: string | null; brokerName: string }>(`/claims/on-behalf/companies/${co.id}/policies`, 'org').then((d) => {
      setPolicies(d.contracts); setBroker(d.brokerName);
      const pick = d.contracts.find((c) => c.id === d.selectedId) ?? d.contracts[0];
      if (pick) choosePolicy(pick);
    }).catch((e) => { setPolicies([]); setError(e.message); });
  };

  useEffect(() => {
    if (org) {
      setIsBroker(true);
      const want = new URLSearchParams(window.location.search).get('company') ?? '';
      client.get<StaffCompany[]>('/claims/on-behalf/companies', 'org').then((l) => {
        setStaffCos(l);
        const co = l.find((c) => c.id === want) ?? (l.length === 1 ? l[0] : null);
        if (co) pickCompany(co); else { setCompany(null); setPolicies([]); }
      }).catch((e) => { setStaffCos([]); setError(e.message); });
      return;
    }
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    const params = new URLSearchParams(window.location.search);
    const companyParam = params.get('company') ?? '';
    // The بیمه‌نامه chosen on the dashboard (?policy=…, else the remembered one), else the one in force.
    let want = params.get('policy') ?? '';
    try { want = want || (companyParam ? '' : localStorage.getItem(POLICY_KEY) || ''); } catch { /* ignore */ }
    client.get<{ company: { name: string } | null; brokerPanel?: boolean }>('/customer/me', 'customer').then(async (m) => {
      if (!m.brokerPanel) { setCompany(m.company); setBrokerFor(null); return; }
      // The broker files for a company it picked on its home list.
      setIsBroker(true);
      const list = companyParam ? await client.get<{ id: string; name: string }[]>('/customer/broker/companies', 'customer').catch(() => []) : [];
      const co = list.find((c) => c.id === companyParam) ?? null;
      setBrokerFor(co); setCompany(co ? { name: co.name } : null);
    }).catch(() => setCompany(null));
    client.get<{ contracts: PolicyRow[]; selectedId: string | null; brokerName: string }>(`/customer/dashboard${companyParam ? `?companyId=${encodeURIComponent(companyParam)}` : ''}`, 'customer').then((d) => {
      setPolicies(d.contracts); setBroker(d.brokerName);
      const pick = d.contracts.find((c) => c.id === want) ?? d.contracts.find((c) => c.id === d.selectedId) ?? d.contracts[0];
      if (pick) choosePolicy(pick);
    }).catch(() => setPolicies([]));
    // eslint-disable-next-line
  }, []);

  const policy = policies?.find((p) => p.id === policyId) ?? null;
  // Model View: the wording and fields this insurer set for this بیمه‌نامه.
  const form = policy?.form;
  const eventLabel = form?.eventLabel ?? EVENT_DATE_LABEL;
  const caseType = form?.caseTypes.find((t) => t.code === f.claimType);
  const causeOptions = form?.causeLists[caseType?.causeGroup ?? 'ACCIDENT'] ?? [];
  // Ticks from the other list (the نوع پرونده changed) don't count.
  const cause = [...causes.filter((c) => causeOptions.includes(c)), f.causeOfDeath.trim()].filter(Boolean).join('، ');
  // Model View: «نوع بیمه‌شده» for this company? A همسر / فرزند also names the main insured.
  const askRelation = !!form?.dependents;
  const dependent = askRelation && (f.relation === 'SPOUSE' || f.relation === 'CHILD');
  const relationName = INSURED_RELATIONS[f.relation] ?? '';
  const types = policy?.claimTypes ?? Object.keys(CLAIM_TYPE_LABELS);
  /** Select a بیمه‌نامه; keep the claim type only if that policy's line covers it. */
  const choosePolicy = (p: PolicyRow) => {
    setPolicyId(p.id);
    setF((cur) => (p.claimTypes && !p.claimTypes.includes(cur.claimType) ? { ...cur, claimType: p.claimTypes[0] } : cur));
  };
  /** A date outside the chosen policy year → switch to the same line's policy that covers it, if any. */
  const onEventDate = (v: string) => {
    setF((cur) => ({ ...cur, eventDate: v }));
    const iso = jalaliToIso(v);
    if (!iso || !policy || !policies) return;
    const t = new Date(iso).getTime();
    const covers = (p: PolicyRow) => (!p.startIso || new Date(p.startIso).getTime() <= t) && (!p.endIso || new Date(p.endIso).getTime() >= t);
    if (covers(policy)) return;
    const other = policies.find((p) => p.line === policy.line && covers(p));
    if (other) choosePolicy(other);
  };

  const checkCoverage = async () => {
    setCoverage(null);
    const code = toAscii(f.deceasedNationalCode).trim();
    if (!policyId || !/^\d{10}$/.test(code)) return;
    const r = await client.post<any>(org ? '/claims/on-behalf/coverage-check' : '/customer/coverage-check', { contractId: policyId, nationalCode: code }, realm).catch(() => null);
    if (r?.enabled) setCoverage({ status: r.status, name: [r.person?.firstName, r.person?.lastName].filter(Boolean).join(' ') });
  };

  const submit = async () => {
    setError('');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    if (birthIso && iso && new Date(birthIso) > new Date(iso)) return setError(`تاریخ تولد بعد از ${eventLabel} است`);
    if (form?.birthDate === 'required' && !birthIso) return setError('تاریخ تولد بیمه‌شده را وارد کنید');
    if (form?.cause === 'required' && !cause) return setError(`${CAUSE_LABEL} را مشخص کنید`);
    if (askRelation && !f.relation) return setError('نوع بیمه‌شده را انتخاب کنید');
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        claimType: f.claimType,
        ...(policyId ? { contractId: policyId } : {}),
        ...(brokerFor && !org ? { companyId: brokerFor.id } : {}),
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
      };
      if (askRelation) {
        payload.insuredRelation = f.relation;
        if (dependent) { payload.mainInsuredName = f.mainName.trim(); payload.mainInsuredNationalCode = toAscii(f.mainCode).trim(); }
      }
      if (iso) payload.eventDate = iso;
      if (birthIso) payload.deceasedBirthDate = birthIso;
      if (cause) payload.causeOfDeath = cause;
      if (f.startStage || (notice?.enabled && notice.targets.length > 1)) payload.startStage = f.startStage || startDefault;
      if (f.description.trim()) payload.description = f.description.trim();
      if (org) {
        // Panel 1: filed for the picked company, through the brokerage's own endpoint.
        if (!brokerFor) throw new Error('بیمه‌گزار را انتخاب کنید');
        payload.policyholderCompanyId = brokerFor.id;
        if (extra.policyHolderId) payload.policyHolderId = extra.policyHolderId;
        const amount = toAscii(extra.claimedAmount).replace(/[^\d]/g, '');
        if (amount) payload.claimedAmount = amount;
        const c = await client.post<{ id: string }>('/claims/on-behalf', payload, 'org');
        router.push(`/org/claims/${c.id}`);
        return;
      }
      const c = await client.post<{ id: string }>('/customer/claims', payload, 'customer');
      router.push(`/customer/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  // Filed for a بیمه‌گزار by its brokerage, a case starts at the بیمه‌گزار's desk unless chosen otherwise (as the server does).
  const startDefault = notice ? (org && notice.targets.includes('POLICYHOLDER') ? 'POLICYHOLDER' : notice.default) : '';
  const isDeath = caseType?.death ?? DEATH_TYPES.has(f.claimType);
  const age = ageBetween(f.birthDate ? jalaliToIso(f.birthDate) : null, f.eventDate ? jalaliToIso(f.eventDate) : null);

  return (
    <Shell title="ثبت پرونده خسارت" breadcrumb="ثبت پرونده خسارت" sectionLabel="خسارت عمر و حادثه" nav={org ? ORG_NAV : CUSTOMER_NAV} realm={realm}>
      <div className="pcard p-5 pform">
        {/* Guidance banner */}
        <div className="pinfobox mb-3 text-center">
          پس از ثبت پرونده، مدارک موردنیاز را در صفحهٔ پرونده بارگذاری کنید.
          <div className="text-xs font-normal">
            {company
              ? <>پرونده برای «{company.name}» ذیل بیمه‌نامهٔ انتخاب‌شده ثبت می‌شود و کارگزاری آن را به بیمه‌گر همان بیمه‌نامه ارسال می‌کند.</>
              : company === null ? (isBroker
                ? <>ابتدا بیمه‌گزاری را که پرونده برای آن ثبت می‌شود انتخاب کنید.</>
                : <>حساب شما هنوز به شرکت بیمه‌گزار متصل نشده است؛ برای ثبت پرونده با کارگزاری تماس بگیرید.</>) : null}
          </div>
        </div>

        <ErrorBox message={error} />
        {notice && !notice.enabled && <div className="alert-error mt-3">اعلام خسارت از این پنل غیرفعال است؛ برای ثبت پرونده با کارگزاری تماس بگیرید.</div>}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5 mt-3">
          {org && (
            <>
              <PField label="بیمه‌گزار (شرکت) *" help="شرکتی که بیمه‌شده در آن شاغل است؛ پرونده در پنل همین بیمه‌گزار هم دیده می‌شود.">
                <select className="input" value={brokerFor?.id ?? ''} onChange={(e) => pickCompany(staffCos?.find((c) => c.id === e.target.value) ?? null)} disabled={!staffCos?.length}>
                  <option value="">{!staffCos ? 'در حال دریافت…' : staffCos.length ? '— انتخاب بیمه‌گزار —' : 'بیمه‌گزاری ثبت نشده است'}</option>
                  {staffCos?.map((c) => <option key={c.id} value={c.id} disabled={!c.contracts.length}>{c.name}{c.contracts.length ? '' : ' (بدون قرارداد فعال)'}</option>)}
                </select>
              </PField>
              {(() => { const co = staffCos?.find((c) => c.id === brokerFor?.id); return co && co.accounts.length > 0 ? (
                <PField label="نمایندهٔ بیمه‌گزار" help="اختیاری؛ نماینده پرونده را در پنل خود هم می‌بیند.">
                  <select className="input" value={extra.policyHolderId} onChange={(e) => setExtra({ ...extra, policyHolderId: e.target.value })}>
                    <option value="">— بدون نماینده —</option>
                    {co.accounts.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
                  </select>
                </PField>
              ) : null; })()}
              <PField label="مبلغ خسارت برآوردی (ریال)" help="اختیاری؛ مبلغ قطعی پس از ارزیابی ثبت می‌شود.">
                <input className="input" inputMode="numeric" value={toAscii(extra.claimedAmount).replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '٬')} onChange={(e) => setExtra({ ...extra, claimedAmount: toAscii(e.target.value).replace(/[^\d]/g, '') })} placeholder="۰" style={{ direction: 'ltr', textAlign: 'right' }} />
              </PField>
            </>
          )}
          <div className="md:col-span-2">
            <PField label="بیمه‌نامه و بازهٔ آن *" help="بیمه‌نامهٔ عمر یا حوادث شرکت که خسارت ذیل آن اعلام می‌شود؛ بیمه‌نامهٔ همان سالی را انتخاب کنید که حادثه یا فوت در آن رخ داده است.">
              <select className="input" value={policyId} onChange={(e) => { const p = policies?.find((x) => x.id === e.target.value); if (p) choosePolicy(p); }} disabled={!policies?.length}>
                {!policies ? <option>در حال دریافت…</option> : policies.length === 0 ? <option>بیمه‌نامه‌ای ثبت نشده است</option> : policies.map((p) => (
                  <option key={p.id} value={p.id}>{p.lineLabel ? `${p.lineLabel} — ` : ''}شماره {p.policyNumber ?? '—'} — {p.startDate ?? '…'} تا {p.endDate ?? '…'}{p.inForce ? ' (جاری)' : ''}</option>
                ))}
              </select>
            </PField>
            {policy && <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>بیمه‌گر: {policy.insurerName} — کارگزار: {broker}</div>}
          </div>

          <PField label="نوع پرونده *" help="نوع خسارت را مشخص کنید؛ فقط خسارت‌هایی که بیمه‌نامهٔ انتخاب‌شده پوشش می‌دهد فهرست شده‌اند.">
            <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
              {types.map((v) => <option key={v} value={v}>{form?.caseTypes.find((t) => t.code === v)?.label ?? CLAIM_TYPE_LABELS[v] ?? v}</option>)}
            </select>
          </PField>

          {askRelation && (
            <PField label="نوع بیمه‌شده *" help="هر پرونده برای یک نفر است؛ برای هر فرزند پروندهٔ جداگانه ثبت کنید.">
              <select className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
                <option value="">انتخاب کنید…</option>
                {Object.entries(INSURED_RELATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </PField>
          )}

          {dependent && (
            <>
              <PField label="نام و نام خانوادگی بیمه‌شدهٔ اصلی *">
                <input className="input" value={f.mainName} onChange={(e) => setF({ ...f, mainName: e.target.value })} />
              </PField>
              <PField label="کد ملی بیمه‌شدهٔ اصلی *">
                <input className="input" value={f.mainCode} onChange={(e) => setF({ ...f, mainCode: e.target.value })} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} />
              </PField>
            </>
          )}

          {(!askRelation || f.relation) && <>
          <PField label={dependent ? `نام و نام خانوادگی ${relationName} *` : `${form?.insuredLabel ?? insuredNameLabel(policy?.line)} *`}>
            <input className="input" value={f.deceasedFullName} onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })} />
          </PField>

          <PField label={dependent ? `کد ملی ${relationName} *` : 'کد ملی بیمه‌شده *'} help="کد ملی ۱۰ رقمی.">
            <input className="input" value={f.deceasedNationalCode} onChange={(e) => setF({ ...f, deceasedNationalCode: e.target.value })} onBlur={checkCoverage} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} />
            {coverage && (
              <div className={`text-xs mt-1 ${coverage.status === 'VALID' ? 'alert-success' : coverage.status === 'NOT_CHECKED' ? '' : 'alert-error'}`}>
                {coverage.status === 'VALID' ? `پوشش بیمه معتبر است${coverage.name ? ` — ${coverage.name}` : ''}`
                  : coverage.status === 'INVALID' ? 'پوشش این فرد در سامانهٔ بیمه‌گر معتبر نیست'
                  : coverage.status === 'NOT_FOUND' ? 'این کد ملی در سامانهٔ بیمه‌گر یافت نشد'
                  : 'سامانهٔ بیمه‌گر در دسترس نیست؛ می‌توانید ثبت کنید و بررسی بعداً خودکار انجام می‌شود'}
              </div>
            )}
          </PField>
          </>}

          {form?.birthDate !== 'hidden' && (
          <PField label={`تاریخ تولد بیمه‌شده (شمسی)${form?.birthDate === 'required' ? ' *' : ''}`} help="تاریخ تولد بیمه‌شده؛ سن او به‌طور خودکار محاسبه می‌شود.">
            <JalaliDatePicker value={f.birthDate} onChange={(v) => setF({ ...f, birthDate: v })} placeholder="۱۳۴۵/۰۵/۱۲" />
          </PField>
          )}

          <PField label={`${eventLabel} (شمسی) *`} help="تاریخ وقوع فوت یا حادثه به تقویم شمسی؛ بیمه‌گر بر اساس قرارداد معتبر در این تاریخ تعیین می‌شود.">
            <JalaliDatePicker value={f.eventDate} onChange={onEventDate} placeholder="۱۴۰۵/۰۷/۰۱" />
          </PField>

          <PField label={isDeath ? 'سن متوفی (هنگام فوت)' : 'سن بیمه‌شده (هنگام حادثه)'} help="از روی تاریخ تولد و تاریخ وقوع محاسبه می‌شود.">
            <input className="input" readOnly value={age != null ? `${age.toLocaleString('fa-IR')} سال` : ''} placeholder="(پس از ورود تاریخ‌ها)" style={{ background: 'var(--surface-2)' }} />
          </PField>

          {form?.cause !== 'hidden' && (
          <div className="md:col-span-2 lg:col-span-3"><PField label={`${CAUSE_LABEL}${form?.cause === 'required' ? ' *' : ''}`} help="علت را همان‌طور که می‌دانید بنویسید؛ مثلاً «ایست قلبی»، «تصادف رانندگی» یا «سقوط از ارتفاع».">
            {causeOptions.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 mb-2">
                {causeOptions.map((c) => (
                  <label key={c} className="flex items-start gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={causes.includes(c)} onChange={(e) => setCauses(e.target.checked ? [...causes, c] : causes.filter((x) => x !== c))} /> {c}
                  </label>
                ))}
              </div>
            )}
            <input className="input" value={f.causeOfDeath} onChange={(e) => setF({ ...f, causeOfDeath: e.target.value })} maxLength={300} placeholder={causeOptions.length > 0 ? 'علت دیگر (تایپ کنید)…' : 'شرح علت'} />
          </PField></div>
          )}
        </div>

        {notice && notice.enabled && notice.targets.length > 1 && (
          <div className="mt-2.5 max-w-md">
            <label className="label">ارسال پرونده پس از ثبت به</label>
            <select className="input" value={f.startStage || startDefault} onChange={(e) => setF({ ...f, startStage: e.target.value })}>
              {notice.targets.map((t) => <option key={t} value={t}>{notice.labels[t] ?? t}</option>)}
            </select>
          </div>
        )}

        <div className="mt-2.5">
          <label className="label">توضیحات (اختیاری)</label>
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه، شماره تماس، یا موارد خاص پرونده." />
        </div>

        <div className="flex justify-center mt-3">
          <button onClick={submit} disabled={busy || !f.deceasedFullName || !f.deceasedNationalCode || (dependent && (!f.mainName.trim() || !f.mainCode.trim())) || !f.eventDate || company === null || (policies !== null && policies.length > 0 && !policyId)} className="btn btn-solid btn-solid-lg">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
