'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, Realm } from '../../lib/client';
import { Icon } from './Shell';
import { CLAIM_TYPE_LABELS, Overlay } from './ui';
import type { Workflow, TimelineStep } from './WorkflowPanel';

/**
 * Pieces shared by the case page (پیش‌نمایش) and its two sub-pages («مراحل و وضعیت گردش کار» and
 * «بررسی وضعیت مدارک»), laid out after the designer's Group 873/874/875 frames: a navy header card
 * with the dates and the case-notes pill, then grey-bodied cards with white label/value rows.
 */

export interface DocReview { stage: string; state: string; canEdit: boolean; changedAt?: string | null; changedBy?: string | null; changes?: number; note?: string | null }
export interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; uploadedAt: string | null; version: number; isLatest: boolean; reviews?: DocReview[] }
export interface ChecklistItem { code: string; label: string; uploaded: boolean; latestStatus: string | null; documents: ClaimDoc[] }
export interface Checklist { claimType: string; complete: boolean; items: ChecklistItem[]; otherDocuments?: ClaimDoc[] }
export interface FieldRow { key: string; label: string; type: string; options: string[]; required: boolean; value: string | null; source: string | null; confirmed: boolean; canEdit: boolean }
export interface FieldsData { party: string; manual?: boolean; groups: Record<string, FieldRow[]> }
export interface CaseClaim {
  id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; insurerTenantId?: string;
  deceasedName: string | null; deceasedNationalCode?: string | null; deceasedBirthDate?: string | null; deceasedAge?: number | null;
  eventDate: string | null; createdAt?: string | null; paidDate?: string | null; noticeDeadline: string | null; lateNotice: boolean;
  claimedAmount: string; estimatedAmount?: string; finalizedAmount?: string | null; payableAmount?: string;
  currentStageLabel?: string | null; flowDirection?: string | null; flowPurpose?: string | null;
  policyholderCompany?: { name: string; phone: string | null } | null;
  policyHolder?: { name: string | null; nationalCode: string | null } | null;
  insurer?: { name: string } | null; broker?: { name: string } | null; handlingBranchName?: string | null;
  description?: string | null;
  steps?: TimelineStep[];
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
  workflow?: Workflow;
  /** Brought in from Excel («ورود دسته‌ای»): its filing date is only the import date, so it isn't shown. */
  imported?: boolean;
  /**
   * Which story the workflow views tell: hand-completed from «ویرایش» (`manual`: the typed «وضعیت پرونده»
   * and the typed values' history) or the hierarchy (its hand-offs). «ویرایش» always has priority.
   */
  story?: CaseStory;
}
export interface CaseStory { manual: boolean; caseStage: string | null; history: { at: string; title: string; detail: string | null }[] }

export const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);
export const STATUS_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس', SUBMITTED: 'ثبت‌شده', UNDER_REVIEW: 'در حال بررسی', RETURNED_INCOMPLETE: 'نقص مدارک', APPROVED: 'تایید نهایی', REJECTED: 'رد شده', PAID: 'پرداخت شده',
};
const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
export const fmtAmount = (v: string | number | null | undefined) => {
  const raw = String(v ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^\d]/g, '');
  return raw ? `${Number(raw).toLocaleString('fa-IR')} ریال` : null;
};
export const dateOnly = (s?: string | null) => (s ? s.split(' ')[0] : null);

/** Loads the claim, its field values and its document checklist together. */
export function useCase(id: string, realm: Realm = 'org') {
  const [claim, setClaim] = useState<CaseClaim | null>(null);
  const [fields, setFields] = useState<FieldsData | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const base = realm === 'customer' ? '/customer/claims' : '/claims';
      const [c, f, cl] = await Promise.all([
        client.get<CaseClaim>(`${base}/${id}`, realm),
        client.get<FieldsData>(`${base}/${id}/fields`, realm).catch(() => null),
        client.get<Checklist>(`${base}/${id}/checklist`, realm),
      ]);
      setClaim(c); setFields(f); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  const fv: Record<string, string> = {};
  Object.values(fields?.groups ?? {}).flat().forEach((r) => { if (r.value) fv[r.key] = r.value; });
  return { claim, fields, fv, checklist, error, setError, reload: load };
}

