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

export default function CustomerNewClaim() {
  const router = useRouter();
  const [company, setCompany] = useState<{ name: string } | null | undefined>(undefined);
  const [f, setF] = useState({ claimType: 'DEATH_ILLNESS', eventDate: '', birthDate: '', deceasedFullName: '', deceasedNationalCode: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ company: { name: string } | null }>('/customer/me', 'customer').then((m) => setCompany(m.company)).catch(() => setCompany(null));
    // eslint-disable-next-line
  }, []);

  const submit = async () => {
    setError('');
    const iso = f.eventDate ? jalaliToIso(f.eventDate) : null;
    if (f.eventDate && !iso) return setError(`${eventLabel} نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)`);
    const birthIso = f.birthDate ? jalaliToIso(f.birthDate) : null;
    if (f.birthDate && !birthIso) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)');
    if (birthIso && iso && new Date(birthIso) > new Date(iso)) return setError(`تاریخ تولد بعد از ${eventLabel} است`);
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        claimType: f.claimType,
        deceasedFullName: f.deceasedFullName.trim(),
        deceasedNationalCode: toAscii(f.deceasedNationalCode).trim(),
      };
      if (iso) payload.eventDate = iso;
      if (birthIso) payload.deceasedBirthDate = birthIso;
      if (f.description.trim()) payload.description = f.description.trim();
      const c = await client.post<{ id: string }>('/customer/claims', payload, 'customer');
      router.push(`/customer/claims/${c.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const isDeath = DEATH_TYPES.has(f.claimType);
  const eventLabel = isDeath ? 'تاریخ فوت' : 'تاریخ وقوع حادثه';
  const age = ageBetween(f.birthDate ? jalaliToIso(f.birthDate) : null, f.eventDate ? jalaliToIso(f.eventDate) : null);

  return (
    <Shell title="ثبت پرونده خسارت" breadcrumb="ثبت پرونده خسارت" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <div className="pcard p-6 md:p-8 pform max-w-4xl mx-auto">
        {/* Guidance banner */}
        <div className="pinfobox mb-6 text-center">
          پس از ثبت پرونده، مدارک موردنیاز را در صفحهٔ پرونده بارگذاری کنید. لطفاً مشخصات بیمه‌شدهٔ متوفی و نوع پرونده را با دقت وارد نمایید.
          <div className="text-xs mt-1 font-normal">
            {company
              ? <>پرونده برای «{company.name}» ثبت می‌شود و کارگزاری آن را بر اساس قرارداد بیمه‌ای شرکت شما به بیمه‌گر مربوط ارسال می‌کند.</>
              : company === null ? <>حساب شما هنوز به شرکت بیمه‌گزار متصل نشده است؛ برای ثبت پرونده با کارگزاری تماس بگیرید.</> : null}
          </div>
        </div>

        <ErrorBox message={error} />

        <div className="grid md:grid-cols-2 gap-5 mt-4">
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

          <PField label="تاریخ تولد بیمه‌شده (شمسی)" help="تاریخ تولد متوفی؛ سن او به‌طور خودکار محاسبه می‌شود.">
            <JalaliDatePicker value={f.birthDate} onChange={(v) => setF({ ...f, birthDate: v })} placeholder="۱۳۴۵/۰۵/۱۲" />
          </PField>

          <PField label={`${eventLabel} (شمسی) *`} help={isDeath ? 'تاریخ فوت بیمه‌شده به تقویم شمسی؛ بیمه‌گر بر اساس قرارداد معتبر در این تاریخ تعیین می‌شود.' : 'تاریخ وقوع حادثه به تقویم شمسی.'}>
            <JalaliDatePicker value={f.eventDate} onChange={(v) => setF({ ...f, eventDate: v })} placeholder="۱۴۰۵/۰۷/۰۱" />
          </PField>

          <PField label={isDeath ? 'سن متوفی (هنگام فوت)' : 'سن بیمه‌شده (هنگام حادثه)'} help="از روی تاریخ تولد و تاریخ فوت محاسبه می‌شود.">
            <input className="input" readOnly value={age != null ? `${age.toLocaleString('fa-IR')} سال` : '— (پس از ورود تاریخ‌ها)'} style={{ background: 'var(--surface-2)' }} />
          </PField>
        </div>

        <div className="mt-5">
          <label className="label">توضیحات (اختیاری)</label>
          <textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="هر توضیح یا جزئیاتی که لازم می‌دانید بنویسید؛ مثلاً شرح حادثه، شماره تماس، یا موارد خاص پرونده." />
        </div>

        <div className="flex justify-center mt-8">
          <button onClick={submit} disabled={busy || !f.deceasedFullName || !f.deceasedNationalCode || !f.eventDate || company === null} className="btn btn-solid btn-solid-lg">
            {busy ? 'در حال ثبت…' : 'ثبت پرونده و ادامه به بارگذاری مدارک'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
