'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken, hasPerm } from '../../../../lib/client';
import { Shell, Icon } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, Field, Spinner } from '../../../components/ui';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';
import { LogoTile } from '../../../components/LogoTile';
import { ORG_NAV } from '../../nav';

interface Company {
  id: string; name: string; hasLogo: boolean; currentInsurer: { id: string; name: string } | null;
  contracts: { insurerName: string; policyNumber: string | null; startDate: string | null; endDate: string | null; isCurrent: boolean }[];
  accounts: { id: string; fullName: string }[];
}

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);
function jalaliToIso(input: string): string | null {
  const parts = toAscii(input).split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(parts[0], parts[1], parts[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * «ثبت پرونده به جای بیمه‌گزار» — for کارگزاری staff holding claim:file-on-behalf: pick any بیمه‌گزار
 * company, open the case for it, then upload the documents on the case page and send it on.
 */
export default function FileOnBehalf() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [q, setQ] = useState('');
  const [co, setCo] = useState<Company | null>(null);
  const [f, setF] = useState({ policyHolderId: '', claimType: 'DEATH_ILLNESS', eventDate: '', birthDate: '', deceasedFullName: '', deceasedNationalCode: '', claimedAmount: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    if (!hasPerm('org', 'claim:file-on-behalf')) { setAllowed(false); return; }
    client.get<Company[]>('/claims/on-behalf/companies', 'org').then(setCompanies).catch((e) => { setError(e.message); setCompanies([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (companies || []).filter((c) => !q.trim() || c.name.includes(q.trim())), [companies, q]);
  const isDeath = DEATH_TYPES.has(f.claimType);
  const eventLabel = isDeath ? 'تاریخ فوت' : 'تاریخ وقوع حادثه';

  const submit = async () => {
    if (!co) return;
    setError('');
    const iso = jalaliToIso(f.eventDate);
    if (!iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        policyholderCompanyId: co.id, claimType: f.claimType, eventDate: iso,
        deceasedFullName: f.deceasedFullName.trim(), deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
      };
      if (birthIso) payload.deceasedBirthDate = birthIso;
      if (f.policyHolderId) payload.policyHolderId = f.policyHolderId;
      const amount = toAscii(f.claimedAmount).replace(/[^\d]/g, '');
      if (amount) payload.claimedAmount = amount;
      if (f.description.trim()) payload.description = f.description.trim();
      const c = await client.post<{ id: string }>('/claims/on-behalf', payload, 'org');
      router.push(`/org/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const logo = (c: Company, size: number) => c.hasLogo
    ? <LogoTile src={`${client.base}/policyholder-companies/${c.id}/logo`} size={size} />
    : <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: size, height: size, background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon path="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01" /></span>;

  return (
    <Shell title="ثبت پرونده به جای بیمه‌گزار" subtitle="کارگزاری پرونده را برای شرکت بیمه‌گزار ثبت و مدارک را بارگذاری می‌کند" nav={ORG_NAV} realm="org">
      {!allowed ? (
        <div className="card p-6 text-center" style={{ color: 'var(--muted)' }}>این بخش به دسترسی «ثبت پرونده به جای بیمه‌گزار» (claim:file-on-behalf) نیاز دارد.</div>
      ) : !co ? (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="font-extrabold">۱. شرکت بیمه‌گزار را انتخاب کنید</h2>
            <input className="input" style={{ maxWidth: 280 }} placeholder="جستجوی نام شرکت…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ErrorBox message={error} />
          {companies === null ? <div className="py-10 text-center"><Spinner /></div>
            : shown.length === 0 ? <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>شرکتی یافت نشد — از «بیمه‌گزاران» شرکت و قرارداد آن را ثبت کنید.</div>
            : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {shown.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setCo(c); setF((x) => ({ ...x, policyHolderId: c.accounts.length === 1 ? c.accounts[0].id : '' })); }}
                    className="obh-co" disabled={!c.contracts.length} title={c.contracts.length ? 'انتخاب این شرکت' : 'این شرکت قرارداد فعالی ندارد'}>
                    {logo(c, 46)}
                    <span className="min-w-0 flex-1 text-right">
                      <span className="block font-bold truncate">{c.name}</span>
                      <span className="block text-xs mt-0.5" style={{ color: c.currentInsurer ? 'var(--muted)' : 'var(--danger)' }}>
                        {c.currentInsurer ? `بیمه‌گر فعلی: ${c.currentInsurer.name}` : c.contracts.length ? 'قرارداد جاری ندارد' : 'بدون قرارداد فعال'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
        </div>
      ) : (
        <div className="card p-5 max-w-3xl mx-auto space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {logo(co, 52)}
            <div className="min-w-0 flex-1">
              <div className="text-xs" style={{ color: 'var(--muted)' }}>۲. مشخصات پرونده برای</div>
              <div className="font-extrabold text-lg">{co.name}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCo(null)}>تغییر شرکت</button>
          </div>
          <div className="pinfobox text-sm">
            بیمه‌گر از روی قرارداد شرکت که در {eventLabel} معتبر بوده تعیین می‌شود
            {co.contracts.length ? <>: {co.contracts.map((k) => `${k.insurerName}${k.policyNumber ? ` (بیمه‌نامهٔ ${k.policyNumber})` : ''}`).join('، ')}</> : null}.
            پس از ثبت، مدارک را در صفحهٔ پرونده بارگذاری و پرونده را «ارسال به کارگزاری» کنید.
          </div>
          <ErrorBox message={error} />
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="نمایندهٔ بیمه‌گزار (اختیاری)">
              <select className="input" value={f.policyHolderId} onChange={(e) => setF({ ...f, policyHolderId: e.target.value })}>
                <option value="">— بدون نماینده —</option>
                {co.accounts.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
              </select>
              <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>نماینده پرونده را در پنل خود هم می‌بیند.</p>
            </Field>
            <Field label="نوع پرونده">
              <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
                {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="نام بیمه‌شده (متوفی) *"><input className="input" value={f.deceasedFullName} onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })} /></Field>
            <Field label="کد ملی بیمه‌شده *"><input className="input" inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} value={f.deceasedNationalCode} onChange={(e) => setF({ ...f, deceasedNationalCode: e.target.value })} /></Field>
            <Field label="تاریخ تولد بیمه‌شده"><JalaliDatePicker value={f.birthDate} onChange={(v) => setF({ ...f, birthDate: v })} placeholder="۱۳۴۵/۰۵/۱۲" /></Field>
            <Field label={`${eventLabel} *`}><JalaliDatePicker value={f.eventDate} onChange={(v) => setF({ ...f, eventDate: v })} placeholder="۱۴۰۵/۰۷/۰۱" /></Field>
            <Field label="مبلغ خسارت برآوردی (ریال، اختیاری)"><input className="input" inputMode="numeric" value={toAscii(f.claimedAmount).replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '٬')} onChange={(e) => setF({ ...f, claimedAmount: toAscii(e.target.value).replace(/[^\d]/g, '') })} placeholder="۰" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          </div>
          <Field label="توضیحات (اختیاری)"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <button onClick={submit} disabled={busy || !f.deceasedFullName.trim() || !f.deceasedNationalCode.trim() || !f.eventDate} className="btn btn-primary w-full">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      )}
    </Shell>
  );
}