/** Plain-language position of the case, used when no «توضیحات پرونده» was written. */
export function phaseText(c: CaseClaim): string {
  if (c.story?.manual && c.story.caseStage) return c.story.caseStage; // typed in «ویرایش»
  if (c.status === 'PAID') return 'پرداخت شده';
  if (c.status === 'REJECTED') return 'غیر قابل پرداخت';
  if (c.flowPurpose === 'PAYMENT') return 'در مسیر پرداخت';
  if (c.flowDirection === 'DOWN') return 'نقص مدارک — در انتظار رفع نقص';
  if (c.status === 'SUBMITTED') return 'منتظر تکمیل و ارسال مدارک';
  return 'در حال بررسی';
}

/** Automatic colouring of «توضیحات پرونده»: paid green, under review yellow, not payable red, else grey. */
export function notesTone(text: string): 'ok' | 'wait' | 'bad' | 'other' {
  if (/غیر\s*قابل\s*پرداخت|رد\s*شد|رد شده/.test(text)) return 'bad';
  if (/پرداخت\s*شد|پرداخت شده|تکمیل شده/.test(text)) return 'ok';
  if (/بررسی|در دست|انتظار|منتظر|جریان/.test(text)) return 'wait';
  return 'other';
}

export function NotesPill({ text }: { text: string }) {
  const tone = notesTone(text);
  return (
    <span className={`cs-pill tone-${tone}`}>
      {tone === 'ok' ? <Icon path="M20 6L9 17l-5-5" /> : <span className="cs-pill-dot" />}
      {text}
    </span>
  );
}

const CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z';
export const ICONS = {
  policy: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 15l2 2 4-4',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  doc: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a4 4 0 014-4h4M18 9v6a4 4 0 01-4 4h-4',
  pdf: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  exit: 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9',
  back: 'M9 18l6-6-6-6',
};

/**
 * Navy header card: title + subtitle, white chips (by default the two dates), the notes pill and the
 * back/exit buttons. `exitHref` is where «خروج» goes (the org Work Desk, or the بیمه‌گزار home).
 */
export function CaseHero({ title, claim, notes, notesLabel = 'توضیحات پرونده:', back, sub, chips, badge, exitHref = '/org/work-desk' }: {
  title: string; claim: CaseClaim; notes: string; notesLabel?: string; back?: string; sub?: string;
  chips?: { label: string; value: ReactNode; icon?: string }[]; badge?: ReactNode; exitHref?: string;
}) {
  const router = useRouter();
  const list = chips ?? [
    // A completed imported (historical) case's filing date is only the day it was brought in — not shown.
    ...(claim.imported && (claim.status === 'PAID' || claim.status === 'REJECTED') ? [] : [{ label: 'تاریخ ثبت اولیه', value: dateOnly(claim.createdAt) || '—', icon: CAL }]),
    { label: 'تاریخ پرداخت', value: claim.paidDate || '—', icon: CAL },
  ];
  return (
    <div className="cs-hero">
      <div className="cs-hero-main">
        <div className="cs-hero-title"><span className="cs-ico"><Icon path={ICONS.policy} /></span>{title}{badge}</div>
        <div className="cs-hero-sub">{sub ?? (claim.policyholderCompany?.name || claim.insurer?.name || '—')}</div>
        {list.length > 0 && (
          <div className="cs-dates">
            {list.map((c) => <span key={c.label} className="cs-date"><span className="cap">{c.label}</span><Icon path={c.icon || CAL} /><b>{c.value}</b></span>)}
          </div>
        )}
      </div>
      <div className="cs-hero-side">
        <div className="cs-notes"><span className="cap">{notesLabel}</span><NotesPill text={notes} /></div>
        <div className="cs-hero-btns no-pdf">
          {back && <Link href={back} className="cs-btn-back"><Icon path={ICONS.back} /> بازگشت</Link>}
          <button type="button" className="cs-btn-exit" onClick={() => router.push(exitHref)}><Icon path={ICONS.exit} /> خروج</button>
        </div>
      </div>
    </div>
  );
}

export const ICON_CAL = CAL;


/** Grey-bodied card with a navy head (icon, title, optional note) that folds open/closed. */
export function InfoCard({ title, icon, aside, children, wide }: { title: string; icon: string; aside?: string; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`cs-card${wide ? ' is-wide' : ''}`}>
      <button type="button" className="cs-card-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="cs-card-t"><span className="cs-ico sm"><Icon path={icon} /></span>{title}</span>
        <span className="cs-card-a">{aside}<span className={`cs-chev${open ? ' is-open' : ''}`}><Icon path="M6 9l6 6 6-6" /></span></span>
      </button>
      {open && <div className="cs-card-b">{children}</div>}
    </section>
  );
}

