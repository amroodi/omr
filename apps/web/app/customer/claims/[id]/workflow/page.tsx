'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '../../../../../lib/client';
import { Shell } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { ACTION_FA, STATE_FA, WorkflowPanel, TimelineStep } from '../../../../components/WorkflowPanel';
import { CLAIM_TYPE_LABELS } from '../../../../components/ui';
import { CUSTOMER_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { CaseClaim, CaseHero, PersonCards, phaseText, STATUS_FA, useCase, WorkflowStepsTable } from '../../../../components/case-ui';

const rial = (v?: string | number | null) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('fa-IR')} ریال`);

/** The plain-language result box at the top (amounts and where the case stands). */
function ResultBox({ c }: { c: CaseClaim & { payableAmount?: string; paidDate?: string | null } }) {
  const paid = c.status === 'PAID';
  return (
    <div className="cu-summary">
      <p>{paid ? 'پروندهٔ خسارت شما بررسی و پرداخت شده است؛ خلاصهٔ آن به شرح زیر است:'
        : c.status === 'REJECTED' ? 'پروندهٔ خسارت شما بررسی و رد شده است؛ دلیل آن در مراحل زیر آمده است.'
        : `پروندهٔ خسارت شما در حال رسیدگی است${c.currentStageLabel ? ` و اکنون نزد «${c.currentStageLabel}» است` : ''}.`}</p>
      <dl>
        <dt>مبلغ خسارت برآوردی:</dt><dd>{rial(c.claimedAmount)}</dd>
        <dt>مبلغ خسارت قطعی (تایید شده):</dt><dd>{rial(c.finalizedAmount)}</dd>
        <dt>قابل پرداخت:</dt><dd><b>{rial(c.finalizedAmount ? c.payableAmount : null)}</b></dd>
      </dl>
      {paid && <p>دستور پرداخت مبلغ {rial(c.payableAmount)}{c.paidDate ? ` در تاریخ ${c.paidDate}` : ''} صادر شده است.</p>}
    </div>
  );
}

/** «فرایند رسیدگی پرونده»: a vertical timeline — filing, then every hand-off, then payment. */
function ProcessTimeline({ c }: { c: CaseClaim & { steps?: TimelineStep[]; paidDate?: string | null; createdAt?: string | null } }) {
  const steps = (c.steps ?? []).filter((s) => s.state !== 'PENDING' || s.order === Math.max(...(c.steps ?? []).map((x) => x.order)));
  return (
    <section className="cu-process">
      <h3>فرایند رسیدگی پرونده</h3>
      <ol>
        <li className="is-done">
          <div className="cu-node-t">ثبت پرونده :</div>
          <div className="cu-kv"><b>شماره پرونده :</b><span className="latin-digits">{c.claimNumber}</span></div>
          <div className="cu-kv"><b>نوع خسارت :</b><span>{CLAIM_TYPE_LABELS[c.claimType] ?? c.claimType}</span></div>
          <div className="cu-kv"><b>تاریخ ثبت پرونده :</b><span>{c.createdAt ?? '—'}</span></div>
          <div className="cu-kv"><b>تاریخ وقوع :</b><span>{c.eventDate ?? '—'}</span></div>
          <div className="cu-kv"><b>مبلغ برآوردی :</b><span>{rial(c.claimedAmount)}</span></div>
        </li>
        {steps.map((s) => {
          const pending = s.state === 'PENDING';
          const back = s.action === 'RETURN' || s.action === 'RETURN_DIRECT' || s.state === 'REJECTED' || s.state === 'RETURNED_INCOMPLETE';
          return (
            <li key={s.order} className={pending ? 'is-wait' : back ? 'is-back' : 'is-done'}>
              <div className="cu-node-t">{s.stageLabel || s.holderName || 'مرحله'}{s.branchName ? ` — ${s.branchName}` : ''} :</div>
              <div className="cu-kv"><b>وضعیت :</b><span>{pending ? 'در حال بررسی' : ACTION_FA[s.action || ''] || STATE_FA[s.state] || s.state}</span></div>
              {s.decidedAt && <div className="cu-kv"><b>تاریخ :</b><span>{s.decidedAt}</span></div>}
              {s.note && <div className="cu-kv"><b>توضیحات :</b><span>{s.note}</span></div>}
              {(s.letters ?? []).map((l) => (
                <div key={l.id} className="cu-kv"><b>نامه :</b><span>{l.number ? `شمارهٔ ${l.number}` : ''}{l.date ? ` — ${l.date}` : ''}{l.subject ? ` — ${l.subject}` : ''}</span></div>
              ))}
            </li>
          );
        })}
        {c.status === 'PAID' && (
          <li className="is-done">
            <div className="cu-node-t">پرداخت خسارت :</div>
            <div className="cu-kv"><b>وضعیت :</b><span>دستور پرداخت صادر شد</span></div>
            {c.paidDate && <div className="cu-kv"><b>تاریخ دستور پرداخت :</b><span>{c.paidDate}</span></div>}
            <div className="cu-kv"><b>مبلغ قابل پرداخت :</b><span>{rial(c.payableAmount)}</span></div>
          </li>
        )}
      </ol>
      <p className="cu-process-foot">وضعیت فعلی: {STATUS_FA[c.status] ?? c.status}</p>
    </section>
  );
}

/**
 * بیمه‌گزار — «روند پرونده»: the same steps table as the org «مراحل و وضعیت گردش کار» page (dates and
 * statuses of each executive step), then where the case is in the chain and every hand-off so far.
 */
export default function CustomerCaseWorkflow() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { claim, fv, error, reload } = useCase(id, 'customer');
  useEffect(() => { if (!getToken('customer')) router.push('/customer/login'); }, [router]);

  return (
    <Shell title={claim ? `روند ${caseTitle(claim)}` : 'روند پرونده'} breadcrumb="روند پرونده" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />
      {!claim ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال بارگذاری روند پرونده" /></div> : (
        <div className="space-y-5">
          <div className="cs-sheet">
            <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={fv.case_notes || phaseText(claim)} back={`/customer/claims/${id}`} exitHref="/customer" />
            <PersonCards claim={claim} fv={fv} />
            <WorkflowStepsTable claim={claim} fv={fv} />
          </div>
          <div className="pcard p-6 space-y-5">
            <ResultBox c={claim as any} />
            <ProcessTimeline c={claim as any} />
            {/* sending the documents on is «ثبت نهایی» on the case page (it shows the outcome page) */}
            {claim.workflow && (claim.workflow.actions.some((a) => a.key !== 'SUBMIT') || (claim.workflow.physical?.actions.length ?? 0) > 0) && (
              <WorkflowPanel claimId={id} workflow={{ ...claim.workflow, actions: claim.workflow.actions.filter((a) => a.key !== 'SUBMIT') }} realm="customer" onDone={reload} />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
