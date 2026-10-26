'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../../lib/client';
import { CLAIM_TYPE_LABELS, ErrorBox, Spinner } from '../../../components/ui';
import { Icon, Shell } from '../../../components/Shell';
import { CUSTOMER_NAV } from '../../nav';
import { WorkflowPanel } from '../../../components/WorkflowPanel';
import { caseTitle } from '../../../../lib/caseTitle';
import { CaseHero, ChecklistItem, ClaimDoc, ICONS, STATUS_FA, useCase } from '../../../components/case-ui';
import { DocUploadTile, OnProgress } from '../../../components/upload';

const DESK_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'مدیریت ستاد', COUNCIL: 'شورای فنی' };
const OK = 'M20 6L9 17l-5-5';
const NO = 'M18 6L6 18M6 6l12 12';
const RESULT_KEY = (id: string) => `submitResult:${id}`;

/** Upload state of one checklist row while a file is going up, or the outcome right after. */
type UpState = { pct: number; eta: number | null } | { done: true } | { error: string };

/** Plain-language status of one required document, from its upload and every desk's decision. */
function docStory(it: ChecklistItem): { tone: 'ok' | 'bad' | 'wait' | 'none'; text: string } {
  const d = it.documents[0];
  if (!d) return { tone: 'none', text: 'هنوز بارگذاری نشده است' };
  const rv = d.reviews ?? [];
  const rejected = rv.find((r) => r.state === 'REJECTED');
  if (rejected) return { tone: 'bad', text: `${DESK_FA[rejected.stage] || rejected.stage} این مدرک را رد کرد؛ لطفاً مدرک صحیح را دوباره بارگذاری کنید` };
  if (rv.length && rv.every((r) => r.state === 'APPROVED')) return { tone: 'ok', text: 'این مدرک در همهٔ مراحل تایید شده است' };
  const done = rv.filter((r) => r.state === 'APPROVED').map((r) => DESK_FA[r.stage]);
  const next = rv.find((r) => r.state !== 'APPROVED');
  if (done.length) return { tone: 'wait', text: `تایید ${done.join('، ')} — در انتظار بررسی ${next ? DESK_FA[next.stage] : ''}` };
  return { tone: 'wait', text: 'بارگذاری شد — در انتظار بررسی کارگزاری' };
}

/**
 * بیمه‌گزار — «جزئیات پرونده»: the case header card, every required document with its precise review
 * trail and an upload ring, then «روند پرونده» (its own page) and «ثبت نهایی» (send the documents on).
 */
