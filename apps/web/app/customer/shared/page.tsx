'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, FancyLoader } from '../../components/ui';
import { CUSTOMER_NAV } from '../nav';

interface Row { id: string; number: number; claimTypeLabel: string; fullName: string | null; policyNumber: string | null; eventDate: string | null; caseStage: string | null }
interface Detail extends Row { fields: { key: string; label: string; value: string }[]; documents: { id: string; label: string; fileName: string }[] }

/** Cases the brokerage chose to share from its «میز کار مستقل»: read-only. */
export default function SharedCases() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<Row[]>('/customer/shared-cases', 'customer').then(setRows).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const show = (id: string) => client.get<Detail>(`/customer/shared-cases/${id}`, 'customer').then(setOpen).catch((e) => setError(e.message));

  return (
    <Shell title="پرونده‌های اشتراکی کارگزاری" breadcrumb="پرونده‌های اشتراکی" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />
      <div className="pcard p-5">
        {!rows ? <div className="flex justify-center p-6"><FancyLoader label="در حال دریافت" /></div>
          : rows.length === 0 ? <div className="text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای با شما به اشتراک گذاشته نشده است.</div> : (
            <div className="overflow-x-auto">
              <table className="table cu-group-t">
                <thead><tr>{['عملیات', 'نام و نام خانوادگی', 'نوع پرونده', 'شماره بیمه‌نامه', 'تاریخ وقوع', 'وضعیت پرونده'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><button type="button" className="cu-more" onClick={() => show(r.id)}>جزئیات بیشتر</button></td>
                      <td>{r.fullName ?? '—'}</td><td>{r.claimTypeLabel}</td><td className="latin-digits">{r.policyNumber ?? '—'}</td><td>{r.eventDate ?? '—'}</td><td>{r.caseStage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {open && (
        <div className="pcard p-5 mt-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">{open.fullName ?? '—'} — {open.claimTypeLabel}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>بستن ✕</button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-sm">
            {open.fields.map((f) => <div key={f.key}><span style={{ color: 'var(--muted)' }}>{f.label}: </span><bdi>{f.value}</bdi></div>)}
          </div>
          {open.documents.length > 0 && (
            <div className="mt-3 text-sm space-y-1">
              <b>مدارک</b>
              {open.documents.map((d) => (
                <div key={d.id}><button type="button" className="underline" style={{ color: 'var(--brand)' }} onClick={() => client.view(`/customer/shared-cases/${open.id}/documents/${d.id}/file`, 'customer').catch((e) => setError(e.message))}>{d.label}</button></div>
              ))}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
