'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox } from '../../../components/ui';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';
import { ORG_NAV } from '../../nav';
import { EMPTY_HEIRS, HeirsFields, heirsBody, heirsProblem, uploadHeirsForm } from '../../../components/heirs';

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
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        {help && <span className="phelp" title={help}>؟</span>}
      </div>
    </div>
  );
}

/**
 * «پرونده جدید» (from the Work Desk header) — the بیمه‌گزار panel's filing form, for staff. Picking the
 * بیمه‌گزار company routes the case by its insurer contract and shows it in that company's panel; for a
 * case without a company the insurer and sales channel are chosen by hand.
 */
export default function NewClaim() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [f, setF] = useState({
    companyId: '', policyHolderId: '', insurerTenantId: '', channel: 'BROKER', sellingBranchId: '',
    claimType: 'DEATH_ILLNESS', deceasedFullName: '', deceasedNationalCode: '', birthDate: '', eventDate: '', claimedAmount: '', policyNumber: '', description: '',
    startStage: '',
  });
  // «اعلام خسارت»: may this operator file, and to which desks may the case go?
  const [notice, setNotice] = useState<{ enabled: boolean; targets: string[]; default: string; labels: Record<string, string> } | null>(null);
  const [heirs, setHeirs] = useState(EMPTY_HEIRS);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<Company[]>('/claims/on-behalf/companies', 'org').then(setCompanies).catch(() => setCompanies([]));
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch((e) => setError(e.message));
    client.get<{ id: string; name: string; code: string }[]>('/branches', 'org').then(setBranches).catch(() => {});
    client.get<any>('/claims/notice-options', 'org').then(setNotice).catch(() => setNotice(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const co = companies.find((c) => c.id === f.companyId) ?? null;
  const manual = f.companyId === NO_COMPANY || companies.length === 0;
  const isDeath = DEATH_TYPES.has(f.claimType);
  const eventLabel = isDeath ? 'تاریخ فوت' : 'تاریخ وقوع حادثه';
  const age = ageBetween(f.birthDate ? jalaliToIso(f.birthDate) : null, f.eventDate ? jalaliToIso(f.eventDate) : null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (!manual && !co) return setError('شرکت بیمه‌گزار را انتخاب کنید (یا «بدون شرکت بیمه‌گزار»)');
    if (manual && !f.insurerTenantId) return setError('بیمه‌گر را انتخاب کنید');
    if (manual && f.channel === 'DIRECT' && !f.sellingBranchId) return setError('شعبه فروش را انتخاب کنید');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    if (co && !iso) return setError(`${eventLabel} را وارد کنید؛ بیمه‌گر بر اساس قرارداد معتبر در این تاریخ تعیین می‌شود`);
    const hp = heirsProblem(heirs);
    if (hp) return setError(hp);
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        channel: manual ? f.channel : 'BROKER',
        claimType: f.claimType,
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
      const c = await client.post<{ id: string }>('/claims', { ...payload, ...heirsBody(heirs) }, 'org');
      await uploadHeirsForm(heirs, c.id, 'org').catch(() => window.alert('پرونده ثبت شد اما فرم ذینفع بارگذاری نشد؛ آن را در صفحهٔ پرونده، بخش «ذینفع / وراث قانونی» دوباره بارگذاری کنید.'));
      router.push(`/org/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell title="ثبت پرونده خسارت" breadcrumb="پرونده جدید" sectionLabel="خسارت عمر و حادثه" nav={ORG_NAV} realm="org">
      <div className="pcard p-6 md:p-8 pform max-w-4xl mx-auto">
        <div className="pinfobox mb-6 text-center">
          پس از ثبت پرونده، مدارک موردنیاز را در صفحهٔ پرونده بارگذاری کنید. لطفاً مشخصات بیمه‌شدهٔ متوفی و نوع پرونده را با دقت وارد نمایید.
          <div className="text-xs mt-1 font-normal">
            {co
              ? <>پرونده برای «{co.name}» ثبت می‌شود و در پنل این بیمه‌گزار هم دیده می‌شود؛ بیمه‌گر از روی قرارداد شرکت{co.contracts.length ? ` (${co.contracts.map((k) => k.insurerName).join('، ')})` : ''} در {eventLabel} تعیین می‌شود.</>
              : manual ? <>پرونده بدون شرکت بیمه‌گزار ثبت می‌شود؛ بیمه‌گر و کانال فروش را خودتان انتخاب کنید.</> : null}
          </div>
        </div>

        <ErrorBox message={error} />
        {notice && !notice.enabled && <div className="alert-error mt-3">اعلام خسارت برای شما در «تنظیمات سازمان › اعلام خسارت» غیرفعال است.</div>}

        <div className="grid md:grid-cols-2 gap-5 mt-4">
          {companies.length > 0 && (
            <PField label="بیمه‌گزار (شرکت) *" help="شرکتی که متوفی در آن شاغل بوده است؛ پرونده در پنل همین بیمه‌گزار هم نمایش داده می‌شود.">
              <select className="input" value={f.companyId} onChange={(e) => setF((s) => ({ ...s, companyId: e.target.value, policyHolderId: '' }))}>
                <option value="">— انتخاب شرکت بیمه‌گزار —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.currentInsurer ? ` — ${c.currentInsurer.name}` : ''}</option>)}
                <option value={NO_COMPANY}>بدون شرکت بیمه‌گزار (انتخاب دستی بیمه‌گر)</option>
              </select>
            </PField>
          )}
          {co && co.accounts.length > 0 && (
            <PField label="نمایندهٔ بیمه‌گزار" help="اختیاری؛ نماینده پرونده را در پنل خود می‌بیند و برای رفع نقص پیام دریافت می‌کند.">
              <select className="input" value={f.policyHolderId} onChange={set('policyHolderId')}>
                <option value="">— بدون نماینده —</option>
                {co.accounts.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
            </PField>
          )}
          {manual && (
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

          <PField label="نوع پرونده *" help="علت فوت یا نوع خسارت را مشخص کنید.">
            <select className="input" value={f.claimType} onChange={set('claimType')}>
              {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </PField>
          <PField label="نام بیمه‌شده (متوفی) *">
            <input className="input" value={f.deceasedFullName} onChange={set('deceasedFullName')} />
          </PField>
          <PField label="کد ملی بیمه‌شده *" help="کد ملی ۱۰ رقمی بیمه‌شدهٔ متوفی.">
            <input className="input" value={f.deceasedNationalCode} onChange={set('deceasedNationalCode')} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} />
          </PField>
          <PField label="تاریخ تولد بیمه‌شده (شمسی)" help="سن متوفی به‌طور خودکار محاسبه می‌شود.">
            <JalaliDatePicker value={f.birthDate} onChange={(v) => setF((s) => ({ ...s, birthDate: v }))} placeholder="۱۳۴۵/۰۵/۱۲" />
          </PField>
          <PField label={`${eventLabel} (شمسی)${co ? ' *' : ''}`}>
            <JalaliDatePicker value={f.eventDate} onChange={(v) => setF((s) => ({ ...s, eventDate: v }))} placeholder="۱۴۰۵/۰۷/۰۱" />
          </PField>
          <PField label={isDeath ? 'سن متوفی (هنگام فوت)' : 'سن بیمه‌شده (هنگام حادثه)'}>
            <input className="input" readOnly value={age != null ? `${age.toLocaleString('fa-IR')} سال` : ''} placeholder="(پس از ورود تاریخ‌ها)" style={{ background: 'var(--surface-2)' }} />
          </PField>
          <PField label="مبلغ خسارت برآوردی (ریال)" help="اختیاری؛ مبلغ قطعی پس از ارزیابی ثبت می‌شود.">
            <input className="input" inputMode="numeric" value={groupDigits(f.claimedAmount)} onChange={(e) => setF((s) => ({ ...s, claimedAmount: toAscii(e.target.value).replace(/[^\d]/g, '') }))} placeholder="۰" style={{ direction: 'ltr', textAlign: 'right' }} />
          </PField>
          {notice && notice.enabled && notice.targets.length > 1 && (
            <PField label="ارسال پرونده پس از ثبت به" help="مرحله‌هایی که در «تنظیمات سازمان › اعلام خسارت» مجاز شده‌اند.">
              <select className="input" value={f.startStage || notice.default} onChange={set('startStage')}>
                {notice.targets.filter((t) => t !== 'BROKER' || !manual || f.channel === 'BROKER').map((t) => <option key={t} value={t}>{notice.labels[t] ?? t}</option>)}
              </select>
            </PField>
          )}
          <PField label="شماره بیمه‌نامه" help={co ? 'اگر خالی بماند از قرارداد شرکت برداشته می‌شود.' : 'اختیاری.'}>
            <input className="input" value={f.policyNumber} onChange={set('policyNumber')} style={{ direction: 'ltr', textAlign: 'right' }} />
          </PField>
        </div>

        <HeirsFields value={heirs} onChange={setHeirs} />

        <div className="mt-5">
          <label className="label">توضیحات (اختیاری)</label>
          <textarea className="input" rows={4} value={f.description} onChange={set('description')} placeholder="هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه یا موارد خاص پرونده." />
        </div>

        <div className="flex justify-center mt-8">
          <button onClick={submit} disabled={busy || !f.deceasedFullName.trim() || !f.deceasedNationalCode.trim()} className="btn btn-solid btn-solid-lg">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
