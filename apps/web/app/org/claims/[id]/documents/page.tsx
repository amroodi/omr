'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { client, hasPerm } from '../../../../../lib/client';
import { Shell, Icon } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { ACTION_FA, STATE_FA } from '../../../../components/WorkflowPanel';
import { ORG_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { downloadPdf } from '../../../../../lib/pdf';
import { CaseHero, ClaimDoc, ICONS, NotesPill, PersonCards, phaseText, useCase } from '../../../../components/case-ui';
import { OnProgress, UploadButton } from '../../../../components/upload';

const DESK_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'ستاد', COUNCIL: 'شورای فنی' };
const OK = 'M20 6L9 17l-5-5';
const NO = 'M18 6L6 18M6 6l12 12';
const faN = (n: number) => n.toLocaleString('fa-IR');

/** ✓ / ✕ disc: green approved, red rejected, pale ✕ while the desk hasn't decided yet. */
function Mark({ state, title }: { state: 'ok' | 'no' | 'wait'; title: string }) {
  return <span className={`cs-mark is-${state === 'ok' ? 'ok' : state === 'no' ? 'no' : 'pending'}`} title={title}><Icon path={state === 'ok' ? OK : NO} /></span>;
}

/**
 * «بررسی وضعیت مدارک» (Group 875): every required document with its upload state and each desk's
 * ✓/✕, then the case's workflow route («مسیر گردش کار») with the same marks, and the deficiency history.
 */
