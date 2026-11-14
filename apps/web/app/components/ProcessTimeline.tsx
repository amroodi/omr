'use client';
import { claimTypeLabel } from './ui';
import { ACTION_FA, LossNoticeEntry, STATE_FA, TimelineStep, withLossNotice } from './WorkflowPanel';
import { blankVal, CaseClaim, CaseNo, DEATH_TYPES, fmtAmount, STATUS_FA, StatusHistoryButton, WF_STEPS } from './case-ui';

const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/**
 * «فرایند رسیدگی پرونده» — shared by the بیمه‌گزار panel («روند پرونده») and the inquiry panel
 * (مشاهده سریع و استعلام پرونده), so both tell the case's story the same way.
 */

const rial = (v?: string | number | null) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('fa-IR')} ریال`);
/** مبلغ برآوردی is optional at filing: ۰ means it was not entered. */
const est = (v?: string | number | null) => (Number(v) > 0 ? rial(v) : 'ثبت نشده');

/** The plain-language result box at the top (amounts and where the case stands). */
export function ResultBox({ c }: { c: CaseClaim & { payableAmount?: string; paidDate?: string | null; payableKnown?: boolean } }) {
  const paid = c.status === 'PAID';
  return (
    <div className="cu-summary">
      <p>{paid ? 'پروندهٔ خسارت شما بررسی و پرداخت شده است؛ خلاصهٔ آن به شرح زیر است:'
        : c.status === 'REJECTED' ? 'پروندهٔ خسارت شما بررسی و رد شده است؛ دلیل آن در مراحل زیر آمده است.'
        : `پروندهٔ خسارت شما در حال رسیدگی است${c.currentStageLabel ? ` و اکنون نزد «${c.currentStageLabel}» است` : ''}.`}</p>
      <dl>
        <dt>مبلغ خسارت برآوردی:</dt><dd>{est(c.claimedAmount)}</dd>
        <dt>مبلغ خسارت قطعی (تایید شده):</dt><dd>{rial(c.finalizedAmount)}</dd>
        <dt>قابل پرداخت:</dt><dd><b>{rial(c.finalizedAmount || c.payableKnown ? c.payableAmount : null)}</b></dd>
      </dl>
      {paid && <p>دستور پرداخت مبلغ {rial(c.payableAmount)}{c.paidDate && !blankVal(c.paidDate) ? ` در تاریخ ${c.paidDate}` : ''} صادر شده است.</p>}
    </div>
  );
}

/** «فرایند رسیدگی پرونده»: a vertical timeline — filing, then every hand-off, then payment. */
export function ProcessTimeline({ c, fv, splitNumber = false }: { c: CaseClaim & { steps?: TimelineStep[]; lossNotice?: LossNoticeEntry | null; paidDate?: string | null; createdAt?: string | null }; fv: Record<string, string>; splitNumber?: boolean }) {
  // A hand-completed case («ویرایش») tells only what was typed; otherwise the hierarchy's hand-offs.
  const manual = !!c.story?.manual;
  // A case brought in from Excel (or completed by hand without a history): the stages typed for it.
  const typed = manual && !(c.story?.history ?? []).length ? WF_STEPS.filter((s) => (s.date && !blankVal(fv[s.date])) || (s.status && !blankVal(fv[s.status]))) : [];
  const steps = manual ? [] : withLossNotice((c.steps ?? []).filter((s) => s.state !== 'PENDING' || s.order === Math.max(...(c.steps ?? []).map((x) => x.order))), c.lossNotice);
  return (
    <section className="cu-process">
      <h3>فرایند رسیدگی پرونده</h3>
      <ol>
        <li className="is-done">
          <div className="cu-node-t">ثبت پرونده :</div>
          <div className="cu-kv"><b>شماره پرونده :</b>{splitNumber ? <span><CaseNo n={c.claimNumber} /></span> : <span className="latin-digits">{c.claimNumber}</span>}</div>
          <div className="cu-kv"><b>نوع خسارت :</b><span>{claimTypeLabel(c)}</span></div>
          {!(c.imported && (c.status === 'PAID' || c.status === 'REJECTED')) && <div className="cu-kv"><b>تاریخ ثبت پرونده :</b><span>{c.createdAt ?? '—'}</span></div>}
          <div className="cu-kv"><b>{(c.claimTypeDeath ?? DEATH_TYPES.has(c.claimType)) ? 'تاریخ فوت' : 'تاریخ وقوع'} :</b><span>{c.eventDate ?? '—'}</span></div>
          <div className="cu-kv"><b>علت خسارت :</b><span>{fv.cause_of_death || (c as { causeOfDeath?: string | null }).causeOfDeath || fv.death_kind || '—'}</span></div>
          <div className="cu-kv"><b>مبلغ برآوردی :</b><span>{est(c.claimedAmount)}</span></div>
          <div className="cu-kv cu-kv-btns"><StatusHistoryButton story={c.story} /></div>
        </li>
        {manual && (c.story?.history ?? []).map((h, i) => (
          <li key={`m${i}`} className="is-done">
            <div className="cu-node-t">{h.title} :</div>
            <div className="cu-kv"><b>وضعیت :</b><span>{h.detail || '—'}</span></div>
            <div className="cu-kv"><b>تاریخ و ساعت ثبت :</b><span>{h.at}</span></div>
          </li>
        ))}
        {typed.map((s) => (
          <li key={s.label} className="is-done">
            <div className="cu-node-t">{s.label} :</div>
            {s.status && !blankVal(fv[s.status]) && <div className="cu-kv"><b>وضعیت :</b><span>{s.amount ? fmtAmount(fv[s.status]) ?? fv[s.status] : fv[s.status]}</span></div>}
            {s.date && !blankVal(fv[s.date]) && <div className="cu-kv"><b>تاریخ :</b><span>{faD(fv[s.date])}</span></div>}
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
            {c.paidDate && !blankVal(c.paidDate) && <div className="cu-kv"><b>تاریخ دستور پرداخت :</b><span>{c.paidDate}</span></div>}
            <div className="cu-kv"><b>مبلغ قابل پرداخت :</b><span>{rial(c.payableAmount)}</span></div>
          </li>
        )}
      </ol>
      <p className="cu-process-foot">وضعیت فعلی: {manual ? (c.story?.caseStage || STATUS_FA[c.status] || c.status) : (STATUS_FA[c.status] ?? c.status)}</p>
    </section>
  );
}

/** The rows of «گزارش وضعیت پرونده خسارت» (PDF): the same steps as the timeline above, one per row. */
export function processRows(c: CaseClaim & { steps?: TimelineStep[]; lossNotice?: LossNoticeEntry | null; paidDate?: string | null; createdAt?: string | null; payableAmount?: string }, fv: Record<string, string>) {
  const rows: { stage: string; status: string; date: string; note: string }[] = [];
  const manual = !!c.story?.manual;
  if (!(c.imported && (c.status === 'PAID' || c.status === 'REJECTED'))) rows.push({ stage: 'ثبت پرونده', status: 'ثبت شد', date: c.createdAt ?? '', note: claimTypeLabel(c) });
  if (manual) for (const h of c.story?.history ?? []) rows.push({ stage: h.title, status: h.detail || '', date: h.at, note: '' });
  if (manual && !(c.story?.history ?? []).length) {
    for (const s of WF_STEPS) {
      const st = s.status && !blankVal(fv[s.status]) ? (s.amount ? fmtAmount(fv[s.status]) ?? fv[s.status] : fv[s.status]) : '';
      const dt = s.date && !blankVal(fv[s.date]) ? faD(fv[s.date]) : '';
      if (st || dt) rows.push({ stage: s.label, status: st, date: dt, note: '' });
    }
  }
  if (!manual) {
    const steps = withLossNotice((c.steps ?? []).filter((s) => s.state !== 'PENDING' || s.order === Math.max(...(c.steps ?? []).map((x) => x.order))), c.lossNotice);
    for (const s of steps) {
      const pending = s.state === 'PENDING';
      rows.push({
        stage: `${s.stageLabel || s.holderName || 'مرحله'}${s.branchName ? ` — ${s.branchName}` : ''}`,
        status: pending ? 'در حال بررسی' : ACTION_FA[s.action || ''] || STATE_FA[s.state] || s.state,
        date: s.decidedAt ?? '',
        note: [s.note, ...(s.letters ?? []).map((l) => `نامه ${l.number ?? ''}${l.date ? ` (${l.date})` : ''}`)].filter(Boolean).join(' — '),
      });
    }
    if (c.status === 'PAID') rows.push({ stage: 'پرداخت خسارت', status: 'دستور پرداخت صادر شد', date: c.paidDate && !blankVal(c.paidDate) ? c.paidDate : '', note: c.payableAmount ? rial(c.payableAmount) : '' });
  }
  return rows;
}

/**
 * The body of «گزارش وضعیت پرونده خسارت» as the designer drew it: company and name on the right, the dates on the
 * left, the stages table, then «توضیحات پرونده». Laid on the letterhead by downloadBrandedPdf.
 */
export function StatusReportBody({ c, fv, notes }: { c: any; fv: Record<string, string>; notes: string }) {
  const isDeath = c.claimTypeDeath ?? DEATH_TYPES.has(c.claimType);
  const rows = processRows(c, fv);
  return (
    <div className="pdf-r">
      <div className="pdf-r-info">
        <div><b>شرکت:</b> {c.policyholderCompany?.name || fv.company_name || '—'}</div>
        <div><b>تاریخ ثبت اولیه:</b> {c.createdAt?.split(' ')[0] || '—'}</div>
        <div><b>{isDeath ? 'نام متوفی' : 'نام بیمه‌شده'}:</b> {c.deceasedName ? `${isDeath ? 'مرحوم ' : ''}${c.deceasedName}` : '—'}</div>
        <div><b>تاریخ پرداخت:</b> {c.paidDate && !blankVal(c.paidDate) ? c.paidDate : '—'}</div>
      </div>
      <table className="pdf-r-table">
        <thead><tr><th>مرحله</th><th>وضعیت</th><th>تاریخ</th><th>توضیحات</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}><td>{r.stage}</td><td>{r.status}</td><td>{r.date.split(' ')[0]}</td><td>{r.note}</td></tr>)}
          {Array.from({ length: Math.max(0, 6 - rows.length) }, (_, i) => <tr key={`e${i}`}><td /><td /><td /><td /></tr>)}
        </tbody>
      </table>
      <div className="pdf-r-notes">
        <div className="pdf-r-notes-h"><b>توضیحات پرونده:</b></div>
        <p>{notes}</p>
      </div>
    </div>
  );
}
