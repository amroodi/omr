'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { DoctorShell } from '../shell';

interface Referral {
  id: string; kind: string; kindLabel: string; status: string; createdAt: string; answeredAt: string | null; referredBy: string | null;
  request: Record<string, string>; answer: Record<string, string> | null;
  claim: { claimNumber: string; name: string | null; nationalCode: string | null; claimTypeLabel: string; eventDate: string | null; birthDate: string | null; cause: string | null; causeDetail: string | null; description: string | null; gender: string | null };
  documents: { id: string; label: string; fileName: string; mimeType: string }[];
}

/**
 * «اظهار نظر پزشک معتمد»: the form as the doctor sees it — the insured, شعبه's part (read only), the case's
 * documents to read, then the doctor's part, registered once (the case returns to شعبه's evaluator).
 */
export default function DoctorCase() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [r, setR] = useState<Referral | null>(null);
  const [f, setF] = useState({ opinion: '', percent: '', examDate: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!getToken('org')) { router.push('/doctor/login'); return; }
    client.get<Referral>(`/doctor/referrals/${id}`, 'org').then(setR).catch((e) => setError(e.message));
  }, [id, router]);
  const view = (docId: string) => client.view(`/doctor/referrals/${id}/documents/${docId}/file`, 'org').catch((e) => setError(e.message));
  const submit = async () => {
    if (!window.confirm('نظر شما ثبت و پرونده به شعبه بازگردانده می‌شود. ادامه می‌دهید؟')) return;
    setBusy(true); setError('');
    try { setR(await client.post<Referral>(`/doctor/referrals/${id}/answer`, Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())), 'org')); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const done = r?.status === 'DONE';
  const c = r?.claim;

  return (
    <DoctorShell title={r ? `${r.kindLabel} — پرونده ${r.claim.claimNumber}` : 'پرونده'}>
      {error && <div className="alert-error text-sm">{error}</div>}
      {!r ? !error && <div className="doc-card">در حال بارگذاری…</div> : (
        <div className="doc-grid">
          <div className="doc-card doc-form">
            <div className="ev-dform-sec">مشخصات بیمه‌شده</div>
            <div className="ev-dform-grid">
              <div><span>نام</span><b>{c!.name ?? '—'}</b></div>
              <div><span>کد ملی</span><b className="ltr">{c!.nationalCode ?? '—'}</b></div>
              <div><span>تاریخ تولد</span><b>{c!.birthDate ?? '—'}</b></div>
              <div><span>نوع پرونده</span><b>{c!.claimTypeLabel}</b></div>
              <div><span>تاریخ وقوع</span><b>{c!.eventDate ?? '—'}</b></div>
              <div><span>علت</span><b>{c!.cause ?? '—'}{c!.causeDetail ? ` — ${c!.causeDetail}` : ''}</b></div>
            </div>
            {c!.description && <div className="text-sm"><b>شرح:</b> {c!.description}</div>}
            <div className="ev-dform-sec">بخش شعبه</div>
            <div className="text-sm space-y-1">
              <div><b>ارجاع‌دهنده:</b> {r.referredBy ?? 'شعبه'} — {r.createdAt}</div>
              <div><b>موضوع / سؤال:</b> {r.request.question || r.request.note || '—'}</div>
              {r.request.history && <div><b>سوابق پزشکی / توضیحات:</b> {r.request.history}</div>}
            </div>
            <div className="ev-dform-sec">بخش پزشک معتمد</div>
            {done ? (
              <div className="text-sm space-y-1">
                <div><b>نظر پزشک معتمد:</b> {r.answer?.opinion}</div>
                {r.answer?.percent && <div><b>درصد نقص عضو / از کار افتادگی:</b> {r.answer.percent}</div>}
                {r.answer?.examDate && <div><b>تاریخ معاینه:</b> {r.answer.examDate}</div>}
                {r.answer?.notes && <div><b>توضیحات:</b> {r.answer.notes}</div>}
                <div style={{ color: '#15803d' }}>ثبت شد ({r.answeredAt}) و پرونده به شعبه بازگشت.</div>
              </div>
            ) : (
              <>
                <label className="label">نظر پزشک معتمد *</label>
                <textarea className="input" rows={5} maxLength={3000} value={f.opinion} onChange={(e) => setF({ ...f, opinion: e.target.value })} />
                <div className="grid gap-2 grid-cols-2">
                  <label className="label">درصد نقص عضو / از کار افتادگی<input className="input" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} maxLength={20} placeholder="در صورت لزوم" /></label>
                  {r.kind === 'EXAM' && <label className="label">تاریخ معاینه<input className="input" value={f.examDate} onChange={(e) => setF({ ...f, examDate: e.target.value })} maxLength={30} placeholder="۱۴۰۵/۰۸/۲۱" /></label>}
                </div>
                <label className="label">توضیحات</label>
                <textarea className="input" rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                <button className="btn btn-solid" disabled={busy || f.opinion.trim().length < 2} onClick={submit}>{busy ? 'در حال ثبت…' : 'ثبت نظر و بازگشت پرونده به شعبه'}</button>
              </>
            )}
          </div>
          <div className="doc-card">
            <div className="ev-dform-sec">مدارک پرونده</div>
            {r.documents.length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>مدرکی بارگذاری نشده است.</div> : (
              <ul className="doc-files">{r.documents.map((d) => <li key={d.id}><button onClick={() => view(d.id)}>{d.label}</button><span>{d.fileName}</span></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </DoctorShell>
  );
}