export default function CaseDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const { claim, fv, checklist, error, setError, reload } = useCase(id);
  const sheet = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [canFile, setCanFile] = useState(false);
  useEffect(() => { setCanFile(hasPerm('org', 'claim:file')); }, []);

  // Desk columns: the review desks that appear on this case's documents (کارگزاری, شعبه, ستاد, شورای فنی).
  const manual = !!claim?.story?.manual; // completed by hand in «ویرایش» — its typed data has priority
  const desks = manual ? [] : (() => {
    const seen = new Set<string>();
    checklist?.items.forEach((it) => it.documents[0]?.reviews?.forEach((r) => seen.add(r.stage)));
    const order = ['BROKER', 'BRANCH', 'HQ', 'COUNCIL'];
    const list = order.filter((s) => seen.has(s));
    return list.length ? list : ['BROKER', 'BRANCH', 'HQ'];
  })();

  // From the document's upload dialog (which shows progress and any error itself).
  const upload = async (code: string, file: File, onProgress: OnProgress) => {
    setError('');
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'org', onProgress);
    await reload();
  };
  const pdf = async () => {
    if (!sheet.current || !claim) return;
    setSaving(true);
    try { await downloadPdf(sheet.current, `documents-${claim.policyNumber || claim.claimNumber}`); }
    catch (e: any) { setError(e?.message || 'ساخت فایل PDF ممکن نشد'); } finally { setSaving(false); }
  };

  const deskCell = (d: ClaimDoc | undefined, stage: string) => {
    const r = d?.reviews?.find((x) => x.stage === stage);
    const st = r?.state === 'APPROVED' ? 'ok' : r?.state === 'REJECTED' ? 'no' : 'wait';
    const when = r?.changedAt ? ` — ${r.changedAt}${r.changedBy ? ` (${r.changedBy})` : ''}` : '';
    return <Mark state={!d ? 'wait' : st} title={`${DESK_FA[stage]}: ${!d ? 'بارگذاری نشده' : st === 'ok' ? 'تایید' : st === 'no' ? 'رد' : 'در انتظار بررسی'}${when}`} />;
  };

  const rows = [
    ...(checklist?.items ?? []).map((it) => ({ key: it.code, code: it.code, label: it.label, doc: it.documents[0] as ClaimDoc | undefined })),
    ...(checklist?.otherDocuments ?? []).filter((d) => d.isLatest).map((d) => ({ key: d.id, code: '', label: `سایر مدارک — ${d.fileName}`, doc: d as ClaimDoc | undefined })),
  ];

  return (
    <Shell title={claim ? `مدارک — ${caseTitle(claim)}` : 'بررسی وضعیت مدارک'} breadcrumb="بررسی وضعیت مدارک" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim || !checklist ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری مدارک" /></div> : (
        <>
          <div ref={sheet} className="cs-sheet">
            <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={fv.case_notes || phaseText(claim)} back={`/org/claims/${id}`} />
            <PersonCards claim={claim} fv={fv} />

            <section className="cs-table">
              <div className="cs-table-h cs-grid-docs" style={{ ['--desks' as any]: desks.length }}>
                <span className="cs-th-n"><span className="cs-ico sm"><Icon path={ICONS.list} /></span></span>
                <span>بارگذاری</span>
                {desks.map((s) => <span key={s}>{DESK_FA[s]}</span>)}
                <span className="cs-th-doc">وضعیت</span>
              </div>
              <div className="cs-table-b">
                {rows.map((r, i) => (
                  <div key={r.key} className={`cs-tr cs-grid-docs${r.doc?.status === 'VERIFIED' ? ' is-done' : ''}`} style={{ ['--desks' as any]: desks.length }}>
                    <span className="cs-td-n">{faN(i + 1)}</span>
                    <span className="cs-td-up">
                      <Mark state={r.doc ? 'ok' : 'no'} title={r.doc ? `بارگذاری شده — ${r.doc.uploadedAt ?? ''}` : 'بارگذاری نشده'} />
                      {r.doc && <button type="button" className="cs-mini no-pdf" title="مشاهدهٔ فایل" onClick={() => client.view(`/claims/${id}/documents/${r.doc!.id}/file`, 'org').catch((e) => setError(e.message))}><Icon path="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z" /></button>}
                      {canFile && r.code && (
                        // This page keeps its own design (Group 875): the small orange «بارگذاری فایل» button —
                        // it opens the same upload window (progress, PDF / Word / images).
                        <UploadButton className="cs-upload no-pdf" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera
                          title={r.doc ? 'جایگزینی فایل' : 'بارگذاری فایل'} subtitle={r.label} onUpload={(f, onP) => upload(r.code, f, onP)}>
                          {r.doc ? 'جایگزینی فایل' : 'بارگذاری فایل'}
                        </UploadButton>
                      )}
                    </span>
                    {desks.map((s) => <span key={s} className="cs-td-desk">{deskCell(r.doc, s)}</span>)}
                    <span className="cs-td-doc">{r.label}</span>
                  </div>
                ))}
                <div className="cs-tr cs-foot">
                  <span className="cs-foot-l">توضیحات پرونده:</span>
                  <NotesPill text={checklist.complete ? (fv.case_notes || 'تکمیل شده') : (fv.case_notes || 'مدارک ناقص')} />
                </div>
              </div>
            </section>

            {/* مسیر گردش کار — every hand-off of the case with ✓ (sent on / approved) or ✕ (returned / rejected);
                for a hand-completed case, the statuses typed in «ویرایش» instead */}
            {manual && claim.story ? (
              <section className="cs-table">
                <div className="cs-table-h cs-grid-route">
                  <span className="cs-th-main"><span className="cs-ico sm"><Icon path={ICONS.route} /></span>وضعیت پرونده (ثبت‌شده در ویرایش)</span>
                  <span>وضعیت</span>
                  <span>تاریخ و ساعت ثبت</span>
                </div>
                <div className="cs-table-b">
                  {claim.story.history.length === 0 && <div className="cs-tr"><span className="cs-td-main">هنوز وضعیتی ثبت نشده است.</span></div>}
                  {claim.story.history.map((h, i) => (
                    <div key={i} className="cs-tr cs-grid-route">
                      <span className="cs-td-main">{faN(i + 1)}. {h.title}</span>
                      <span className="cs-td-status"><span className="min-w-0">{h.detail || '—'}</span><Mark state="ok" title={h.detail || ''} /></span>
                      <span className="cs-td-date">{h.at}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
            <section className="cs-table">
              <div className="cs-table-h cs-grid-route">
                <span className="cs-th-main"><span className="cs-ico sm"><Icon path={ICONS.route} /></span>مسیر گردش کار</span>
                <span>اقدام</span>
                <span>تاریخ</span>
              </div>
              <div className="cs-table-b">
                {(claim.steps ?? []).map((s) => {
                  const pending = s.state === 'PENDING';
                  const back = s.action === 'RETURN' || s.action === 'RETURN_DIRECT' || s.state === 'REJECTED' || s.state === 'RETURNED_INCOMPLETE';
                  const text = pending ? 'در انتظار اقدام' : ACTION_FA[s.action || ''] || STATE_FA[s.state] || s.state;
                  return (
                    <div key={s.order} className="cs-tr cs-grid-route">
                      <span className="cs-td-main">{faN(s.order)}. {s.stageLabel || s.holderName || '—'}{s.branchName ? ` — ${s.branchName}` : ''}</span>
                      <span className="cs-td-status">
                        <span className="min-w-0">{text}{s.decidedByName ? <span className="cs-sub"> — {s.decidedByName}</span> : null}{s.note ? <span className="cs-sub"> «{s.note}»</span> : null}</span>
                        <Mark state={pending ? 'wait' : back ? 'no' : 'ok'} title={text} />
                      </span>
                      <span className="cs-td-date">{s.decidedAt || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {claim.deficiencies && claim.deficiencies.length > 0 && (
              <section className="cs-table">
                <div className="cs-table-h"><span className="cs-th-main"><span className="cs-ico sm"><Icon path={ICONS.doc} /></span>سوابق نقص مدارک</span></div>
                <div className="cs-table-b">
                  {claim.deficiencies.map((d, i) => (
                    <div key={i} className="cs-tr cs-def">
                      <Mark state={d.resolvedAt ? 'ok' : 'no'} title={d.resolvedAt ? `رفع شد — ${d.resolvedAt}` : 'باز'} />
                      <ul>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="cs-actions no-print">
            <button type="button" className="cs-act" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت PDF…' : 'دانلود PDF'}</button>
            <Link href={`/org/claims/${id}/workflow`} className="cs-act is-alt"><Icon path={ICONS.list} /> مراحل و وضعیت گردش کار</Link>
          </div>
        </>
      )}
    </Shell>
  );
}
