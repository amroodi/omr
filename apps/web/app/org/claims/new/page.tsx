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
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [f, setF] = useState({ insurerTenantId: '', channel: 'BROKER', sellingBranchId: '', claimType: 'DEATH_ILLNESS', eventDate: '', deceasedFullName: '', deceasedNationalCode: '', claimedAmount: '', policyNumber: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch((e) => setError(e.message));
    client.get<{ id: string; name: string; code: string }[]>('/branches', 'org').then(setBranches).catch(() => {});
  }, []);

  const submit = async () => {
    setError('');
    if (!f.insurerTenantId) return setError('بیمه‌گر را انتخاب کنید');
    if (f.channel === 'DIRECT' && !f.sellingBranchId) return setError('شعبه فروش را انتخاب کنید');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError('تاریخ وقوع نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)');
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        insurerTenantId: f.insurerTenantId,
        channel: f.channel,
        claimType: f.claimType,
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
        claimedAmount: toAscii(f.claimedAmount).replace(/[^\d]/g, ''),
      };
      if (f.channel === 'DIRECT' && f.sellingBranchId) payload.sellingBranchId = f.sellingBranchId;
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
        <Field label="کانال فروش">
          <div className="flex gap-2">
            {[['BROKER', 'از طریق نمایندگی/کارگزاری'], ['DIRECT', 'فروش مستقیم بیمه‌گر']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, channel: v, sellingBranchId: v === 'BROKER' ? '' : f.sellingBranchId })} className="btn btn-sm flex-1" style={f.channel === v ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>{l}</button>
            ))}
          </div>
        </Field>
        <Field label="بیمه‌گر">
          <select className="input" value={f.insurerTenantId} onChange={(e) => setF({ ...f, insurerTenantId: e.target.value })}>
            <option value="">— انتخاب بیمه‌گر —</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        {f.channel === 'DIRECT' && (
          <Field label="شعبه فروش">
            <select className="input" value={f.sellingBranchId} onChange={(e) => setF({ ...f, sellingBranchId: e.target.value })}>
              <option value="">— انتخاب شعبه —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
            {branches.length === 0 && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>شعبه‌ای تعریف نشده — از «تنظیمات سازمان ← شعب» اضافه کنید</p>}
          </Field>
        )}
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
