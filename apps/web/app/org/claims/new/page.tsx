'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../../lib/client';
import { getLine, lineQuery } from '../../../../lib/line';
import { Shell } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox } from '../../../components/ui';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';
import { Coverage, CoverageNote, coverageText } from '../../../components/CoverageNote';
import { ORG_NAV } from '../../nav';
import { CAUSE_LABEL, EVENT_DATE_LABEL, insuredNameLabel } from '../../../components/claim-wording';
import { useDraft } from '../../../../lib/draft';

/** An insurer's panel 1: its partner کارگزاری‌ها (with their بیمه‌گزاران), شعبه‌ها, and Super Admin's entry way. */
type FieldMode = 'hidden' | 'optional' | 'required';
/** The filing form of an insurer's panel 1, as Model View sets it: «علت خسارت» and تاریخ تولد, and each نوع پرونده's cause list. */
interface EntryForm { cause: FieldMode; birthDate: FieldMode; causeLists: { DEATH: string[]; ACCIDENT: string[] }; causeNotes?: Record<string, string>; caseTypes: { code: string; causeGroup: 'DEATH' | 'ACCIDENT' }[] }
interface InsurerEntry {
  way: 'BROKER' | 'BRANCH' | 'ASK'; form?: EntryForm;
  brokers: { id: string; name: string; code?: string | null; companies: { id: string; name: string }[] }[]; // code: «کد کارگزار» at this insurer
  branches: { id: string; name: string; code: string }[];
  myBranchId?: string | null; // the operator's own شعبه: it handles what they file
}
interface Company { id: string; name: string; currentInsurer: { id: string; name: string } | null; contracts: { insurerName: string; policyNumber: string | null }[]; accounts: { id: string; fullName: string }[] }

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);
const NO_COMPANY = '__none__';
/** Amounts on screen: a separator every 3 digits (the raw digits are what's stored and sent). */
const groupDigits = (raw: string) => raw.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');

