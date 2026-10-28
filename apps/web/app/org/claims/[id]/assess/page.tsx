'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../../../lib/client';
import { Shell, Icon } from '../../../../components/Shell';
import { ClaimTypeBadge, ErrorBox, FancyLoader, Overlay, ReviewButtons, Spinner, StatusBadge } from '../../../../components/ui';
import { ORG_NAV } from '../../../nav';
import { Workflow, WorkflowPanel } from '../../../../components/WorkflowPanel';
import { caseTitle } from '../../../../../lib/caseTitle';
import { OnProgress, UploadButton } from '../../../../components/upload';

interface DocReview { stage: string; state: string; canEdit: boolean; changedAt?: string | null; changedBy?: string | null; changes?: number }
interface HistoryEntry { at: string; stageLabel: string | null; state: string | null; by: string; text: string }
interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; version: number; isLatest: boolean; reviews?: DocReview[] }
interface ChecklistItem { code: string; label: string; uploaded: boolean; documents: ClaimDoc[] }
interface Checklist { complete: boolean; items: ChecklistItem[]; otherDocuments?: ClaimDoc[] }
interface DocMeta { id: string; docCode: string | null; fileName: string; mimeType: string }
interface Claim {
  id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; deceasedName: string | null;
  estimatedAmount?: string; claimedAmount: string; finalizedAmount?: string | null;
  eventDate: string | null; deceasedBirthDate?: string | null; deceasedAge?: number | null; policyHolder?: { name: string | null; nationalCode: string | null } | null;
  insurer?: { name: string } | null; broker?: { name: string } | null; sellingBranchName?: string | null;
  workflow?: Workflow;
}

const STAGE_LABEL: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'مدیریت ستاد', COUNCIL: 'شورای فنی' };

/** One document rendered inline (image scaled by zoom, or PDF in an embed). */
function DocMedia({ claimId, docId, fileName, zoom }: { claimId: string; docId: string; fileName: string; zoom: number }) {
  const [src, setSrc] = useState<{ url: string; mimeType: string } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let active = true; let u: string | null = null;
    client.blobUrl(`/claims/${claimId}/documents/${docId}/file`, 'org')
      .then((r) => { if (active) { setSrc(r); u = r.url; } else URL.revokeObjectURL(r.url); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; if (u) URL.revokeObjectURL(u); };
  }, [claimId, docId]);
  if (err) return <div className="text-xs py-4 text-center" style={{ color: 'var(--danger)' }}>خطا در بارگذاری سند</div>;
  if (!src) return <div className="py-8 flex justify-center"><Spinner /></div>;
  if (src.mimeType === 'application/pdf') return <iframe className="assess-doc-pdf" src={src.url} title={fileName} />;
  return <ImageViewer url={src.url} fileName={fileName} baseZoom={zoom} />;
}

/**
 * Images get the same kind of toolbar the browser gives PDFs: rotate, zoom out/in with the percent,
 * fit to width, download, print and open full size. Each document keeps its own zoom and rotation.
 */
