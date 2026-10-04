'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { client } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../../../components/ui';
import { ORG_NAV } from '../../nav';
import { FieldsSection } from './fields-section';

interface ChecklistItem { code: string; label: string; uploaded: boolean; documents: { id: string }[] }
interface Checklist { claimType: string; complete: boolean; items: ChecklistItem[] }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  claimedAmount: string; eventDate: string | null; noticeDeadline: string | null; lateNotice: boolean;
  steps?: { order: number; partyType: string; state: string }[];
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
}

const STEP_PARTY: Record<string, string> = { POLICYHOLDER: 'بیمه‌گزار', MOAREF: 'معرف', INSURER_LEVEL: 'سطح بیمه‌گر' };
const STEP_STATE: Record<string, string> = { PENDING: 'در انتظار', FORWARDED: 'ارسال‌شده', ESCALATED: 'ارجاع به بالاتر', APPROVED: 'تایید', RETURNED_INCOMPLETE: 'نقص مدارک', REJECTED: 'رد', ACKED: 'ثبت' };

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [defText, setDefText] = useState('');
  const [showDef, setShowDef] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = async () => {
    try {
      const [c, cl] = await Promise.all([client.get<Claim>(`/claims/${id}`, 'org'), client.get<Checklist>(`/claims/${id}/checklist`, 'org')]);
      setClaim(c); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const act = async (fn: () => Promise<any>) => {
    setError(''); setBusy(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const upload = (code: string, file: File) => act(async () => {
    const fd = new FormData(); fd.append('file', file);
    await client.postForm(`/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'org');
  });

  const viewDoc = async (docId: string) => {
    setError('');
    try { await client.view(`/claims/${id}/documents/${docId}/file`, 'org'); } catch (e: any) { setError(e.message); }
  };

  const endorse = () => act(() => client.post(`/claims/${id}/endorse`, {}, 'org'));
  const reject = () => act(() => client.post(`/claims/${id}/reject`, { note: 'رد پرونده' }, 'org'));
  const pay = () => act(() => client.post(`/claims/${id}/pay`, {}, 'org'));
  const rectify = () => act(() => client.post(`/claims/${id}/rectify`, { note: 'رفع نقص' }, 'org'));
  const returnIncomplete = () => act(async () => {
    const deficiencies = defText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (deficiencies.length === 0) throw new Error('حداقل یک مورد نقص را وارد کنید');
    await client.post(`/claims/${id}/return-incomplete`, { deficiencies }, 'org');
    setShowDef(false); setDefText('');
  });

  const Row = ({ label, value }: { label: string; value: any }) => value ? (
    <div className="flex justify-between py-1.5 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span><span className="font-semibold">{value}</span>
    </div>
  ) : null;

  return (
    <Shell title={claim ? `پرونده ${claim.claimNumber}` : 'پرونده خسارت'} nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</div> : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          {/* main */}
          <div className="space-y-5">
            {claim.lateNotice && (
              <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر انجام شده است (مهلت: {claim.noticeDeadline}).</div>
            )}
            <div className="card p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold">{CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType}</span>
                <StatusBadge status={claim.status} />
              </div>
              <Row label="بیمه‌شده (متوفی)" value={claim.deceasedName} />
              <Row label="مبلغ خسارت" value={`${Number(claim.claimedAmount).toLocaleString('fa-IR')} ریال`} />
              <Row label="تاریخ وقوع" value={claim.eventDate} />
              <Row label="مهلت اعلام" value={claim.noticeDeadline} />
            </div>

            {/* claim data / workflow fields (OCR-assisted) */}
            <FieldsSection claimId={id} realm="org" basePath="/claims" />

            {/* checklist */}
            <div className="card p-5">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold">مدارک مورد نیاز</h3>
                {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
              </div>
              <div className="space-y-2">
                {checklist?.items.map((it) => (
                  <div key={it.code} className="flex items-center justify-between gap-3 py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-sm flex items-center gap-2">
                      <span style={{ color: it.uploaded ? 'var(--success)' : 'var(--muted)' }}>{it.uploaded ? '✔' : '○'}</span>
                      {it.label}{it.documents.length > 1 && <span className="badge badge-neutral">{it.documents.length}</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      {it.documents.map((d, di) => (
                        <button key={d.id} onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm" title="مشاهده مدرک">مشاهده{it.documents.length > 1 ? ` ${di + 1}` : ''}</button>
                      ))}
                      <input ref={(el) => { fileRefs.current[it.code] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                      <button onClick={() => fileRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm">بارگذاری</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* deficiencies list */}
            {claim.deficiencies && claim.deficiencies.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold mb-2">سوابق نقص مدارک</h3>
                {claim.deficiencies.map((d, i) => (
                  <div key={i} className="text-sm mb-2">
                    <span className={`badge ${d.resolvedAt ? 'badge-success' : 'badge-danger'}`}>{d.resolvedAt ? 'رفع شد' : 'باز'}</span>
                    <ul className="mt-1 mr-4 list-disc" style={{ color: 'var(--muted)' }}>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* sidebar: steps + actions */}
          <div className="space-y-5">
            <div className="card p-5">
              <h3 className="font-bold mb-3">مسیر گردش کار</h3>
              <div className="space-y-2">
                {(claim.steps || []).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex items-center justify-center rounded-full" style={{ width: 24, height: 24, background: s.state === 'PENDING' ? 'var(--brand)' : 'var(--surface-2)', color: s.state === 'PENDING' ? '#fff' : 'var(--muted)', fontSize: 11 }}>{s.order}</span>
                    <span>{STEP_PARTY[s.partyType] || s.partyType}</span>
                    <span className="badge badge-neutral mr-auto">{STEP_STATE[s.state] || s.state}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5 space-y-2">
              <h3 className="font-bold mb-1">اقدامات</h3>
              {claim.status === 'RETURNED_INCOMPLETE' ? (
                <button onClick={rectify} disabled={busy} className="btn btn-primary w-full btn-sm">رفع نقص و ارسال مجدد</button>
              ) : claim.status === 'APPROVED' ? (
                <button onClick={pay} disabled={busy} className="btn btn-primary w-full btn-sm">ثبت پرداخت</button>
              ) : ['PAID', 'REJECTED'].includes(claim.status) ? (
                <p className="text-sm" style={{ color: 'var(--muted)' }}>پرونده بسته شده است.</p>
              ) : (
                <>
                  <button onClick={endorse} disabled={busy} className="btn btn-primary w-full btn-sm">تایید و ارسال</button>
                  <button onClick={() => setShowDef(!showDef)} disabled={busy} className="btn btn-ghost w-full btn-sm" style={{ color: 'var(--warning)' }}>اعلام نقص مدارک</button>
                  {showDef && (
                    <div className="space-y-2">
                      <textarea value={defText} onChange={(e) => setDefText(e.target.value)} placeholder="هر مورد نقص در یک خط" className="input" rows={3} />
                      <button onClick={returnIncomplete} disabled={busy} className="btn btn-sm w-full" style={{ background: 'var(--warning)', color: '#fff' }}>ارسال نقص مدارک</button>
                    </div>
                  )}
                  <button onClick={reject} disabled={busy} className="btn btn-ghost w-full btn-sm" style={{ color: 'var(--danger)' }}>رد پرونده</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
