'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, Field } from '../../../components/ui';
import { ORG_NAV } from '../../nav';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** Parse a Jalali date "YYYY/MM/DD" (Persian or ASCII digits) to an ISO string, or null. */
function jalaliToIso(input: string): string | null {
  const parts = toAscii(input).split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(parts[0], parts[1], parts[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewClaim() {
  const router = useRouter();
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ insurerTenantId: '', claimType: 'DEATH_ILLNESS', eventDate: '', deceasedFullName: '', deceasedNationalCode: '', claimedAmount: '', policyNumber: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch((e) => setError(e.message));
  }, []);

  const submit = async () => {
    setError('');
    if (!f.insurerTenantId) return setError('بیمه‌گر را انتخاب کنید');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError('تاریخ وقوع نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)');
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        insurerTenantId: f.insurerTenantId,
        channel: 'BROKER',
        claimType: f.claimType,
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
        claimedAmount: toAscii(f.claimedAmount).replace(/[^\d]/g, ''),
      };
      if (iso) payload.eventDate = iso;
      if (f.policyNumber.trim()) payload.policyNumber = f.policyNumber.trim();
      const c = await client.post<{ id: string }>('/claims', payload, 'org');
      router.push(`/org/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Shell title="ثبت پرونده خسارت" subtitle="بارگذاری دیجیتال اعلام خسارت و مدارک متوفی/بیمه‌شده" nav={ORG_NAV} realm="org">
      <div className="card p-5 max-w-xl space-y-4">
        <ErrorBox message={error} />
        <Field label="بیمه‌گر">
          <select className="input" value={f.insurerTenantId} onChange={(e) => setF({ ...f, insurerTenantId: e.target.value })}>
            <option value="">— انتخاب بیمه‌گر —</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="نوع پرونده">
          <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
            {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="تاریخ وقوع (شمسی)"><input className="input" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} placeholder="۱۴۰۵/۰۷/۰۱" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="نام بیمه‌شده (متوفی)"><input className="input" value={f.deceasedFullName} onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })} /></Field>
        <Field label="کد ملی بیمه‌شده"><input className="input" value={f.deceasedNationalCode} onChange={(e) => setF({ ...f, deceasedNationalCode: e.target.value })} inputMode="numeric" /></Field>
        <Field label="مبلغ خسارت (ریال)"><input className="input" value={f.claimedAmount} onChange={(e) => setF({ ...f, claimedAmount: e.target.value })} inputMode="numeric" /></Field>
        <Field label="شماره بیمه‌نامه (اختیاری)"><input className="input" value={f.policyNumber} onChange={(e) => setF({ ...f, policyNumber: e.target.value })} /></Field>
        <button onClick={submit} disabled={busy || !f.deceasedFullName || !f.deceasedNationalCode || !f.claimedAmount} className="btn btn-primary w-full">{busy ? '…' : 'ثبت پرونده'}</button>
      </div>
    </Shell>
  );
}
