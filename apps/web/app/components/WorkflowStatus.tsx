'use client';
import { useEffect, useRef, useState } from 'react';
import { client } from '../../lib/client';
import { downloadBrandedPdf } from '../../lib/pdf';
import { Icon } from './Shell';
import { CaseClaim, ICONS, phaseText, STATUS_FA } from './case-ui';
import { ProcessTimeline, ResultBox, StatusReportBody } from './ProcessTimeline';
import { DeathNoticeDate } from './DeathNoticeDate';

/**
 * «مراحل و وضعیت گردش کار»: where the case stands, the timeline, and — in panel 2 — every act of this
 * organization's operators on it (who, when) with its «آخرین اقدام کننده». «دانلود PDF» saves the report.
 */
export function WorkflowStatus({ claim, fv, onError, acts = false, notice = true }: { claim: CaseClaim & Record<string, any>; fv: Record<string, string>; onError: (m: string) => void; acts?: boolean; notice?: boolean }) {
  const report = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const pdf = async () => {
    if (!report.current) return;
    setSaving(true);
    const finalStatus = claim.story?.manual ? (claim.story.caseStage || STATUS_FA[claim.status] || claim.status) : (STATUS_FA[claim.status] ?? claim.status);
    try { await downloadBrandedPdf(report.current, `workflow-${claim.policyNumber || claim.claimNumber}`, { title: 'گزارش وضعیت پرونده خسارت', meta: [{ label: 'وضعیت نهایی', value: finalStatus }] }); }
    catch (e: any) { onError(e?.message || 'ساخت فایل PDF ممکن نشد'); } finally { setSaving(false); }
  };
  return (
    <>
      <div className="pcard p-6 space-y-5 mt-4">
        {notice && <DeathNoticeDate claimId={claim.id} />}
        <ResultBox c={claim as any} />
        <ProcessTimeline c={claim as any} fv={fv} />
        {acts && <DeskActs claimId={claim.id} />}
      </div>
      <div className="pdf-offscreen" aria-hidden="true"><div ref={report}><StatusReportBody c={claim} fv={fv} notes={fv.case_notes || phaseText(claim)} /></div></div>
      <div className="cs-actions no-print">
        <button type="button" className="cs-act" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت PDF…' : 'دانلود PDF'}</button>
      </div>
    </>
  );
}

interface Acts { lastActor: { name: string; at: string } | null; acts: { label: string; note: string | null; by: string; at: string }[] }

/** Every act of this organization's operators on the case (names, dates and times). */
export function DeskActs({ claimId }: { claimId: string }) {
  const [d, setD] = useState<Acts | null>(null);
  useEffect(() => { client.get<Acts>(`/claims/${claimId}/desk-acts`, 'org').then(setD).catch(() => setD(null)); }, [claimId]);
  if (!d || (!d.acts.length && !d.lastActor)) return null;
  return (
    <div className="wf-acts">
      <div className="wf-acts-h">
        <b>اقدامات کارشناسان</b>
        {d.lastActor && <span>آخرین اقدام کننده: <b>{d.lastActor.name}</b> — {d.lastActor.at}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="table sn-table">
          <thead><tr><th>زمان</th><th>اقدام</th><th>شرح</th><th>کارشناس</th></tr></thead>
          <tbody>
            {d.acts.map((a, i) => <tr key={i}><td className="ltr-num whitespace-nowrap">{a.at}</td><td>{a.label}</td><td className="text-right">{a.note || '—'}</td><td>{a.by}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
