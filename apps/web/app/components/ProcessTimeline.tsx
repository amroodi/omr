'use client';
import { CLAIM_TYPE_LABELS } from './ui';
import { ACTION_FA, STATE_FA, TimelineStep } from './WorkflowPanel';
import { CaseClaim, DEATH_TYPES, STATUS_FA, StatusHistoryButton } from './case-ui';

/**
 * «فرایند رسیدگی پرونده» — shared by the بیمه‌گزار panel («روند پرونده») and the inquiry panel
 * (مشاهده سریع و استعلام پرونده), so both tell the case's story the same way.
 */

const rial = (v?: string | number | null) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('fa-IR')} ریال`);

/** The plain-language result box at the top (amounts and where the case stands). */
export function ResultBox({ c }: { c: CaseClaim & { payableAmount?: string; paidDate?: string | null } }) {
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
export function ProcessTimeline({ c, fv }: { c: CaseClaim & { steps?: TimelineStep[]; paidDate?: string | null; createdAt?: string | null }; fv: Record<string, string> }) {
  // A hand-completed case («ویرایش») tells only what was typed; otherwise the hierarchy's hand-offs.
  const manual = !!c.story?.manual;
  const steps = manual ? [] : (c.steps ?? []).filter((s) => s.state !== 'PENDING' || s.order === Math.max(...(c.steps ?? []).map((x) => x.order)));
  return (
    <section className="cu-process">
      <h3>فرایند رسیدگی پرونده</h3>
      <ol>
        <li className="is-done">
          <div className="cu-node-t">ثبت پرونده :</div>
          <div className="cu-kv"><b>شماره پرونده :</b><span className="latin-digits">{c.claimNumber}</span></div>
          <div className="cu-kv"><b>نوع خسارت :</b><span>{CLAIM_TYPE_LABELS[c.claimType] ?? c.claimType}</span></div>
          {!(c.imported && (c.status === 'PAID' || c.status === 'REJECTED')) && <div className="cu-kv"><b>تاریخ ثبت پرونده :</b><span>{c.createdAt ?? '—'}</span></div>}
          <div className="cu-kv"><b>{DEATH_TYPES.has(c.claimType) ? 'تاریخ فوت' : 'تاریخ وقوع'} :</b><span>{c.eventDate ?? '—'}</span></div>
          {DEATH_TYPES.has(c.claimType) && <div className="cu-kv"><b>علت فوت :</b><span>{fv.cause_of_death || fv.death_kind || '—'}</span></div>}
          <div className="cu-kv"><b>مبلغ برآوردی :</b><span>{rial(c.claimedAmount)}</span></div>
          <div className="cu-kv cu-kv-btns"><StatusHistoryButton story={c.story} /></div>
        </li>
        {manual && (c.story?.history ?? []).map((h, i) => (
          <li key={`m${i}`} className="is-done">
            <div className="cu-node-t">{h.title} :</div>
            <div className="cu-kv"><b>وضعیت :</b><span>{h.detail || '—'}</span></div>
            <div className="cu-kv"><b>تاریخ و ساعت ثبت :</b><span>{h.at}</span></div>
          </li>
        ))}
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
        {c.status === 'PAID' && !manual && (
          <li className="is-done">
            <div className="cu-node-t">پرداخت خسارت :</div>
            <div className="cu-kv"><b>وضعیت :</b><span>دستور پرداخت صادر شد</span></div>
            {c.paidDate && <div className="cu-kv"><b>تاریخ دستور پرداخت :</b><span>{c.paidDate}</span></div>}
            <div className="cu-kv"><b>مبلغ قابل پرداخت :</b><span>{rial(c.payableAmount)}</span></div>
          </li>
        )}
      </ol>
      <p className="cu-process-foot">وضعیت فعلی: {manual ? (c.story?.caseStage || STATUS_FA[c.status] || c.status) : (STATUS_FA[c.status] ?? c.status)}</p>
    </section>
  );
}
