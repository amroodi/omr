'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell, Icon } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { ORG_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { downloadPdf } from '../../../../../lib/pdf';
import { CaseHero, ICONS, NotesPill, PersonCards, phaseText, useCase } from '../case-ui';

/** Each executive step of the case: its date field and its status field (WORKFLOW_STAGE fields). */
const STEPS: { label: string; date?: string; status?: string; extra?: string }[] = [
  { label: 'اعلام کارگزاری به بیمه‌گر', date: 'broker_to_insurer_date', status: 'broker_to_insurer_status' },
  { label: 'اعلام فوت', date: 'death_notice_date', status: 'death_notice_status' },
  { label: 'مراحل اجرایی', status: 'execution_stages' },
  { label: 'درخواست مدارک', date: 'docs_request_date', status: 'docs_request_status' },
  { label: 'دریافت مدارک', date: 'docs_receive_date', status: 'docs_receive_status' },
  { label: 'درخواست کسری مدارک', date: 'missing_docs_request_date', status: 'missing_docs_request_status' },
  { label: 'تکمیل پرونده', date: 'case_complete_date', status: 'case_complete_status', extra: 'case_complete' },
  { label: 'ارسال به ستاد', date: 'send_to_hq_date', status: 'send_to_hq_status' },
  { label: 'تایید شورای فنی و سایر', date: 'council_approve_date', status: 'council_approve_status' },
  { label: 'برگشت به شعبه', date: 'return_to_branch_date', status: 'return_to_branch_status' },
  { label: 'حواله پرداخت', date: 'payment_order_date', status: 'payment_order_status', extra: 'payment_order' },
];
const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** «مراحل و وضعیت گردش کار» (Group 874): every executive step with its date and status, as a table. */
export default function CaseWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { claim, fv, error, setError } = useCase(id);
  const sheet = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const pdf = async () => {
    if (!sheet.current || !claim) return;
    setSaving(true);
    try { await downloadPdf(sheet.current, `workflow-${claim.policyNumber || claim.claimNumber}`); }
    catch (e: any) { setError(e?.message || 'ساخت فایل PDF ممکن نشد'); } finally { setSaving(false); }
  };

  return (
    <Shell title={claim ? `گردش کار — ${caseTitle(claim)}` : 'مراحل و وضعیت گردش کار'} breadcrumb="مراحل و وضعیت گردش کار" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده" /></div> : (
        <>
          <div ref={sheet} className="cs-sheet">
            <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={fv.case_notes || phaseText(claim)} back={`/org/claims/${id}`} />
            <PersonCards claim={claim} fv={fv} />
            <section className="cs-table">
              <div className="cs-table-h cs-grid-wf">
                <span className="cs-th-main"><span className="cs-ico sm"><Icon path={ICONS.list} /></span>مراحل اجرایی</span>
                <span>تاریخ</span>
                <span>وضعیت</span>
              </div>
              <div className="cs-table-b">
                {STEPS.map((s) => {
                  const date = s.date ? fv[s.date] : '';
                  const status = [s.extra && s.extra !== 'payment_order' ? fv[s.extra] : '', s.status ? fv[s.status] : '', s.extra === 'payment_order' && fv.payment_order ? `حواله: ${fv.payment_order}` : '']
                    .filter(Boolean).join(' — ');
                  const done = !!(date || status);
                  return (
                    <div key={s.label} className="cs-tr cs-grid-wf">
                      <span className="cs-td-main">{s.label}:</span>
                      <span className="cs-td-date">{date ? faD(date) : '—'}</span>
                      <span className="cs-td-status">
                        <span className="min-w-0">{status || '—'}</span>
                        <span className={`cs-mark ${done ? 'is-ok' : 'is-wait'}`} title={done ? 'ثبت شده' : 'هنوز ثبت نشده'}>
                          <Icon path={done ? 'M20 6L9 17l-5-5' : 'M7 12h10'} />
                        </span>
                      </span>
                    </div>
                  );
                })}
                <div className="cs-tr cs-foot"><span className="cs-foot-l">توضیحات پرونده:</span><NotesPill text={fv.case_notes || phaseText(claim)} /></div>
              </div>
            </section>
          </div>
          <div className="cs-actions no-print">
            <button type="button" className="cs-act" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت PDF…' : 'دانلود PDF'}</button>
            <Link href={`/org/claims/${id}/documents`} className="cs-act is-alt"><Icon path={ICONS.doc} /> بررسی وضعیت مدارک</Link>
          </div>
        </>
      )}
    </Shell>
  );
}
