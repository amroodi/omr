'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../../../components/ui';
import { Icon, Shell } from '../../../components/Shell';
import { CUSTOMER_NAV } from '../../nav';

interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; uploadedAt: string | null; version: number; isLatest: boolean }
interface ChecklistItem { code: string; label: string; uploaded: boolean; latestStatus: string | null; documents: ClaimDoc[] }
interface Checklist { complete: boolean; items: ChecklistItem[] }

const DOC_BADGE: Record<string, string> = { PENDING: 'badge-warning', VERIFIED: 'badge-success', REJECTED: 'badge-danger', NEEDS_INFO: 'badge-warning' };
interface Claim {
  claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  insurerTenantId?: string;
  eventDate: string | null; noticeDeadline: string | null; lateNotice: boolean;
  description?: string | null;
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
}

export default function CustomerClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [insurers, setInsurers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lateWarn, setLateWarn] = useState(true);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const camRefs = useRef<Record<string, HTMLInputElement | null>>({}); // mobile camera capture

  const load = async () => {
    try {
      const [c, cl] = await Promise.all([client.get<Claim>(`/customer/claims/${id}`, 'customer'), client.get<Checklist>(`/customer/claims/${id}/checklist`, 'customer')]);
      setClaim(c); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
    client.get<{ id: string; name: string }[]>('/customer/insurers', 'customer').then((a) => setInsurers(Object.fromEntries(a.map((i) => [i.id, i.name])))).catch(() => {});
    client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', 'customer').then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {});
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
    <Shell title="جزئیات پرونده" breadcrumb="جزئیات پرونده" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
     <div className="space-y-5 max-w-3xl mx-auto">
      <ErrorBox message={error} />
      {!claim ? <div className="pcard p-10 text-center"><span className="pspinner inline-block" /></div> : (
        <>
          <div className="pcard p-6">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold">پرونده {claim.claimNumber}</span>
              <StatusBadge status={claim.status} />
            </div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType} — {claim.deceasedName}
            </div>
            {claim.insurerTenantId && insurers[claim.insurerTenantId] && (
              <div className="text-sm mt-1">بیمه‌گر: <b>{insurers[claim.insurerTenantId]}</b></div>
            )}
            {claim.description && (
              <div className="text-sm mt-2 whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>توضیحات: {claim.description}</div>
            )}
            {claim.lateNotice && lateWarn && <div className="alert-error mt-3">⚠ اعلام خسارت خارج از مهلت مقرر بوده است (مهلت: {claim.noticeDeadline}).</div>}
          </div>

          {claim.status === 'RETURNED_INCOMPLETE' && (
            <div className="pcard p-6" style={{ borderColor: 'var(--danger)' }}>
              <h3 className="font-bold mb-2">نقص مدارک — نیازمند اقدام شما</h3>
              {(claim.deficiencies || []).filter((d) => !d.resolvedAt).map((d, i) => (
                <ul key={i} className="mr-4 list-disc text-sm" style={{ color: 'var(--danger)' }}>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
              ))}
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>مدارک خواسته‌شده را بارگذاری و سپس ارسال مجدد کنید.</p>
              <button onClick={rectify} disabled={busy} className="btn btn-solid btn-pill btn-sm mt-3">رفع نقص و ارسال مجدد</button>
            </div>
          )}

          <div className="pcard p-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-extrabold">مدارک مورد نیاز</h3>
              {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
            </div>
            <div className="space-y-2">
              {checklist?.items.map((it) => (
                <div key={it.code} className="py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm flex items-center gap-2">
                      <span style={{ color: it.uploaded ? 'var(--success)' : 'var(--muted)' }}>{it.uploaded ? '✔' : '○'}</span>{it.label}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input ref={(el) => { fileRefs.current[it.code] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                      {/* Mobile-only camera capture */}
                      <input ref={(el) => { camRefs.current[it.code] = el; }} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                      <button onClick={() => camRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm sm:hidden" title="گرفتن عکس با دوربین" aria-label="دوربین"><Icon path="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z" /></button>
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
    </Shell>
  );
}