export default function CustomerClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { claim, checklist, error, setError, reload } = useCase(id, 'customer');
  const [insurers, setInsurers] = useState<Record<string, string>>({});
  const [lateWarn, setLateWarn] = useState(true);
  const [up, setUp] = useState<Record<string, UpState>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ id: string; name: string }[]>('/customer/insurers', 'customer').then((a) => setInsurers(Object.fromEntries(a.map((i) => [i.id, i.name])))).catch(() => {});
    client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', 'customer').then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by the document's upload dialog: progress goes both to the dialog/tile ring and to `up`
  // (so «ثبت نهایی» knows an upload is still running); a failure is re-thrown for the dialog to show.
  const upload = async (code: string, file: File, onProgress: OnProgress) => {
    setError('');
    setUp((u) => ({ ...u, [code]: { pct: 0, eta: null } }));
    try {
      const fd = new FormData(); fd.append('file', file);
      await client.upload(`/customer/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'customer',
        (pct, eta) => { onProgress(pct, eta); setUp((u) => ({ ...u, [code]: { pct, eta } })); });
      setUp((u) => ({ ...u, [code]: { done: true } }));
      await reload();
    } catch (e: any) {
      setUp((u) => ({ ...u, [code]: { error: e.message } }));
      throw e;
    }
  };
  const viewDoc = (docId: string) => client.view(`/customer/claims/${id}/documents/${docId}/file`, 'customer').catch((e) => setError(e.message));

  const atMyDesk = claim?.workflow?.currentStage === 'POLICYHOLDER';
  const submitAction = claim?.workflow?.actions.find((a) => a.key === 'SUBMIT');
  const uploading = Object.values(up).some((s) => 'pct' in s);

  /** «ثبت نهایی»: check the documents, send the case on, and show the outcome on its own page. */
  const finalSubmit = async () => {
    if (!checklist || !claim) return;
    const missing = checklist.items.filter((it) => !it.uploaded).map((it) => it.label);
    const rejected = checklist.items.filter((it) => it.documents[0]?.reviews?.some((r) => r.state === 'REJECTED')).map((it) => it.label);
    const fail = (reason: string, items: string[] = []) => {
      try { sessionStorage.setItem(RESULT_KEY(id), JSON.stringify({ ok: false, reason, items })); } catch { /* ignore */ }
      router.push(`/customer/claims/${id}/result`);
    };
    if (uploading) return fail('بارگذاری یک یا چند مدرک هنوز تمام نشده است؛ پس از پایان بارگذاری دوباره «ثبت نهایی» را بزنید.');
    if (missing.length) return fail('مدارک زیر هنوز بارگذاری نشده‌اند؛ پس از بارگذاری همهٔ مدارک دوباره «ثبت نهایی» را بزنید:', missing);
    if (rejected.length) return fail('مدارک زیر رد شده‌اند و باید مدرک صحیح جایگزین شود:', rejected);
    if (submitAction?.disabled) return fail(submitAction.disabled);
    setSending(true);
    try {
      await client.post(`/customer/claims/${id}/rectify`, {}, 'customer');
      try { sessionStorage.setItem(RESULT_KEY(id), JSON.stringify({ ok: true })); } catch { /* ignore */ }
      router.push(`/customer/claims/${id}/result`);
    } catch (e: any) {
      fail(e.message || 'ثبت مدارک انجام نشد؛ لطفاً دوباره تلاش کنید.');
    } finally { setSending(false); }
  };

  const physicalMoves = (claim?.workflow?.physical?.actions.length ?? 0) > 0;

  return (
    <Shell title="جزئیات پرونده" breadcrumb="جزئیات پرونده" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <div className="space-y-5 max-w-4xl mx-auto">
        <ErrorBox message={error} />
        {!claim ? <div className="pcard p-10 text-center"><Spinner /></div> : (
          <>
            <div className="cs-sheet">
              <CaseHero
                title={caseTitle(claim)} claim={claim}
                sub={`${CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType} — ${claim.deceasedName || '—'}`}
                chips={claim.insurerTenantId && insurers[claim.insurerTenantId] ? [{ label: 'بیمه‌گر', value: insurers[claim.insurerTenantId], icon: ICONS.policy }] : []}
                notesLabel="وضعیت پرونده:" notes={STATUS_FA[claim.status] ?? claim.status} exitHref="/customer" />
            </div>
            {claim.lateNotice && lateWarn && <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر بوده است (مهلت: {claim.noticeDeadline}).</div>}
            {claim.description && <div className="pcard p-4 text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}><b style={{ color: 'var(--text)' }}>توضیحات: </b>{claim.description}</div>}

            {claim.status === 'RETURNED_INCOMPLETE' && (
              <div className="pcard p-6" style={{ borderColor: 'var(--danger)' }}>
                <h3 className="font-bold mb-2">نقص مدارک — نیازمند اقدام شما</h3>
                {(claim.deficiencies || []).filter((d) => !d.resolvedAt).map((d, i) => (
                  <ul key={i} className="mr-4 list-disc text-sm" style={{ color: 'var(--danger)' }}>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
                ))}
                <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>مدارک خواسته‌شده را جایگزین و سپس «ثبت نهایی» را بزنید.</p>
              </div>
            )}

            {/* The originals were asked for: the move stays right here, not only in «روند پرونده». */}
            {physicalMoves && claim.workflow && (
              <div className="pcard p-6"><h3 className="font-extrabold mb-3">اصل مدارک</h3><WorkflowPanel claimId={id} workflow={{ ...claim.workflow, actions: claim.workflow.actions.filter((a) => a.key !== 'SUBMIT') }} realm="customer" onDone={reload} /></div>
            )}

            <div className="pcard p-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-extrabold">مدارک مورد نیاز</h3>
                {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
              </div>
              <div className="space-y-2.5">
                {checklist?.items.map((it) => {
                  const story = docStory(it);
                  const st = up[it.code];
                  const d = it.documents[0] as ClaimDoc | undefined;
                  const older = it.documents.slice(1);
                  return (
                    <div key={it.code} className={`doc-row cu-doc tone-${story.tone}`}>
                      <div className="cu-doc-head">
                        <div className="text-sm min-w-0">
                          <div className="font-bold">{it.label}</div>
                          <div className="cu-story">{story.text}</div>
                        </div>
                        <div className="cu-doc-up">
                          <DocUploadTile label={it.label} uploaded={it.uploaded} rejected={story.tone === 'bad'}
                            onUpload={(f, onP) => upload(it.code, f, onP)} />
                        </div>
                      </div>
                      {st && 'error' in st && <div className="cu-err">بارگذاری انجام نشد: {st.error}</div>}

                      {/* Precise trail of the current file: when it was uploaded, then each desk's decision */}
                      {d && (
                        <div className="cu-trail">
                          <span className="cu-step is-ok"><Icon path={OK} />بارگذاری{d.uploadedAt ? ` — ${d.uploadedAt}` : ''}{d.version > 1 ? ` (نسخهٔ ${d.version.toLocaleString('fa-IR')})` : ''}</span>
                          {(d.reviews ?? []).map((r) => (
                            <span key={r.stage} className={`cu-step is-${r.state === 'APPROVED' ? 'ok' : r.state === 'REJECTED' ? 'no' : 'wait'}`} title={r.note ? `دلیل: ${r.note}` : undefined}>
                              <Icon path={r.state === 'APPROVED' ? OK : r.state === 'REJECTED' ? NO : 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 7v5l3 2'} />
                              {DESK_FA[r.stage] || r.stage}: {r.state === 'APPROVED' ? 'تایید شد' : r.state === 'REJECTED' ? 'رد شد' : 'در انتظار بررسی'}{r.changedAt && r.state !== 'PENDING' ? ` — ${r.changedAt}` : ''}
                            </span>
                          ))}
                          <button type="button" className="cu-view" onClick={() => viewDoc(d.id)}><Icon path="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z" /> مشاهدهٔ فایل</button>
                          {(d.reviews ?? []).filter((r) => r.state === 'REJECTED' && r.note).map((r) => (
                            <div key={`n-${r.stage}`} className="cu-reason">دلیل رد ({DESK_FA[r.stage]}): {r.note}</div>
                          ))}
                        </div>
                      )}
                      {older.length > 0 && (
                        <details className="cu-older">
                          <summary>نسخه‌های قبلی ({older.length.toLocaleString('fa-IR')})</summary>
                          {older.map((o) => (
                            <div key={o.id} className="flex items-center justify-between gap-2 py-1">
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>نسخهٔ {o.version.toLocaleString('fa-IR')} — {o.uploadedAt} — {o.statusLabel}</span>
                              <button type="button" className="cu-view" onClick={() => viewDoc(o.id)}>مشاهده</button>
                            </div>
                          ))}
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="cs-actions">
              <Link href={`/customer/claims/${id}/workflow`} className="cs-act"><Icon path={ICONS.list} /> روند پرونده</Link>
              {atMyDesk ? (
                <button type="button" className="cs-act cu-final" onClick={finalSubmit} disabled={sending}>
                  <Icon path={OK} /> {sending ? 'در حال ثبت…' : 'ثبت نهایی'}
                </button>
              ) : (
                <span className="cu-sent"><Icon path={OK} /> {claim.workflow?.currentStage
                  ? <>مدارک ثبت نهایی شده و پرونده نزد «{claim.workflow.currentStageLabel}» است.</>
                  : <>پرونده بسته شده است ({STATUS_FA[claim.status] ?? claim.status}).</>}</span>
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
