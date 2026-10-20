'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox } from '../../../components/ui';
import { JalaliDatePicker } from '../../../components/JalaliDatePicker';
import { Shell } from '../../../components/Shell';
import { CUSTOMER_NAV } from '../../nav';

const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
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
    <Shell title="ثبت پرونده خسارت" breadcrumb="ثبت پرونده خسارت" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <div className="pcard p-6 md:p-8 pform max-w-4xl mx-auto">
        {/* Guidance banner */}
        <div className="pinfobox mb-6 text-center">
          پس از ثبت پرونده، مدارک موردنیاز را در صفحهٔ پرونده بارگذاری کنید. لطفاً مشخصات بیمه‌شدهٔ متوفی و نوع پرونده را با دقت وارد نمایید.
        </div>

        <ErrorBox message={error} />

        <div className="grid md:grid-cols-2 gap-5 mt-4">
          <PField label="بیمه‌گر *" help="شرکت بیمه‌ای که پرونده نزد آن پیگیری می‌شود را انتخاب کنید.">
            <select className="input" value={f.insurerTenantId} onChange={(e) => setF({ ...f, insurerTenantId: e.target.value })}>
              <option value="">— انتخاب بیمه‌گر —</option>
              {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </PField>

          <PField label="نوع پرونده *" help="علت فوت یا نوع خسارت را مشخص کنید.">
            <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
              {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </PField>

          <PField label="نام بیمه‌شده (متوفی) *">
            <input className="input" value={f.deceasedFullName} onChange={(e) => setF({ ...f, deceasedFullName: e.target.value })} />
          </PField>

          <PField label="کد ملی بیمه‌شده *" help="کد ملی ۱۰ رقمی بیمه‌شدهٔ متوفی.">
            <input className="input" value={f.deceasedNationalCode} onChange={(e) => setF({ ...f, deceasedNationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} />
          </PField>

          <PField label="تاریخ وقوع (شمسی)" help="تاریخ فوت یا وقوع حادثه به تقویم شمسی.">
            <JalaliDatePicker value={f.eventDate} onChange={(v) => setF({ ...f, eventDate: v })} placeholder="۱۴۰۵/۰۷/۰۱" />
          </PField>
        </div>

        <div className="mt-5">
          <label className="label">توضیحات (اختیاری)</label>
          <textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه، شماره تماس، یا موارد خاص پرونده." />
        </div>

        <div className="flex justify-center mt-8">
          <button onClick={submit} disabled={busy || !f.deceasedFullName || !f.deceasedNationalCode} className="btn btn-solid btn-solid-lg">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
