'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../../lib/client';
import { Shell, Icon } from '../../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, StatusBadge } from '../../../components/ui';
import { ORG_NAV } from '../../nav';
import { FieldsSection } from './fields-section';

interface DocReview { stage: string; state: string; canEdit: boolean }
interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; uploadedAt: string | null; version: number; isLatest: boolean; reviews?: DocReview[] }
interface ChecklistItem { code: string; label: string; uploaded: boolean; latestStatus: string | null; documents: ClaimDoc[] }
interface Checklist { claimType: string; complete: boolean; items: ChecklistItem[] }

const DOC_BADGE: Record<string, string> = { PENDING: 'badge-warning', VERIFIED: 'badge-success', REJECTED: 'badge-danger', NEEDS_INFO: 'badge-warning' };
interface StepPerson { name: string | null; phone: string | null; nationalCode: string | null }
interface Step { order: number; partyType: string; state: string; holderName?: string | null; holderKind?: string | null; branchName?: string | null; levelName?: string | null; decidedByName?: string | null; decidedAt?: string | null; person?: StepPerson | null }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  claimedAmount: string; eventDate: string | null; noticeDeadline: string | null; lateNotice: boolean;
  description?: string | null;
  policyHolder?: { name: string | null; nationalCode: string | null } | null;
  insurer?: { name: string } | null;
  broker?: { name: string } | null;
  sellingBranchName?: string | null;
  steps?: Step[];
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
}

const STEP_PARTY: Record<string, string> = { POLICYHOLDER: 'بیمه‌گزار', MOAREF: 'معرف', INSURER_LEVEL: 'سطح بیمه‌گر' };
const STEP_STATE: Record<string, string> = { PENDING: 'در انتظار', FORWARDED: 'ارسال‌شده', ESCALATED: 'ارجاع به بالاتر', APPROVED: 'تایید', RETURNED_INCOMPLETE: 'نقص مدارک', REJECTED: 'رد', ACKED: 'ثبت' };

// Icon paths
const ICON_CHECK = 'M20 6L9 17l-5-5';
const ICON_X = 'M6 18L18 6M6 6l12 12';
const ICON_CAM = 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z';

