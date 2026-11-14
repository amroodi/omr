'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { DoctorShell } from '../shell';
import { DoctorPaper } from '../../components/paper/DoctorPaper';
import { printPaper, Values } from '../../components/paper/Paper';

interface Referral {
  id: string; kind: string; kindLabel: string; status: string; createdAt: string; answeredAt: string | null; referredBy: string | null; doctorName: string | null; form: 'LIFE' | 'ACCIDENT';
  request: Record<string, string>; answer: Record<string, string> | null;
  claim: { claimNumber: string; name: string | null; nationalCode: string | null; claimTypeLabel: string; eventDate: string | null; birthDate: string | null; cause: string | null; causeDetail: string | null; description: string | null; gender: string | null };
  documents: { id: string; label: string; fileName: string; mimeType: string }[];
}

/**
 * «اظهار نظر پزشک معتمد»: the insurer's sheet as the doctor sees it — شعبه's half filled in, their own half to
 * type into, registered once (the case returns to شعبه's evaluator) — and the case's documents to read.
 */
export default function DoctorCase() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [r, setR] = useState<Referral | null>(null);
  const [f, setF] = useState<Values>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!getToken('org')) { router.push('/doctor/login'); return; }
    client.get<Referral>(`/doctor/referrals/${id}`, 'org').then((x) => { setR(x); setF(x.kind === 'EXAM' ? { mode: 'B' } : { mode: 'A' }); }).catch((e) => setError(e.message));
  }, [id, router]);
  const view = (docId: string) => client.view(`/doctor/referrals/${id}/documents/${docId}/file`, 'org').catch((e) => setError(e.message));
  const submit = async () => {
    if (!window.confirm('نظر شما ثبت شود؟')) return;
    setBusy(true); setError('');
    const { opinion, ...rest } = f;
    try { setR(await client.post<Referral>(`/doctor/referrals/${id}/answer`, { opinion: (opinion ?? '').trim(), fields: rest }, 'org')); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const done = r?.status === 'DONE';
  const day = (s: string | null | undefined) => (s ?? '').split(' ')[0];

  return (
    <DoctorShell title={r ? `${r.kindLabel} — پرونده ${r.claim.claimNumber}` : 'پرونده'}>
      {error && <div className="alert-error text-sm">{error}</div>}
      {!r ? !error && <div className="doc-card">در حال بارگذاری…</div> : (
        <div className="space-y-4">
          <div className="doc-card">
            <div className="ev-dform-sec">مدارک پرونده</div>
            {r.documents.length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>مدرکی بارگذاری نشده است.</div> : (
              <ul className="doc-files">{r.documents.map((d) => <li key={d.id}><button onClick={() => view(d.id)}>{d.label}</button><span>{d.fileName}</span></li>)}</ul>
            )}
          </div>
          <DoctorPaper form={r.form} request={r.request ?? {}} answer={done ? r.answer ?? {} : f} onAnswer={done ? undefined : setF}
            requestSign={{ name: r.referredBy ?? '', at: day(r.createdAt) }} answerSign={done ? { name: r.doctorName ?? '', at: day(r.answeredAt) } : null} />
          <div className="paper-actions">
            {!done && <button className="btn btn-solid" disabled={busy || (f.opinion ?? '').trim().length < 2} onClick={submit}>{busy ? 'در حال ثبت…' : 'ثبت نظریه'}</button>}
            <button className="btn" onClick={printPaper}>چاپ</button>
          </div>
        </div>
      )}
    </DoctorShell>
  );
}