export function InfoRow({ label, value, tone }: { label: string; value: ReactNode; tone?: 'amount' }) {
  return (
    <div className="cs-row">
      <div className="cs-row-l">{label}</div>
      <div className={`cs-row-v${tone === 'amount' ? ' is-amount' : ''}`}>{value || '—'}</div>
    </div>
  );
}

/** Group 873: the three info cards of the case. */
export function CaseSummary({ claim, fv }: { claim: CaseClaim; fv: Record<string, string> }) {
  const isDeath = DEATH_TYPES.has(claim.claimType);
  const name = claim.deceasedName || fv.full_name;
  const statusText = claim.story?.manual
    ? (claim.story.caseStage || STATUS_FA[claim.status] || claim.status) // typed in «ویرایش»
    : `${STATUS_FA[claim.status] ?? claim.status}${claim.currentStageLabel ? ` — ${claim.currentStageLabel}` : ''}`;
  const d = (k: string) => (fv[k] ? faD(fv[k]) : null);
  return (
    <div className="cs-cols">
      <InfoCard title="اطلاعات بیمه‌شده" icon={ICONS.user}>
        <InfoRow label="نام و نام خانوادگی" value={name ? (isDeath && !name.startsWith('مرحوم') ? `مرحوم ${name}` : name) : null} />
        <InfoRow label="کد ملی" value={(claim.deceasedNationalCode || fv.national_code) ? <bdi className="ltr-val">{faD(claim.deceasedNationalCode || fv.national_code)}</bdi> : null} />
        <InfoRow label="تاریخ تولد" value={claim.deceasedBirthDate || d('birth_date')} />
        <InfoRow label="نام شرکت / محل فعالیت" value={claim.policyholderCompany?.name || fv.company_name} />
      </InfoCard>
      <InfoCard title="اطلاعات بیمه‌نامه" icon={ICONS.policy}>
        <InfoRow label="شماره بیمه‌نامه" value={(claim.policyNumber || fv.policy_number) ? <bdi className="ltr-val">{faD(claim.policyNumber || fv.policy_number)}</bdi> : null} />
        <InfoRow label="تاریخ شروع بیمه‌نامه" value={d('policy_start_date')} />
        <InfoRow label="سرمایه فوت" value={fmtAmount(fv.death_capital)} tone="amount" />
        <InfoRow label="سرمایه حادثه" value={fmtAmount(fv.accident_capital)} />
        <InfoRow label="مبلغ قابل پرداخت" value={fmtAmount(fv.payable_amount || claim.payableAmount)} tone="amount" />
      </InfoCard>
      <InfoCard title={isDeath ? 'اطلاعات فوت' : 'اطلاعات حادثه'} icon={ICONS.doc} aside={CLAIM_TYPE_LABELS[claim.claimType] || 'پرونده خسارت'}>
        {isDeath && <InfoRow label="علت فوت" value={fv.cause_of_death || fv.death_kind} />}
        <InfoRow label={isDeath ? 'تاریخ فوت' : 'تاریخ حادثه'} value={claim.eventDate || d('death_date')} />
        <InfoRow label={isDeath ? 'سن متوفی' : 'سن بیمه‌شده'} value={claim.deceasedAge != null ? `${claim.deceasedAge.toLocaleString('fa-IR')} سال` : null} />
        <InfoRow label="وضعیت پرونده" value={statusText} />
      </InfoCard>
    </div>
  );
}

/** Group 874/875: the deceased's name and the company, as two white cards under the header. */
export function PersonCards({ claim, fv }: { claim: CaseClaim; fv: Record<string, string> }) {
  const isDeath = DEATH_TYPES.has(claim.claimType);
  const name = claim.deceasedName || fv.full_name || '—';
  return (
    <div className="cs-people">
      <div className="cs-person"><span className="cs-person-ico"><Icon path={ICONS.user} /></span><div><div className="cap">نام و نام خانوادگی</div><b>{isDeath && !name.startsWith('مرحوم') && name !== '—' ? `مرحوم ${name}` : name}</b></div></div>
      <div className="cs-person"><span className="cs-person-ico"><Icon path={ICONS.doc} /></span><div><div className="cap">نام شرکت / محل فعالیت</div><b>{claim.policyholderCompany?.name || fv.company_name || '—'}</b></div></div>
    </div>
  );
}