// The three claim approval checkpoints shown beside each document.
const STAGE_LABEL: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', COUNCIL: 'ستاد' };

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [defText, setDefText] = useState('');
  const [showDef, setShowDef] = useState(false);
  const [tab, setTab] = useState<'info' | 'workflow' | 'docs' | 'route'>('info'); // اطلاعات ↔ گردش کار ↔ مدارک ↔ مسیر
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const camRefs = useRef<Record<string, HTMLInputElement | null>>({}); // mobile camera capture
  // UI-gating by permission (the API enforces these independently).
  const canProcess = hasPerm('org', 'claim:process'); // تایید/رد/پرداخت/اعلام نقص
  const canFile = hasPerm('org', 'claim:file'); // بارگذاری مدرک / رفع نقص
  const canDelete = hasPerm('org', 'claim:delete'); // حذف پرونده (مدیر سازمان)

  const removeClaim = async () => {
    if (!claim) return;
    if (!window.confirm(`حذف پرونده ${claim.claimNumber}؟ پرونده به سطل بازیافت منتقل می‌شود و تا ۱۴ روز قابل بازیابی است؛ پس از آن برای همیشه حذف خواهد شد.`)) return;
    setError(''); setBusy(true);
    try { await client.del(`/claims/${id}`, 'org'); router.push('/org/claims/trash'); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  const [lateWarn, setLateWarn] = useState(true); // org's "show late-notice warning" setting
  const load = async () => {
    try {
      const [c, cl] = await Promise.all([client.get<Claim>(`/claims/${id}`, 'org'), client.get<Checklist>(`/claims/${id}/checklist`, 'org')]);
      setClaim(c); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', 'org').then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

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

  // Set one checkpoint's approval on a document (toggling the same icon clears it back to under-review).
  const reviewDoc = (docId: string, stage: string, state: 'APPROVED' | 'REJECTED' | 'PENDING') => act(async () => {
    let note: string | undefined;
    if (state === 'REJECTED') { note = window.prompt('دلیل رد (اختیاری):') || undefined; }
    await client.post(`/claims/${id}/documents/${docId}/review`, { stage, state, note }, 'org');
  });

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
        <div className="space-y-5">
          {claim.lateNotice && lateWarn && (
            <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر انجام شده است (مهلت: {claim.noticeDeadline}).</div>
          )}

          {/* Header: key facts + parties (full width) */}
          <div className="card p-5">
            <div className="flex justify-between items-center mb-3">
              <span className="font-bold text-lg">{CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType}</span>
              <StatusBadge status={claim.status} />
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6">
              <Row label="بیمه‌شده (متوفی)" value={claim.deceasedName} />
              <Row label="مبلغ خسارت" value={`${Number(claim.claimedAmount).toLocaleString('fa-IR')} ریال`} />
              <Row label="تاریخ وقوع" value={claim.eventDate} />
              <Row label="مهلت اعلام" value={claim.noticeDeadline} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-3 pt-3 border-t text-sm" style={{ borderColor: 'var(--border)' }}>
              {claim.policyHolder && (
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>بیمه‌گزار</div>
                  <div className="font-semibold">{claim.policyHolder.name || '—'}</div>
                  {claim.policyHolder.nationalCode && <div className="text-xs" style={{ color: 'var(--muted)', direction: 'ltr', textAlign: 'right' }}>کد ملی: {claim.policyHolder.nationalCode}</div>}
                </div>
              )}
              {claim.broker && (
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>معرف (کارگزاری/نمایندگی)</div>
                  <div className="font-semibold">{claim.broker.name}</div>
                </div>
              )}
              {claim.insurer && (
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>بیمه‌گر</div>
                  <div className="font-semibold">{claim.insurer.name}</div>
                  {claim.sellingBranchName && <div className="text-xs" style={{ color: 'var(--muted)' }}>شعبه فروشنده: {claim.sellingBranchName}</div>}
                </div>
              )}
            </div>
            {claim.description && (
              <div className="mt-3 text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>توضیحات بیمه‌گزار: {claim.description}</div>
            )}
          </div>

          {/* Action bar (full width) */}
          {(canProcess || canFile || canDelete) && (
            <div className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold ml-1">اقدامات:</span>
                {['PAID', 'REJECTED'].includes(claim.status) ? (
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>پرونده بسته شده است.</span>
                ) : claim.status === 'RETURNED_INCOMPLETE' ? (
                  canFile
                    ? <button onClick={rectify} disabled={busy} className="btn btn-primary btn-sm">رفع نقص و ارسال مجدد</button>
                    : <span className="text-sm" style={{ color: 'var(--muted)' }}>در انتظار رفع نقص توسط بیمه‌گزار.</span>
                ) : claim.status === 'APPROVED' ? (
                  canProcess
                    ? <button onClick={pay} disabled={busy} className="btn btn-primary btn-sm">ثبت پرداخت</button>
                    : <span className="text-sm" style={{ color: 'var(--muted)' }}>در انتظار ثبت پرداخت.</span>
                ) : canProcess ? (
                  <>
                    <button onClick={endorse} disabled={busy} className="btn btn-primary btn-sm">تایید و ارسال</button>
                    <button onClick={() => setShowDef(!showDef)} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--warning)' }}>اعلام نقص مدارک</button>
                    <button onClick={reject} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>رد پرونده</button>
                  </>
                ) : canFile ? (
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>مدارک را در بخش «مدارک» بارگذاری کنید.</span>
                ) : (
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>اقدامی برای نقش شما در دسترس نیست.</span>
                )}
                {canDelete && <button onClick={removeClaim} disabled={busy} className="btn btn-ghost btn-sm mr-auto" style={{ color: 'var(--danger)' }} title="انتقال به سطل بازیافت (۱۴ روز قابل بازیابی)">حذف پرونده</button>}
              </div>
              {showDef && canProcess && (
                <div className="space-y-2 mt-3">
                  <textarea value={defText} onChange={(e) => setDefText(e.target.value)} placeholder="هر مورد نقص در یک خط" className="input" rows={3} />
                  <button onClick={returnIncomplete} disabled={busy} className="btn btn-sm" style={{ background: 'var(--warning)', color: '#fff' }}>ارسال نقص مدارک</button>
                </div>
              )}
            </div>
          )}

          {/* Tabs (full width) */}
          <div className="card p-1.5 flex gap-1.5 text-xs sm:text-sm overflow-x-auto">
            <button type="button" onClick={() => setTab('info')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'info' ? 'btn-primary' : 'btn-ghost'}`}>اطلاعات پرونده</button>
            <button type="button" onClick={() => setTab('workflow')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'workflow' ? 'btn-primary' : 'btn-ghost'}`}>مراحل و گردش کار</button>
            <button type="button" onClick={() => setTab('docs')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'docs' ? 'btn-primary' : 'btn-ghost'}`}>
              مدارک{checklist && !checklist.complete ? <span style={{ color: 'var(--warning)' }}> ●</span> : null}
            </button>
            <button type="button" onClick={() => setTab('route')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'route' ? 'btn-primary' : 'btn-ghost'}`}>مسیر گردش کار</button>
          </div>

          {tab === 'info' && <FieldsSection claimId={id} realm="org" basePath="/claims" groups={['CLAIM_DATA', 'BENEFICIARY']} />}
          {tab === 'workflow' && <FieldsSection claimId={id} realm="org" basePath="/claims" groups={['WORKFLOW_STAGE']} />}

          {tab === 'docs' && (
            <>
              <div className="card p-5">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold">مدارک مورد نیاز</h3>
                  {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
                </div>
                <div className="space-y-3">
                  {checklist?.items.map((it) => (
                    <div key={it.code} className="py-2 border-b" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm flex items-center gap-2">
                          <span style={{ color: it.uploaded ? 'var(--success)' : 'var(--muted)' }}>{it.uploaded ? '✔' : '○'}</span>
                          {it.label}
                        </span>
                        {canFile && (
                          <div className="flex items-center gap-1.5">
                            <input ref={(el) => { fileRefs.current[it.code] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                              onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                            <input ref={(el) => { camRefs.current[it.code] = el; }} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                              onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                            <button onClick={() => camRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm sm:hidden" title="گرفتن عکس با دوربین" aria-label="دوربین"><Icon path={ICON_CAM} /></button>
                            <button onClick={() => fileRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm">بارگذاری جایگزین</button>
                          </div>
                        )}
                      </div>
                      {it.documents.length > 0 && (
                        <div className="mt-2 space-y-1.5 mr-6">
                          {it.documents.map((d) => (
                            <div key={d.id} className="rounded-lg px-2 py-2" style={{ background: d.isLatest ? 'var(--brand-soft)' : 'var(--surface-2)', opacity: d.isLatest ? 1 : 0.75 }}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs flex items-center gap-2 min-w-0 flex-wrap">
                                  <span className="badge badge-neutral shrink-0">نسخه {d.version}</span>
                                  {d.isLatest && <span className="badge badge-success shrink-0">جدیدترین</span>}
                                  <span className={`badge ${DOC_BADGE[d.status] || 'badge-neutral'} shrink-0`}>{d.statusLabel}</span>
                                  <span className="truncate" style={{ color: 'var(--muted)' }}>{d.uploadedAt}</span>
                                </span>
                                <button onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm shrink-0">مشاهده</button>
                              </div>
                              {d.reviews && d.reviews.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border)' }}>
                                  {d.reviews.map((rv) => {
                                    const editable = rv.canEdit && d.isLatest && !['PAID', 'REJECTED'].includes(claim.status);
                                    return (
                                      <span key={rv.stage} className="flex items-center gap-1">
                                        <span style={{ color: 'var(--muted)' }}>{STAGE_LABEL[rv.stage] || rv.stage}:</span>
                                        {editable ? (
                                          <>
                                            <button onClick={() => reviewDoc(d.id, rv.stage, rv.state === 'APPROVED' ? 'PENDING' : 'APPROVED')} disabled={busy} title="تایید" aria-label="تایید"
                                              className="inline-flex p-0.5 rounded" style={{ color: rv.state === 'APPROVED' ? 'var(--success)' : 'var(--muted)' }}><Icon path={ICON_CHECK} /></button>
                                            <button onClick={() => reviewDoc(d.id, rv.stage, rv.state === 'REJECTED' ? 'PENDING' : 'REJECTED')} disabled={busy} title="رد" aria-label="رد"
                                              className="inline-flex p-0.5 rounded" style={{ color: rv.state === 'REJECTED' ? 'var(--danger)' : 'var(--muted)' }}><Icon path={ICON_X} /></button>
                                          </>
                                        ) : (
                                          <span title={rv.state === 'APPROVED' ? 'تایید' : rv.state === 'REJECTED' ? 'رد' : 'در حال بررسی'} style={{ color: rv.state === 'APPROVED' ? 'var(--success)' : rv.state === 'REJECTED' ? 'var(--danger)' : 'var(--warning)', fontWeight: 700 }}>
                                            {rv.state === 'APPROVED' ? '✓' : rv.state === 'REJECTED' ? '✕' : '●'}
                                          </span>
                                        )}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

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
            </>
          )}

          {tab === 'route' && (
            <div className="card p-5">
              <h3 className="font-bold mb-3">مسیر گردش کار</h3>
              <div className="space-y-3">
                {(claim.steps || []).map((s, i) => {
                  const active = s.state === 'PENDING';
                  const role = s.partyType === 'INSURER_LEVEL' ? (s.levelName || 'سطح بیمه‌گر') : (STEP_PARTY[s.partyType] || s.partyType);
                  const isPerson = s.holderKind === 'POLICYHOLDER';
                  const org = !isPerson && s.holderName ? `${s.holderKind === 'INSURER' ? 'بیمه‌گر' : s.holderKind === 'BROKER' ? 'کارگزاری' : ''} ${s.holderName}`.trim() : '';
                  const where = !isPerson && (s.branchName ? s.branchName : (s.holderKind ? 'دفتر مرکزی' : ''));
                  return (
                    <div key={i} className="flex gap-2.5 text-sm">
                      <span className="flex items-center justify-center rounded-full shrink-0 mt-0.5" style={{ width: 24, height: 24, background: active ? 'var(--brand)' : s.state === 'APPROVED' ? 'var(--success)' : 'var(--surface-2)', color: active || s.state === 'APPROVED' ? '#fff' : 'var(--muted)', fontSize: 11 }}>{s.order}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{role}</span>
                          <span className={`badge ${active ? 'badge-warning' : s.state === 'APPROVED' ? 'badge-success' : s.state === 'REJECTED' ? 'badge-danger' : 'badge-neutral'}`}>{STEP_STATE[s.state] || s.state}</span>
                        </div>
                        {org && <div className="text-xs" style={{ color: 'var(--muted)' }}>{org}{where ? ` — ${where}` : ''}</div>}
                        {isPerson && (
                          <details className="mt-0.5 text-xs">
                            <summary className="cursor-pointer select-none" style={{ color: 'var(--muted)' }}>
                              <span style={{ color: 'var(--text)' }}>{s.person?.name || 'بیمه‌گزار'}</span>
                              <span className="mr-1" style={{ color: 'var(--brand)' }}>— مشاهده اطلاعات</span>
                            </summary>
                            <div className="mt-1 rounded-lg p-2 space-y-0.5" style={{ background: 'var(--surface-2)' }}>
                              <div><span style={{ color: 'var(--muted)' }}>نام: </span>{s.person?.name || '—'}</div>
                              <div style={{ direction: 'ltr', textAlign: 'right' }}><span style={{ color: 'var(--muted)' }}>تلفن: </span>{s.person?.phone || '—'}</div>
                              <div style={{ direction: 'ltr', textAlign: 'right' }}><span style={{ color: 'var(--muted)' }}>کد ملی: </span>{s.person?.nationalCode || '—'}</div>
                            </div>
                          </details>
                        )}
                        {active && <div className="text-xs" style={{ color: 'var(--brand)' }}>در انتظار اقدام این مرحله</div>}
                        {s.decidedByName && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>اقدام‌کننده: {s.decidedByName}{s.decidedAt ? ` — ${s.decidedAt}` : ''}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
