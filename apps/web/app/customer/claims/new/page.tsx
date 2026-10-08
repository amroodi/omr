'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox, Field } from '../../../components/ui';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
function jalaliToIso(input: string): string | null {
  const parts = toAscii(input).split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(parts[0], parts[1], parts[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function CustomerNewClaim() {
  const router = useRouter();
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ insurerTenantId: '', claimType: 'DEATH_ILLNESS', eventDate: '', deceasedFullName: '', deceasedNationalCode: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ id: string; name: string }[]>('/customer/insurers', 'customer').then(setInsurers).catch((e) => setError(e.message));
    // eslint-disable-next-line
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
        claimType: f.claimType,
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
      };
      if (iso) payload.eventDate = iso;
      if (f.description.trim()) payload.description = f.description.trim();
      const c = await client.post<{ id: string }>('/customer/claims', payload, 'customer');
      router.push(`/customer/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <button onClick={() => router.push('/customer')} className="btn btn-ghost btn-sm">→ بازگشت</button>
      <div className="card p-5 space-y-4">
        <h1 className="text-xl font-extrabold">ثبت پرونده خسارت جدید</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>پس از ثبت، مدارک موردنیاز را در صفحه پرونده بارگذاری کنید.</p>
        <ErrorBox message={error} />
        <Field label="بیمه‌گر">
          <select className="input" value={f.insurerTenantId} onChange={(e) => setF({ ...f, insurerTenantId: e.target.value })}>
            <option value="">— انتخاب بیمه‌گر —</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {insurers.length === 0 && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>بیمه‌گری در دسترس نیست — با سازمان تماس بگیرید.</p>}
        </Field>
        <Field label="نوع پرونده">
          <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
            {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="تاریخ وقوع (شمسی)"><JalaliDatePicker value={f.eventDate} onChange={(v) => setF({ ...f, eventDate: v })} placeholder="۱۴۰۵/۰۷/۰۱" /></Field>
        <Field label="نام بیمه‌شده (متوفی)"><input className="input" value={f.deceasedFullName} onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })} /></Field>
        <Field label="کد ملی بیمه‌شده"><input className="input" value={f.deceasedNationalCode} onChange={(e) => setF({ ...f, deceasedNationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="توضیحات (اختیاری)">
          <textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه، شماره تماس، یا موارد خاص پرونده." />
        </Field>
        <button onClick={submit} disabled={busy || !f.deceasedFullName || !f.deceasedNationalCode} className="btn btn-primary w-full">{busy ? '…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}</button>
      </div>
    </div>
  );
}