function ImageViewer({ url, fileName, baseZoom }: { url: string; fileName: string; baseZoom: number }) {
  const [zoom, setZoom] = useState(baseZoom);
  const [rot, setRot] = useState(0);
  useEffect(() => { setZoom(baseZoom); }, [baseZoom]); // the pane's −/+ still zooms every image
  const sideways = rot % 180 !== 0;
  const download = () => { const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html dir="rtl"><head><title>${fileName.replace(/</g, '')}</title></head><body style="margin:0;display:flex;justify-content:center"><img src="${url}" style="max-width:100%;transform:rotate(${rot}deg)" onload="window.print()"></body></html>`);
    w.document.close();
  };
  const B = ({ title, onClick, path, label }: { title: string; onClick: () => void; path?: string; label?: string }) => (
    <button type="button" className="iv-btn" title={title} aria-label={title} onClick={onClick}>{path ? <Icon path={path} /> : label}</button>
  );
  return (
    <div className="iv">
      <div className="iv-bar">
        <B title="چرخش به چپ" onClick={() => setRot((r) => (r + 270) % 360)} path="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10" />
        <B title="چرخش به راست" onClick={() => setRot((r) => (r + 90) % 360)} path="M23 4v6h-6M20.49 15a9 9 0 11-2.12-9.36L23 10" />
        <span className="iv-sep" />
        <B title="کوچک‌تر" onClick={() => setZoom((z) => Math.max(25, z - 15))} label="−" />
        <span className="iv-pct">{zoom.toLocaleString('fa-IR')}٪</span>
        <B title="بزرگ‌تر" onClick={() => setZoom((z) => Math.min(400, z + 15))} label="+" />
        <B title="اندازهٔ صفحه" onClick={() => { setZoom(100); setRot(0); }} path="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
        <span className="iv-grow" />
        <B title="دریافت فایل" onClick={download} path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        <B title="چاپ" onClick={print} path="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" />
        <B title="باز کردن در اندازهٔ کامل" onClick={() => window.open(url, '_blank')} path="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
      </div>
      <div className="iv-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className="iv-img" style={{ width: `${zoom}%`, transform: `rotate(${rot}deg)`, margin: sideways ? '18% 0' : undefined }} />
      </div>
    </div>
  );
}

export default function AssessClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [finalAmt, setFinalAmt] = useState('');
  // Rejecting a document: tick reasons from the insurer's «دلایل رد مدارک» list and/or type your own.
  const [reject, setReject] = useState<{ docId: string; stage: string; label: string } | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ownReason, setOwnReason] = useState('');
  const canProcess = hasPerm('org', 'claim:process');
  const [history, setHistory] = useState<{ title: string; entries: HistoryEntry[] | null } | null>(null);
  const openHistory = (docId: string, title: string) => {
    setHistory({ title, entries: null });
    client.get<{ entries: HistoryEntry[] }>(`/claims/${id}/documents/${docId}/history`, 'org')
      .then((h) => setHistory({ title, entries: h.entries }))
      .catch((e) => { setHistory(null); setError(e.message); });
  };
  const downloadAll = () => act(() => client.download(`/claims/${id}/documents-zip`, 'org', `documents-${(claim?.policyNumber || claim?.claimNumber || id).replace(/[\/]/g, '-')}.zip`));

  const load = async () => {
    try {
      const [c, cl, dl] = await Promise.all([
        client.get<Claim>(`/claims/${id}`, 'org'),
        client.get<Checklist>(`/claims/${id}/checklist`, 'org'),
        client.get<DocMeta[]>(`/claims/${id}/documents`, 'org'),
      ]);
      setClaim(c); setChecklist(cl); setDocs(dl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { setFinalAmt(claim?.finalizedAmount ? String(claim.finalizedAmount) : ''); }, [claim?.finalizedAmount]);

  const act = async (fn: () => Promise<any>) => { setError(''); setBusy(true); try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const reviewDoc = (docId: string, stage: string, state: 'APPROVED' | 'REJECTED' | 'PENDING', label = '') => {
    if (state === 'REJECTED') {
      setPicked([]); setOwnReason(''); setReject({ docId, stage, label });
      if (!reasons) client.get<string[]>(`/claims/${id}/reject-reasons`, 'org').then(setReasons).catch(() => setReasons([]));
      return;
    }
    act(() => client.post(`/claims/${id}/documents/${docId}/review`, { stage, state }, 'org'));
  };
  const confirmReject = () => {
    if (!reject) return;
    const note = [...picked, ownReason.trim()].filter(Boolean).join('؛ ') || undefined;
    const r = reject; setReject(null);
    act(() => client.post(`/claims/${id}/documents/${r.docId}/review`, { stage: r.stage, state: 'REJECTED', note }, 'org'));
  };
  // Operator uploads (or replaces) a required document from ارزیابی.
  const uploadDoc = async (code: string, file: File, onProgress: OnProgress) => {
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'org', onProgress);
    await load();
  };
  const saveFinalized = () => act(() => client.put(`/claims/${id}/finalized-amount`, { amount: finalAmt }, 'org'));

  // The checkpoint(s) this operator may actually set (from the docs' canEdit flags).
  const myStages = useMemo(() => {
    const s = new Set<string>();
    checklist?.items.forEach((it) => it.documents.forEach((d) => d.reviews?.forEach((r) => { if (r.canEdit) s.add(r.stage); })));
    return [...s];
  }, [checklist]);
  const myStageLabel = myStages.map((s) => STAGE_LABEL[s]).join('، ');

  // Every document to review — each required item (latest file, or none yet: the operator may upload it)
  // + any other uploads.
  const rows = useMemo(() => {
    const out: { label: string; code: string | null; d: ClaimDoc | null }[] = [];
    checklist?.items.forEach((it) => out.push({ label: it.label, code: it.code, d: it.documents.find((x) => x.isLatest) || it.documents[0] || null }));
    checklist?.otherDocuments?.filter((d) => d.isLatest).forEach((d) => out.push({ label: d.fileName, code: null, d }));
    return out;
  }, [checklist]);
  const reviewDocs = useMemo(() => rows.filter((r): r is { label: string; code: string | null; d: ClaimDoc } => !!r.d), [rows]);

  // Bulk-approve every latest document at the operator's stage.
  const approveAllMyStage = () => act(async () => {
    const stage = myStages[0]; if (!stage) return;
    for (const { d } of reviewDocs) await client.post(`/claims/${id}/documents/${d.id}/review`, { stage, state: 'APPROVED' }, 'org');
  });

  const amt = (v?: string | null) => (v ? `${Number(v).toLocaleString('fa-IR')} ریال` : null);
  const closed = claim ? ['PAID', 'REJECTED'].includes(claim.status) : false;

  return (
    <Shell title={claim ? `ارزیابی ${caseTitle(claim)}` : 'ارزیابی پرونده'} breadcrumb="ارزیابی پرونده" nav={ORG_NAV} realm="org"
      action={<button onClick={() => router.push('/org/work-desk')} className="btn btn-ghost btn-sm">بستن ✕</button>}>
      <ErrorBox message={error} />
      {!claim ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده…" /></div> : (
        <div className="assess-split">
          {/* RIGHT (first in RTL): evaluation form */}
          <div className="assess-pane">
            <div className="assess-form-inner space-y-4">
              {/* Claim summary */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <ClaimTypeBadge type={claim.claimType} />
                  <StatusBadge status={claim.status} />
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌شده (متوفی)</span><span className="font-semibold">{claim.deceasedName || '—'}</span></div>
                  {claim.policyHolder?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌گزار</span><span className="font-semibold">{claim.policyHolder.name}</span></div>}
                  {claim.broker?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>معرف</span><span className="font-semibold">{claim.broker.name}</span></div>}
                  {claim.insurer?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌گر</span><span className="font-semibold">{claim.insurer.name}{claim.sellingBranchName ? ` — ${claim.sellingBranchName}` : ''}</span></div>}
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>مبلغ برآوردی</span><span className="font-semibold">{amt(claim.estimatedAmount ?? claim.claimedAmount)}</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>مبلغ قطعی</span><span className="font-semibold" style={{ color: claim.finalizedAmount ? 'var(--success)' : 'var(--muted)' }}>{amt(claim.finalizedAmount) || '— پس از ارزیابی'}</span></div>
                  {claim.deceasedBirthDate && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>تاریخ تولد</span><span className="font-semibold">{claim.deceasedBirthDate}</span></div>}
                  {claim.eventDate && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>{['DEATH_ILLNESS', 'DEATH_ACCIDENT'].includes(claim.claimType) ? 'تاریخ فوت' : 'تاریخ حادثه'}</span><span className="font-semibold">{claim.eventDate}</span></div>}
                  {claim.deceasedAge != null && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>{['DEATH_ILLNESS', 'DEATH_ACCIDENT'].includes(claim.claimType) ? 'سن متوفی' : 'سن بیمه‌شده'}</span><span className="font-semibold">{claim.deceasedAge.toLocaleString('fa-IR')} سال</span></div>}
                </div>
              </div>

              {/* Document review (3-stage) */}
              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-extrabold text-sm">بررسی و تایید مدارک</h3>
                  {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'مدارک کامل' : 'مدارک ناقص'}</span>}
                </div>
                <div className="space-y-2">
                  {rows.filter((r) => !r.d).map(({ label, code }) => (
                    <div key={`need-${code}`} className="rounded-xl p-2.5 as-doc as-missing">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate" title={label}>{label} <span style={{ color: 'var(--danger)' }}>— بارگذاری نشده</span></span>
                        {!closed && code && (
                          <UploadButton className="btn btn-solid btn-sm shrink-0" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera
                            title="بارگذاری مدرک" subtitle={label} onUpload={(f, onP) => uploadDoc(code, f, onP)}>بارگذاری</UploadButton>
                        )}
                      </div>
                    </div>
                  ))}
                  {reviewDocs.map(({ label, code, d }) => (
                    <div key={d.id} className={`rounded-xl p-2.5 as-doc${d.reviews?.length && d.reviews.every((r) => r.state === 'APPROVED') ? ' is-approved' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate" title={label}>{label}</span>
                        <span className="flex flex-col gap-1 shrink-0">
                          <button onClick={() => document.getElementById(`doc-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="btn btn-ghost btn-sm" title="نمایش در تصویر">نمایش سند</button>
                          {!closed && (
                            <UploadButton className="btn btn-ghost btn-sm" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera
                              title="بارگذاری دوبارهٔ مدرک" subtitle={label} note="فایل تازه جایگزین نسخهٔ فعلی می‌شود؛ نسخهٔ قبلی در سوابق پرونده می‌ماند."
                              onUpload={(f, onP) => uploadDoc(code || 'OTHER', f, onP)}>بارگذاری</UploadButton>
                          )}
                        </span>
                      </div>
                      {d.reviews && d.reviews.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-xs">
                          {d.reviews.map((rv) => {
                            const editable = rv.canEdit && d.isLatest && !closed;
                            return (
                              <span key={rv.stage} className="flex items-center gap-1.5">
                                {/* Hover: last change (time + operator); click: every change on this document, explained. */}
                                <button type="button" className="as-stage" data-tip={rv.changedAt ? `آخرین تغییر: ${rv.changedAt}${rv.changedBy ? ` — ${rv.changedBy}` : ''}${(rv.changes ?? 0) > 1 ? ` (${(rv.changes ?? 0).toLocaleString('fa-IR')} تغییر — برای جزئیات کلیک کنید)` : ''}` : 'هنوز تغییری ثبت نشده'}
                                  onClick={() => (rv.changes ?? 0) > 0 && openHistory(d.id, label)} aria-label={`سابقهٔ ${STAGE_LABEL[rv.stage] || rv.stage}`}>
                                  {STAGE_LABEL[rv.stage] || rv.stage}:
                                  {(rv.changes ?? 0) > 1 && <span className="as-count">{(rv.changes ?? 0).toLocaleString('fa-IR')}</span>}
                                </button>
                                <ReviewButtons state={rv.state} editable={editable} busy={busy} label={STAGE_LABEL[rv.stage]} onSet={(st) => reviewDoc(d.id, rv.stage, st, label)} />
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  {reviewDocs.length === 0 && (
                    <div className="text-xs text-center py-3" style={{ color: 'var(--muted)' }}>مدرکی بارگذاری نشده است.</div>
                  )}
                </div>
                {myStages.length > 0 && !closed && (
                  <button onClick={approveAllMyStage} disabled={busy} className="btn btn-solid btn-sm w-full mt-3">تایید همهٔ مدارک در مرحلهٔ {myStageLabel}</button>
                )}
              </div>

              {/* Finalized amount */}
              {canProcess && !closed && (
                <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <label className="label">مبلغ خسارت قطعی (پس از ارزیابی)</label>
                  <div className="flex items-center gap-2">
                    <input className="input" style={{ direction: 'ltr', textAlign: 'right' }} inputMode="numeric"
                      value={finalAmt ? Number(String(finalAmt).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR') : ''}
                      onChange={(e) => setFinalAmt(e.target.value.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))))}
                      placeholder="مبلغ به ریال" />
                    <button onClick={saveFinalized} disabled={busy || !finalAmt} className="btn btn-primary btn-sm shrink-0">ثبت</button>
                  </div>
                </div>
              )}

              {/* Workflow actions (server-offered for this desk) */}
              {claim.workflow && (
                <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <WorkflowPanel claimId={id} workflow={claim.workflow} realm="org" onDone={load} compact />
                </div>
              )}

              <div className="border-t pt-3 flex gap-2" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => router.push(`/org/claims/${id}`)} className="btn btn-ghost btn-sm">مشاهدهٔ کامل پرونده</button>
                <button onClick={() => router.push('/org/work-desk')} className="btn btn-ghost btn-sm mr-auto">بعداً بررسی می‌کنم</button>
              </div>
            </div>
          </div>

          {/* LEFT: documents viewer (scrolls independently) */}
          <div className="assess-pane assess-docs">
            <div className="assess-toolbar">
              <span>اسناد بارگذاری‌شده ({docs.length.toLocaleString('fa-IR')})</span>
              {docs.length > 0 && (
                <button className="zbtn as-dl" onClick={downloadAll} disabled={busy} title="دریافت همهٔ مدارک (فایل ZIP)" aria-label="دریافت همهٔ مدارک">
                  <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                </button>
              )}
              <span className="mr-auto flex items-center gap-1.5">
                <button className="zbtn" onClick={() => setZoom((z) => Math.max(40, z - 15))} title="کوچک‌تر">−</button>
                <span style={{ minWidth: 44, textAlign: 'center' }}>{zoom.toLocaleString('fa-IR')}٪</span>
                <button className="zbtn" onClick={() => setZoom((z) => Math.min(250, z + 15))} title="بزرگ‌تر">+</button>
              </span>
            </div>
            {docs.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>سندی بارگذاری نشده است.</div>
            ) : docs.map((d) => (
              <div key={d.id} id={`doc-${d.id}`} className="assess-doc">
                <div className="assess-doc-head">
                  <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>{d.fileName}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button onClick={() => client.download(`/claims/${id}/documents/${d.id}/file`, 'org', d.fileName).catch((e) => setError(e.message))} className="zbtn as-dl" title="دریافت همین مدرک" aria-label="دریافت مدرک">
                      <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </button>
                    <button onClick={() => client.view(`/claims/${id}/documents/${d.id}/file`, 'org')} className="btn btn-ghost btn-sm">باز کردن</button>
                  </span>
                </div>
                <DocMedia claimId={id} docId={d.id} fileName={d.fileName} zoom={zoom} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* «سابقهٔ تغییرات» of one document: every ✓/✕ with its time, operator and what it means */}
      {history && (
        <Overlay onClose={() => setHistory(null)}>
          <div className="pmodal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="pmodal-head">
              <span className="pmodal-title">سابقهٔ تغییرات — {history.title}</span>
              <button className="pmodal-x" onClick={() => setHistory(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body">
              {!history.entries ? <div className="py-6 flex justify-center"><Spinner /></div>
                : history.entries.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>تغییری ثبت نشده است.</p>
                : (
                  <ol className="as-hist">
                    {history.entries.map((h, i) => (
                      <li key={i} className={h.state === 'APPROVED' ? 'is-ok' : h.state === 'REJECTED' ? 'is-no' : ''}>
                        <div className="as-hist-at">{h.at}{h.stageLabel ? ` — ${h.stageLabel}` : ''}</div>
                        <div>{h.text}</div>
                      </li>
                    ))}
                  </ol>
                )}
            </div>
          </div>
        </Overlay>
      )}
      {reject && (
        <Overlay onClose={() => setReject(null)}>
          <div className="pmodal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">دلیل رد مدرک{reject.label ? ` — ${reject.label}` : ''}</span>
              <button className="pmodal-x" onClick={() => setReject(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3 text-sm">
              {!reasons ? <div className="flex justify-center py-4"><Spinner size={32} /></div> : reasons.length > 0 ? (
                <fieldset className="space-y-1.5">
                  <legend className="label">دلایل رد (یک یا چند مورد)</legend>
                  {reasons.map((r) => (
                    <label key={r} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={picked.includes(r)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, r] : p.filter((x) => x !== r))} />
                      <span>{r}</span>
                    </label>
                  ))}
                </fieldset>
              ) : <div className="text-xs" style={{ color: 'var(--muted)' }}>فهرست دلایل رد هنوز در «تنظیمات سازمان» تعریف نشده است؛ دلیل را بنویسید.</div>}
              <div>
                <label className="label">دلیل دیگر (اختیاری)</label>
                <textarea className="input" rows={2} value={ownReason} onChange={(e) => setOwnReason(e.target.value)} maxLength={500} placeholder="شرح دلیل رد مدرک" />
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>دلایل برای بیمه‌گزار نمایش داده می‌شود تا مدرک را اصلاح کند.</div>
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setReject(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
              <button onClick={confirmReject} disabled={busy} className="flex-1 py-3 font-bold" style={{ color: 'var(--danger)' }}>رد مدرک</button>
            </div>
          </div>
        </Overlay>
      )}
    </Shell>
  );
}
