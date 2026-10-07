'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../../../components/ui';

interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; uploadedAt: string | null; version: number; isLatest: boolean }
interface ChecklistItem { code: string; label: string; uploaded: boolean; latestStatus: string | null; documents: ClaimDoc[] }
interface Checklist { complete: boolean; items: ChecklistItem[] }

const DOC_BADGE: Record<string, string> = { PENDING: 'badge-warning', VERIFIED: 'badge-success', REJECTED: 'badge-danger', NEEDS_INFO: 'badge-warning' };
interface Claim {
  claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  eventDate: string | null; noticeDeadline: string | null; lateNotice: boolean;
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
}

export default function CustomerClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = async () => {
    try {
      const [c, cl] = await Promise.all([client.get<Claim>(`/customer/claims/${id}`, 'customer'), client.get<Checklist>(`/customer/claims/${id}/checklist`, 'customer')]);
      setClaim(c); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    load();
    // eslint-disable-next-line
  }, [id]);

  const act = async (fn: () => Promise<any>) => { setError(''); setBusy(true); try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const upload = (code: string, file: File) => act(async () => { const fd = new FormData(); fd.append('file', file); await client.postForm(`/customer/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'customer'); });
  const viewDoc = async (docId: string) => { setError(''); try { await client.view(`/customer/claims/${id}/documents/${docId}/file`, 'customer'); } catch (e: any) { setError(e.message); } };
  const rectify = () => act(() => client.post(`/customer/claims/${id}/rectify`, { note: 'مدارک تکمیل شد' }, 'customer'));

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <button onClick={() => router.push('/customer')} className="btn btn-ghost btn-sm">→ بازگشت</button>
      <ErrorBox message={error} />
      {!claim ? <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</div> : (
        <>
          <div className="card p-5">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold">پرونده {claim.claimNumber}</span>
              <StatusBadge status={claim.status} />
            </div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType} — {claim.deceasedName}
            </div>
            {claim.lateNotice && <div className="alert-error mt-3">⚠ اعلام خسارت خارج از مهلت مقرر بوده است (مهلت: {claim.noticeDeadline}).</div>}
          </div>

          {claim.status === 'RETURNED_INCOMPLETE' && (
            <div className="card p-5" style={{ borderColor: 'var(--danger)' }}>
              <h3 className="font-bold mb-2">نقص مدارک — نیازمند اقدام شما</h3>
              {(claim.deficiencies || []).filter((d) => !d.resolvedAt).map((d, i) => (
                <ul key={i} className="mr-4 list-disc text-sm" style={{ color: 'var(--danger)' }}>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
              ))}
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>مدارک خواسته‌شده را بارگذاری و سپس ارسال مجدد کنید.</p>
              <button onClick={rectify} disabled={busy} className="btn btn-primary btn-sm mt-3">رفع نقص و ارسال مجدد</button>
            </div>
          )}

          <div className="card p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold">مدارک مورد نیاز</h3>
              {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
            </div>
            <div className="space-y-2">
              {checklist?.items.map((it) => (
                <div key={it.code} className="py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm flex items-center gap-2">
                      <span style={{ color: it.uploaded ? 'var(--success)' : 'var(--muted)' }}>{it.uploaded ? '✔' : '○'}</span>{it.label}
                    </span>
                    <div>
                      <input ref={(el) => { fileRefs.current[it.code] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                      <button onClick={() => fileRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm">{it.uploaded ? 'بارگذاری مجدد' : 'بارگذاری'}</button>
                    </div>
                  </div>
                  {it.documents.length > 0 && (
                    <div className="mt-2 space-y-1.5 mr-6">
                      {it.documents.map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: d.isLatest ? 'var(--brand-soft)' : 'var(--surface-2)', opacity: d.isLatest ? 1 : 0.7 }}>
                          <span className="text-xs flex items-center gap-2 min-w-0">
                            <span className="badge badge-neutral shrink-0">نسخه {d.version}</span>
                            {d.isLatest && <span className="badge badge-success shrink-0">جدیدترین</span>}
                            <span className={`badge ${DOC_BADGE[d.status] || 'badge-neutral'} shrink-0`}>{d.statusLabel}</span>
                            {d.note && <span className="truncate" style={{ color: 'var(--danger)' }} title={d.note}>{d.note}</span>}
                          </span>
                          <button onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm shrink-0">مشاهده</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