/** Each executive step of the case: its date field and its status field (WORKFLOW_STAGE fields). */
const WF_STEPS: { label: string; date?: string; status?: string; amount?: boolean }[] = [
  // In the order things happen: the death is reported first, then the brokerage reports it to the insurer.
  { label: 'اعلام فوت', date: 'death_notice_date', status: 'death_notice_status' },
  { label: 'اعلام کارگزاری به بیمه‌گر', date: 'broker_to_insurer_date', status: 'broker_to_insurer_status' },
  { label: 'مراحل اجرایی', status: 'execution_stages' },
  { label: 'درخواست مدارک', date: 'docs_request_date', status: 'docs_request_status' },
  { label: 'دریافت مدارک', date: 'docs_receive_date', status: 'docs_receive_status' },
  { label: 'درخواست کسری مدارک', date: 'missing_docs_request_date', status: 'missing_docs_request_status' },
  { label: 'تکمیل پرونده', date: 'case_complete_date', status: 'case_complete' },
  { label: 'وضعیت تکمیل پرونده', status: 'case_complete_status' },
  { label: 'ارسال به ستاد', date: 'send_to_hq_date', status: 'send_to_hq_status' },
  { label: 'تایید شورای فنی و سایر', date: 'council_approve_date', status: 'council_approve_status' },
  { label: 'برگشت به شعبه', date: 'return_to_branch_date', status: 'return_to_branch_status' },
  { label: 'حواله پرداخت', date: 'payment_order_date', status: 'payment_order_status' },
  { label: 'مبلغ حواله پرداخت', status: 'payment_order', amount: true },
  { label: 'وضعیت پرونده', status: 'case_stage' },
];
/** Group 874's table: every executive step with its date and status, then «توضیحات پرونده». */
export function WorkflowStepsTable({ claim, fv }: { claim: CaseClaim; fv: Record<string, string> }) {
  return (
    <section className="cs-table">
              <div className="cs-table-h cs-grid-wf">
                <span className="cs-th-main"><span className="cs-ico sm"><Icon path={ICONS.list} /></span>مراحل اجرایی</span>
                <span>تاریخ</span>
                <span>وضعیت</span>
              </div>
              <div className="cs-table-b">
                {WF_STEPS.map((s) => {
                  const date = s.date ? fv[s.date] : '';
                  const raw = s.status ? fv[s.status] : '';
                  const status = raw && s.amount ? (fmtAmount(raw) ?? raw) : raw;
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
  );
}


/**
 * «تاریخچه وضعیت پرونده»: a button that opens the case's status history with Tehran date and time —
 * the values typed in «ویرایش» for a hand-completed case, otherwise the hierarchy's hand-offs.
 */
export function StatusHistoryButton({ story, className = 'cu-outline' }: { story?: CaseStory; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} disabled={!story}>تاریخچه وضعیت پرونده</button>
      {open && story && (
        <Overlay onClose={() => setOpen(false)}>
          <div className="pmodal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head"><span className="pmodal-title">تاریخچه وضعیت پرونده</span><button className="pmodal-x" onClick={() => setOpen(false)} aria-label="بستن">×</button></div>
            <div className="pmodal-body">
              {story.history.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>هنوز وضعیتی ثبت نشده است.</p> : (
                <ul className="cs-hist">
                  {story.history.map((h, i) => (
                    <li key={i}>
                      <span className="cs-hist-main"><span className="cs-hist-at">{h.at}</span> - {h.title}{story.manual && h.detail ? `: ${h.detail}` : ''}</span>
                      {!story.manual && h.detail && <span className="cs-hist-note">- {h.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button type="button" onClick={() => setOpen(false)} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>متوجه شدم</button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

/** The typed history of a hand-completed case, as a simple list (where the hierarchy's route would be). */
export function ManualStoryList({ story }: { story: CaseStory }) {
  return story.history.length === 0
    ? <p className="text-sm p-3" style={{ color: 'var(--muted)' }}>هنوز وضعیتی در «ویرایش» ثبت نشده است.</p>
    : (
      <ul className="cs-hist p-3">
        {story.history.map((h, i) => <li key={i}><span className="cs-hist-main"><span className="cs-hist-at">{h.at}</span> - {h.title}: {h.detail}</span></li>)}
      </ul>
    );
}