function jalaliToIso(input: string): string | null {
  const parts = toAscii(input).split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(parts[0], parts[1], parts[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function ageBetween(birthIso: string | null, atIso: string | null): number | null {
  if (!birthIso) return null;
  const b = new Date(birthIso); const e = atIso ? new Date(atIso) : new Date();
  let a = e.getUTCFullYear() - b.getUTCFullYear();
  if (e.getUTCMonth() < b.getUTCMonth() || (e.getUTCMonth() === b.getUTCMonth() && e.getUTCDate() < b.getUTCDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

/** Field with a bold label and an optional help bubble — same look as the بیمه‌گزار panel's form. */
function PField({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label.endsWith(' *') ? <>{label.slice(0, -2)} <span className="req-star">*</span></> : label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        {help && <span className="phelp" title={help}>؟</span>}
      </div>
    </div>
  );
}

const norm = (t: string) => t.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').trim();

/**
 * A searchable list (an insurer's panel 1: «علت خسارت», «بیمه‌گزار (شرکت)»): type part of a name to find
 * it; ↑/↓ and Enter pick, Esc closes. `none` adds an empty choice at the top (e.g. «بدون شرکت بیمه‌گزار»).
 */
function SearchPick({ options, value, onPick, placeholder, none, label, badge }: {
  options: { id: string; name: string }[]; value: string; onPick: (id: string) => void; placeholder: string;
  none?: string; label: string; badge?: (id: string) => string | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const picked = options.find((o) => o.id === value) ?? null;
  // While typing only the matches show, so Enter takes the first one.
  const list = [...(none && !q.trim() ? [{ id: '', name: none }] : []), ...options.filter((o) => !q.trim() || norm(o.name).includes(norm(q)))];
  const choose = (id: string) => { onPick(id); setQ(''); setOpen(false); };
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" role="combobox" aria-expanded={open} aria-label={label} title={picked?.name}
        value={open ? q : picked?.name ?? ''} placeholder={open && picked ? picked.name : placeholder}
        onFocus={() => { setOpen(true); setQ(''); setHi(0); }} onClick={() => setOpen(true)} onBlur={() => { setOpen(false); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && list[hi]) choose(list[hi].id); else setOpen(true); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      <span className="spick-caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="co-pick" role="listbox">
          {list.length === 0 ? <li className="is-empty">موردی با این نام نیست</li> : list.map((o, k) => (
            <li key={o.id || '__none'} role="option" aria-selected={o.id === value} className={`cause-opt${k === hi ? ' is-hi' : ''}${o.id === value ? ' is-on' : ''}${o.id ? '' : ' is-none'}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o.id); }} onMouseEnter={() => setHi(k)}>
              <span className="flex-1">{o.name}</span>
              {o.id && badge?.(o.id) && <span className="cause-has-note">{badge(o.id)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * «ثبت پرونده خسارت» on panel 1 — laid out like the بیمه‌گزار panel's filing form, for staff. Picking the
 * بیمه‌گزار company routes the case by its insurer contract and shows it in that company's panel; for a
 * case without a company the insurer and sales channel are chosen by hand. An insurer's staff (panel 1)
 * pick one of its کارگزاری‌ها and that brokerage's بیمه‌گزار — or a direct sale by a شعبه — and the case
 * starts where Super Admin's Model View says (the کارگزاری's desk, a شعبه, or their choice).
 */
export default function NewClaim() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  // Kept through a page refresh (lib/draft): a dropped connection doesn't cost the operator the typing.
  const [f, setF, clearF] = useDraft('claim', {
    companyId: '', policyHolderId: '', insurerTenantId: '', channel: 'BROKER', sellingBranchId: '',
    claimType: 'DEATH_ILLNESS', deceasedFullName: '', deceasedNationalCode: '', birthDate: '', eventDate: '', claimedAmount: '', policyNumber: '', description: '',
    startStage: '', brokerTenantId: '', branchId: '', causeOfDeath: '',
  });
  const [causes, setCauses, clearCauses] = useDraft<string[]>('causes', []); // picked items of «علت خسارت»
  const [ins, setIns] = useState<InsurerEntry | null>(null);
  // «اعلام خسارت»: may this operator file, and to which desks may the case go?
  const [notice, setNotice] = useState<{ enabled: boolean; targets: string[]; default: string; labels: Record<string, string> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [caseTypes, setCaseTypes] = useState<Record<string, string>>(CLAIM_TYPE_LABELS);
  // فن‌آوران coverage check on the insured's کد ملی (null: off for this insurer, or the insurer isn't known yet).
  const [coverage, setCoverage] = useState<Coverage | 'checking' | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<Company[]>('/claims/on-behalf/companies', 'org').then(setCompanies).catch(() => setCompanies([]));
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch((e) => setError(e.message));
    client.get<{ id: string; name: string; code: string }[]>('/branches', 'org').then(setBranches).catch(() => {});
    client.get<any>('/claims/notice-options', 'org').then(setNotice).catch(() => setNotice(null));
    client.get<InsurerEntry>('/claims/entry-options', 'org').then(setIns).catch(() => setIns(null)); // 403 for a brokerage
    // Panel 1: only the chosen نوع بیمه‌نامه's نوع پرونده (none yet = filing closed for that kind).
    client.get<{ code: string; label: string }[]>(`/claims/case-types${lineQuery()}`, 'org').then((l) => {
      setCaseTypes(Object.fromEntries(l.map((t) => [t.code, t.label])));
      if (l.length) setF((s) => (l.some((t) => t.code === s.claimType) ? s : { ...s, claimType: l[0].code }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const co = companies.find((c) => c.id === f.companyId) ?? null;
  const manual = f.companyId === NO_COMPANY || companies.length === 0;
  const isDeath = DEATH_TYPES.has(f.claimType);
  const eventLabel = EVENT_DATE_LABEL;
  const age = ageBetween(f.birthDate ? jalaliToIso(f.birthDate) : null, f.eventDate ? jalaliToIso(f.eventDate) : null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  // «علت خسارت»: the insurer's ticks for this نوع پرونده (its own panel 1), plus typed text; Model View may require it.
  const form = ins?.form;
  const causeOptions = form?.causeLists[form.caseTypes.find((t) => t.code === f.claimType)?.causeGroup ?? 'ACCIDENT'] ?? [];
  const picked = causes.filter((c) => causeOptions.includes(c)).slice(0, ins ? 1 : undefined); // an insurer's panel 1: one cause
  // An insurer's panel 1 picks from its list (the typed «علت دیگر» only where the list is empty).
  const typedCause = ins && causeOptions.length > 0 ? '' : f.causeOfDeath.trim();
  const cause = [...picked, typedCause].filter(Boolean).join('، ');
  const causeNotes = form?.causeNotes ?? {};
  // «شرح»: must be written when no علت is picked (an insurer's panel 1).
  const descRequired = !!ins && picked.length === 0;
  const formProblem = () => (form?.cause === 'required' && !cause ? `${CAUSE_LABEL} را انتخاب کنید`
    : form?.birthDate === 'required' && !f.birthDate ? 'تاریخ تولد بیمه‌شده را وارد کنید'
    : descRequired && !f.description.trim() ? `شرح را بنویسید (${CAUSE_LABEL} انتخاب نشده است)`
    : f.description.length > 2000 ? 'شرح طولانی‌تر از ۲۰۰۰ نویسه است؛ آن را کوتاه کنید' : '');
  /**
   * Pick the one «علت خسارت» ('' = none): the previous cause's ready text («متن») leaves «شرح» (if it is
   * still there unchanged) and the new one's comes in; the operator can still edit شرح.
   */
  const pickCause = (c: string) => {
    const old = picked[0] ?? '';
    if (c === old) return;
    setCauses(c ? [c] : []);
    const oldNote = old ? causeNotes[old]?.trim() : '';
    const newNote = c ? causeNotes[c]?.trim() : '';
    if (!oldNote && !newNote) return;
    setF((s) => {
      let d = s.description;
      if (oldNote && d.includes(oldNote)) d = d.replace(oldNote, '').replace(/\n{2,}/g, '\n').trim();
      if (newNote && !d.includes(newNote)) d = d.trim() ? `${d.replace(/\s+$/, '')}\n${newNote}` : newNote;
      return { ...s, description: d };
    });
  };

  /**
   * Ask فن‌آوران about this کد ملی. The insurer that answers: an insurer's own staff → their insurer; a
   * brokerage's → the picked company's بیمه‌نامه on the event date, or the insurer picked by hand.
   */
  const checkCoverage = async (nid = f.deceasedNationalCode) => {
    const code = toAscii(nid).trim();
    const n = ++asked.current;
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    const who = ins ? {} : co ? { companyId: co.id } : manual && f.insurerTenantId ? { insurerTenantId: f.insurerTenantId } : null;
    if (!who || !/^\d{10}$/.test(code)) { setCoverage(null); return; }
    setCoverage('checking');
    const r = await client.post<any>('/claims/coverage-check', { nationalCode: code, ...who, ...(iso ? { eventDate: iso } : {}) }, 'org')
      .catch((e) => ({ enabled: true, status: 'ERROR', blocked: false, message: e.message }));
    if (n !== asked.current) return; // a newer check is on its way
    if (!r?.enabled) { setCoverage(null); return; }
    const name = [r.person?.firstName, r.person?.lastName].filter(Boolean).join(' ');
    setCoverage({ status: r.status, name, message: r.message, blocked: !!r.blocked, policy: r.policy ?? null });
    if (r.autoFill && name) setF((s) => (s.deceasedFullName.trim() ? s : { ...s, deceasedFullName: name }));
  };
  // Another company / insurer / event date can change the answer.
  useEffect(() => { if (/^\d{10}$/.test(toAscii(f.deceasedNationalCode).trim())) checkCoverage(); /* eslint-disable-next-line */ }, [f.companyId, f.insurerTenantId, f.eventDate, !!ins]);
  const coverageStop = () => (coverage === 'checking' ? 'استعلام کد ملی از سامانهٔ بیمه‌گر هنوز تمام نشده است' : coverage?.blocked ? coverageText(coverage) : '');

  // Insurer: where this case starts — fixed by Model View, or the operator's choice («هر بار انتخاب شود»).
  const insBroker = ins?.brokers.find((b) => b.id === f.brokerTenantId) ?? null;
  const insStart = ins ? (ins.way === 'ASK' ? (f.startStage || (insBroker ? 'BROKER' : 'BRANCH')) : ins.way) : null;

  const submitInsurer = async () => {
    setError('');
    if (!ins) return;
    if (coverageStop()) return setError(coverageStop());
    if (insStart === 'BROKER' && !insBroker) return setError('پرونده به میز کارگزاری می‌رود؛ کارگزاری را انتخاب کنید');
    if (!insBroker && !f.sellingBranchId) return setError('واحد صدور را انتخاب کنید');
    if (insStart === 'BRANCH' && insBroker && !f.branchId && !ins.myBranchId) return setError('شعبه‌ای را که پرونده به آن می‌رود انتخاب کنید');
    if (formProblem()) return setError(formProblem());
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        channel: insBroker ? 'BROKER' : 'DIRECT', claimType: f.claimType, startStage: insStart!, ...(getLine() ? { line: getLine()! } : {}),
        deceasedFullName: f.deceasedFullName.trim(), deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
        claimedAmount: toAscii(f.claimedAmount).replace(/[^\d]/g, '') || '0',
      };
      if (insBroker) { payload.brokerTenantId = insBroker.id; if (f.companyId) payload.policyholderCompanyId = f.companyId; }
      else payload.sellingBranchId = f.sellingBranchId;
      if (insStart === 'BRANCH' && f.branchId && !ins.myBranchId) payload.branchId = f.branchId; // else: the operator's own شعبه
      if (cause) payload.causeOfDeath = cause;
      if (iso) payload.eventDate = iso;
      if (birthIso) payload.deceasedBirthDate = birthIso;
      if (f.policyNumber.trim()) payload.policyNumber = toAscii(f.policyNumber).trim();
      if (f.description.trim()) payload.description = f.description.trim();
      const c = await client.post<{ id: string }>('/claims', payload, 'org');
      clearF(); clearCauses();
      router.push(`/org/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const submit = async () => {
    if (ins) return submitInsurer();
    setError('');
    if (coverageStop()) return setError(coverageStop());
    if (!manual && !co) return setError('شرکت بیمه‌گزار را انتخاب کنید (یا «بدون شرکت بیمه‌گزار»)');
    if (manual && !f.insurerTenantId) return setError('بیمه‌گر را انتخاب کنید');
    if (manual && f.channel === 'DIRECT' && !f.sellingBranchId) return setError('شعبه فروش را انتخاب کنید');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    if (co && !iso) return setError(`${eventLabel} را وارد کنید؛ بیمه‌گر بر اساس قرارداد معتبر در این تاریخ تعیین می‌شود`);
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        channel: manual ? f.channel : 'BROKER',
        claimType: f.claimType,
        ...(getLine() ? { line: getLine()! } : {}),
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
        claimedAmount: toAscii(f.claimedAmount).replace(/[^\d]/g, '') || '0',
      };
      if (co) { payload.policyholderCompanyId = co.id; if (f.policyHolderId) payload.policyHolderId = f.policyHolderId; }
      else { payload.insurerTenantId = f.insurerTenantId; if (f.channel === 'DIRECT') payload.sellingBranchId = f.sellingBranchId; }
      if (iso) payload.eventDate = iso;
      if (birthIso) payload.deceasedBirthDate = birthIso;
      if (f.policyNumber.trim()) payload.policyNumber = toAscii(f.policyNumber).trim();
      if (f.description.trim()) payload.description = f.description.trim();
      if (f.startStage) payload.startStage = f.startStage;
      if (cause) payload.causeOfDeath = cause;
      const c = await client.post<{ id: string }>('/claims', payload, 'org');
      clearF(); clearCauses();
      router.push(`/org/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell title="ثبت پرونده خسارت" breadcrumb="پرونده جدید" sectionLabel="خسارت عمر و حادثه" nav={ORG_NAV} realm="org">
      <div className="pcard p-5 pform">
        <div className="pinfobox mb-3 text-center">
          پس از ثبت پرونده، مدارک موردنیاز را در صفحهٔ پرونده بارگذاری کنید. لطفاً مشخصات بیمه‌شدهٔ متوفی و نوع پرونده را با دقت وارد نمایید.
          <div className="text-xs font-normal">
            {ins ? null : co
              ? <>پرونده برای «{co.name}» ثبت می‌شود و در پنل این بیمه‌گزار هم دیده می‌شود؛ بیمه‌گر از روی قرارداد شرکت{co.contracts.length ? ` (${co.contracts.map((k) => k.insurerName).join('، ')})` : ''} در {eventLabel} تعیین می‌شود.</>
              : manual ? <>پرونده بدون شرکت بیمه‌گزار ثبت می‌شود؛ بیمه‌گر و کانال فروش را خودتان انتخاب کنید.</> : null}
          </div>
        </div>

        <ErrorBox message={error} />
        {notice && !notice.enabled && <div className="alert-error mt-3">اعلام خسارت برای شما در «تنظیمات سازمان › اعلام خسارت» غیرفعال است.</div>}
        {Object.keys(caseTypes).length === 0 && <div className="alert-error mt-3">برای این نوع بیمه‌نامه هنوز نوع پرونده‌ای در Model View تعریف نشده است؛ نوع بیمه‌نامه را از نوار بالا عوض کنید.</div>}

        <div className={`grid md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5 mt-3${ins ? ' red-stars' : ''}`}>
          {ins && (
            <PField label="شماره بیمه‌نامه" help="اختیاری.">
              <input className="input" value={f.policyNumber} onChange={set('policyNumber')} autoFocus style={{ direction: 'ltr', textAlign: 'right' }} />
            </PField>
          )}
          {/* کد ملی first: the insurer's system (فن‌آوران) checks this person and their بیمه‌نامه before anything else. */}
          <PField label="کد ملی بیمه‌شده *" help="ابتدا کد ملی ۱۰ رقمی بیمه‌شده را وارد کنید؛ سامانهٔ بیمه‌گر (فن‌آوران) بررسی می‌کند این فرد و بیمه‌نامه و بازهٔ آن تعریف شده باشد؛ در غیر این صورت پرونده برای پرداخت خسارت ثبت نمی‌شود.">
            <input className="input" value={f.deceasedNationalCode} autoFocus={!ins} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }}
              onChange={(e) => {
                const v = e.target.value;
                setF((s) => ({ ...s, deceasedNationalCode: v }));
                if (/^\d{10}$/.test(toAscii(v).trim())) checkCoverage(v);
                else if (coverage) { asked.current++; setCoverage(null); }
              }} />
            <CoverageNote c={coverage} />
          </PField>
          {ins && (
            <>
              <PField label="معرف" help="کارگزاری‌ای که پرونده برای آن ثبت می‌شود (با کد کارگزار)؛ برای فروش مستقیم بیمه‌گر «بدون کارگزاری» را انتخاب کنید.">
                <select className="input" value={f.brokerTenantId} onChange={(e) => setF((s) => ({ ...s, brokerTenantId: e.target.value, companyId: '', sellingBranchId: '', startStage: '' }))}>
                  <option value="">— بدون کارگزاری (فروش مستقیم بیمه‌گر) —</option>
                  {ins.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.code ? ` ${b.code}` : ''}</option>)}
                </select>
              </PField>
              {insBroker ? (
                <PField label="بیمه‌گزار (شرکت)" help="اختیاری؛ پرونده در پنل همین بیمه‌گزار هم دیده می‌شود و شماره بیمه‌نامه از قرارداد آن برداشته می‌شود.">
                  <SearchPick label="بیمه‌گزار (شرکت)" options={insBroker.companies} value={f.companyId} onPick={(id) => setF((s) => ({ ...s, companyId: id }))}
                    placeholder="نام بیمه‌گزار را تایپ کنید…" none="— بدون شرکت بیمه‌گزار —" />
                </PField>
              ) : (
                <PField label="واحد صدور *">
                  <select className="input" value={f.sellingBranchId} onChange={set('sellingBranchId')}>
                    <option value="">— انتخاب واحد صدور —</option>
                    {ins.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                </PField>
              )}
              {ins.way === 'ASK' && (
                <PField label="پرونده پس از ثبت به" help="راهی که مدیر سامانه برای این بیمه‌گر گذاشته: هر بار انتخاب شود.">
                  <select className="input" value={insStart ?? ''} onChange={set('startStage')}>
                    {insBroker && <option value="BROKER">میز کارگزاری (ارزیابی اولیه)</option>}
                    <option value="BRANCH">مستقیم به شعبه</option>
                  </select>
                </PField>
              )}
              {/* The operator's own شعبه handles what they file; only an operator outside a شعبه picks one. */}
              {insStart === 'BRANCH' && !ins.myBranchId && (
                <PField label={`شعبهٔ رسیدگی${insBroker ? ' *' : ''}`} help={insBroker ? undefined : 'خالی = همان واحد صدور.'}>
                  <select className="input" value={f.branchId} onChange={set('branchId')}>
                    <option value="">{insBroker ? '— انتخاب شعبه —' : '— همان واحد صدور —'}</option>
                    {ins.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                </PField>
              )}
              <div className="md:col-span-2 lg:col-span-3 text-xs" style={{ color: 'var(--muted)' }}>
                {insStart === 'BROKER' ? 'پرونده پس از ثبت به میز همان کارگزاری می‌رود و ارزیابی اولیه از آنجا شروع می‌شود.' : (ins.myBranchId ? 'پرونده پس از ثبت مستقیم به همین شعبه می‌رود.' : 'پرونده پس از ثبت مستقیم به شعبه می‌رود.')}
              </div>
            </>
          )}
          {!ins && companies.length > 0 && (
            <PField label="بیمه‌گزار (شرکت) *" help="شرکتی که متوفی در آن شاغل بوده است؛ پرونده در پنل همین بیمه‌گزار هم نمایش داده می‌شود.">
              <select className="input" value={f.companyId} onChange={(e) => setF((s) => ({ ...s, companyId: e.target.value, policyHolderId: '' }))}>
                <option value="">— انتخاب شرکت بیمه‌گزار —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.currentInsurer ? ` — ${c.currentInsurer.name}` : ''}</option>)}
                <option value={NO_COMPANY}>بدون شرکت بیمه‌گزار (انتخاب دستی بیمه‌گر)</option>
              </select>
            </PField>
          )}
          {!ins && co && co.accounts.length > 0 && (
            <PField label="نمایندهٔ بیمه‌گزار" help="اختیاری؛ نماینده پرونده را در پنل خود می‌بیند و برای رفع نقص پیام دریافت می‌کند.">
              <select className="input" value={f.policyHolderId} onChange={set('policyHolderId')}>
                <option value="">— بدون نماینده —</option>
                {co.accounts.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
            </PField>
          )}
          {!ins && manual && (
            <>
              <PField label="بیمه‌گر *">
                <select className="input" value={f.insurerTenantId} onChange={set('insurerTenantId')}>
                  <option value="">— انتخاب بیمه‌گر —</option>
                  {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </PField>
              <PField label="کانال فروش">
                <select className="input" value={f.channel} onChange={(e) => setF((s) => ({ ...s, channel: e.target.value, sellingBranchId: '' }))}>
                  <option value="BROKER">از طریق نمایندگی / کارگزاری</option>
                  <option value="DIRECT">فروش مستقیم بیمه‌گر</option>
                </select>
              </PField>
              {f.channel === 'DIRECT' && (
                <PField label="شعبه فروش *">
                  <select className="input" value={f.sellingBranchId} onChange={set('sellingBranchId')}>
                    <option value="">— انتخاب شعبه —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                </PField>
              )}
            </>
          )}

          <PField label={`${insuredNameLabel()} *`}>
            <input className="input" value={f.deceasedFullName} onChange={set('deceasedFullName')} />
          </PField>
          <PField label="نوع پرونده *" help="نوع خسارت را مشخص کنید.">
            <select className="input" value={f.claimType} onChange={set('claimType')}>
              {Object.entries(caseTypes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </PField>
          {form?.birthDate !== 'hidden' && <PField label={`تاریخ تولد بیمه‌شده (شمسی)${form?.birthDate === 'required' ? ' *' : ''}`} help="سن بیمه‌شده به‌طور خودکار محاسبه می‌شود.">
            <JalaliDatePicker value={f.birthDate} onChange={(v) => setF((s) => ({ ...s, birthDate: v }))} placeholder="۱۳۴۵/۰۵/۱۲" />
          </PField>}
          <PField label={`${ins ? 'تاریخ حادثه' : `${eventLabel} (شمسی)`}${co ? ' *' : ''}`}>
            <JalaliDatePicker value={f.eventDate} onChange={(v) => setF((s) => ({ ...s, eventDate: v }))} placeholder="۱۴۰۵/۰۷/۰۱" />
          </PField>
          <PField label={isDeath ? 'سن متوفی (هنگام فوت)' : 'سن بیمه‌شده (هنگام حادثه)'}>
            <input className="input" readOnly value={age != null ? `${age.toLocaleString('fa-IR')} سال` : ''} placeholder="(پس از ورود تاریخ‌ها)" style={{ background: 'var(--surface-2)' }} />
          </PField>
          <PField label={ins ? 'مبلغ برآورد خسارت' : 'مبلغ خسارت برآوردی (ریال)'} help={`اختیاری؛ ${ins ? 'به ریال؛ ' : ''}مبلغ قطعی پس از ارزیابی ثبت می‌شود.`}>
            <input className="input" inputMode="numeric" value={groupDigits(f.claimedAmount)} onChange={(e) => setF((s) => ({ ...s, claimedAmount: toAscii(e.target.value).replace(/[^\d]/g, '') }))} placeholder="۰" style={{ direction: 'ltr', textAlign: 'right' }} />
          </PField>
          {!ins && notice && notice.enabled && notice.targets.length > 1 && (
            <PField label="ارسال پرونده پس از ثبت به" help="مرحله‌هایی که در «تنظیمات سازمان › اعلام خسارت» مجاز شده‌اند.">
              <select className="input" value={f.startStage || notice.default} onChange={set('startStage')}>
                {notice.targets.filter((t) => t !== 'BROKER' || !manual || f.channel === 'BROKER').map((t) => <option key={t} value={t}>{notice.labels[t] ?? t}</option>)}
              </select>
            </PField>
          )}
          {!ins && (
            <PField label="شماره بیمه‌نامه" help={co ? 'اگر خالی بماند از قرارداد شرکت برداشته می‌شود.' : 'اختیاری.'}>
              <input className="input" value={f.policyNumber} onChange={set('policyNumber')} style={{ direction: 'ltr', textAlign: 'right' }} />
            </PField>
          )}

          {form?.cause !== 'hidden' && (
            <div className="md:col-span-2 lg:col-span-3"><PField label={`${CAUSE_LABEL}${form?.cause === 'required' ? ' *' : ''}`} help={ins && causeOptions.length ? 'یک علت را تایپ کنید یا از فهرست انتخاب کنید؛ متن آمادهٔ آن به «شرح» افزوده می‌شود و می‌توانید آن را ویرایش کنید.' : 'علت را همان‌طور که می‌دانید بنویسید؛ مثلاً «ایست قلبی»، «تصادف رانندگی» یا «سقوط از ارتفاع».'}>
              {ins && causeOptions.length > 0 && (
                <SearchPick label="علت خسارت" options={causeOptions.map((c) => ({ id: c, name: c }))} value={picked[0] ?? ''} onPick={pickCause}
                  placeholder="علت خسارت را تایپ یا از فهرست انتخاب کنید…" none="— انتخاب نشده —" badge={(c) => (causeNotes[c] ? 'متن آماده' : null)} />
              )}
              {!ins && causeOptions.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 mb-2">
                  {causeOptions.map((c) => (
                    <label key={c} className="flex items-start gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={causes.includes(c)} onChange={(e) => setCauses(e.target.checked ? [...causes, c] : causes.filter((x) => x !== c))} /> {c}
                    </label>
                  ))}
                </div>
              )}
              {!(ins && causeOptions.length > 0) && <input className="input" value={f.causeOfDeath} onChange={set('causeOfDeath')} maxLength={300} placeholder={causeOptions.length > 0 ? 'علت دیگر (تایپ کنید)…' : 'شرح علت'} />}
            </PField></div>
          )}
        </div>

        <div className={`mt-2.5${ins ? ' red-stars' : ''}`}>
          <label className="label">{ins ? <>شرح{descRequired && <> <span className="req-star">*</span></>}</> : 'توضیحات (اختیاری)'}</label>
          <textarea className="input" rows={ins ? 4 : 2} value={f.description} onChange={set('description')} maxLength={2000}
            placeholder={ins ? (descRequired ? `${CAUSE_LABEL} انتخاب نشده است؛ شرح حادثه را بنویسید.` : 'متن آمادهٔ علت انتخاب‌شده اینجا می‌آید؛ می‌توانید آن را ویرایش یا تکمیل کنید.') : 'هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه یا موارد خاص پرونده.'} />
        </div>

        <div className="flex justify-center mt-3">
          <button onClick={submit} disabled={busy || coverage === 'checking' || !!(coverage && coverage.blocked) || Object.keys(caseTypes).length === 0 || !f.deceasedFullName.trim() || !f.deceasedNationalCode.trim()} className="btn btn-solid btn-solid-lg">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
