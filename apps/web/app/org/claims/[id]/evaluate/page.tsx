'use client';
import { DeathNoticeDate } from '../../../../components/DeathNoticeDate';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../../../lib/client';
import { Icon } from '../../../../components/Shell';
import { ErrorBox, FancyLoader, Overlay, ReviewButtons, Spinner, StatusBadge } from '../../../../components/ui';
import { Workflow, WorkflowPanel } from '../../../../components/WorkflowPanel';
import { DocMedia } from '../../../../components/DocViewer';
import { OnProgress, UploadButton } from '../../../../components/upload';
import { Filer, filerText, INSURED_RELATIONS, personTitle } from '../../../../components/claim-wording';
import { PaymentBox, PaymentInfo } from '../../../../components/PaymentBox';
import { HeirsCard } from '../../../../components/heirs';

/**
 * «ارزیابی» window of «روند سیناد» (Alborz): full screen like Sinad's — grey case strip on top, the scans
 * on the left, the evaluation on the right (risk box, «ارزیابی» / «عودت» tabs, Sinad's buttons) and the
 * icon bar at the bottom. Every button calls the chain's own actions, so the rules are those of panel 2.
 */
interface DocReview { stage: string; state: string; canEdit: boolean; note?: string | null }
interface ClaimDoc { id: string; fileName: string; isLatest: boolean; reviews?: DocReview[] }
interface Checklist { complete: boolean; items: { code: string; label: string; documents: ClaimDoc[]; extras?: ClaimDoc[] }[]; otherDocuments?: ClaimDoc[] }
interface DocMeta { id: string; fileName: string }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; claimTypeLabel?: string; lineLabel?: string | null; deceasedName: string | null; insuredGender?: string | null; filedBy?: Filer | null; claimTypeDeath?: boolean; deceasedNationalCode?: string | null;
  insuredRelation?: string | null; mainInsuredName?: string | null; estimatedAmount?: string; finalizedAmount?: string | null; eventDate: string | null; deceasedAge?: number | null;
  createdAt?: string | null; causeOfDeath?: string | null; causeDetail?: string | null; description?: string | null; policyNumber?: string | null; coverageStatus?: string | null; lateNotice?: boolean;
  policyHolder?: { name: string | null } | null; broker?: { name: string } | null; currentStage?: string | null; flowDirection?: string | null;
  deficiencies?: { items: string[]; createdAt: string | null; resolvedAt: string | null }[];
  workflow?: Workflow & PaymentInfo;
}
interface Referral { id: string; kind: string; status: string; doctor: string | null; by: string | null; request: Record<string, string>; answer: Record<string, string> | null; at: string; answeredAt: string | null }
interface Sinad {
  enabled: boolean; evaluator: { id: string; name: string; at: string | null; me: boolean } | null; later: boolean;
  doctor: { state: string | null; note: string | null }; fraudCheck: string | null; risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
  canEvaluate: boolean; admin: boolean; returnGroups: { label: string; items: string[] }[];
  history: { kind: string; label: string; note: string | null; by: string; at: string }[];
  related: { id: string; claimNumber: string; claimTypeLabel: string; status: string; name: string | null; relation: string | null; line: string | null; amount: string; createdAt: string }[];
}

const RISK_FA = { LOW: 'کم', MEDIUM: 'متوسط', HIGH: 'زیاد' } as const;
const COVER_FA: Record<string, string> = { VALID: 'پوشش بیمه‌نامه در تاریخ وقوع معتبر است', INVALID: 'پوشش بیمه‌نامه در تاریخ وقوع نامعتبر است', NOT_FOUND: 'بیمه‌شده در سامانهٔ بیمه‌گر یافت نشد', NOT_CHECKED: 'پوشش هنوز استعلام نشده است' };
const num = (v: string) => Number(String(v).replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).replace(/[^\d]/g, '') || 0);
const rial = (n: number | string | null | undefined) => (n == null || n === '' ? '—' : `${Number(n).toLocaleString('fa-IR')} ریال`);

export default function EvaluatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [sinad, setSinad] = useState<Sinad | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [rejecting, setRejecting] = useState<{ docId: string; stage: string; at: 'list' | 'scan' } | null>(null); // ✕ waits for its reason
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [docIdx, setDocIdx] = useState(0);
  const [tab, setTab] = useState<'eval' | 'return'>('eval');
  const [amount, setAmount] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState<number | null>(0);
  const [modal, setModal] = useState<null | 'history' | 'family' | 'note' | 'refer' | 'actions' | 'doctor' | 'heirs'>(null);
  // «اظهار نظر پزشک معتمد»: which doctor, and شعبه's part of the form (the insurer's form will replace these fields)
  const [doctors, setDoctors] = useState<{ id: string; name: string }[] | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [doctorReq, setDoctorReq] = useState({ question: '', history: '' });
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [noteText, setNoteText] = useState('');
  const [doctorKind, setDoctorKind] = useState<'doctor-refer' | 'doctor-exam'>('doctor-refer');
  const [evaluators, setEvaluators] = useState<{ id: string; name: string }[] | null>(null);
  const [referTo, setReferTo] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  // A result or an error is shown at the top of the form: bring it into view.
  useEffect(() => { if (msg || error) document.querySelector('.ev-form')?.scrollTo({ top: 0, behavior: 'smooth' }); }, [msg, error]);

  const load = async () => {
    try {
      const [c, s, cl, dl] = await Promise.all([
        client.get<Claim>(`/claims/${id}`, 'org'),
        client.get<Sinad>(`/claims/${id}/sinad`, 'org'),
        client.get<Checklist>(`/claims/${id}/checklist`, 'org'),
        client.get<DocMeta[]>(`/claims/${id}/documents`, 'org'),
      ]);
      setClaim(c); setSinad(s); setChecklist(cl); setDocs(dl);
      client.get<Referral[]>(`/claims/${id}/doctor-referrals`, 'org').then(setReferrals).catch(() => setReferrals([]));
      setAmount((a) => a || (c.finalizedAmount ? String(Number(c.finalizedAmount)) : ''));
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { if (!getToken('org')) { router.push('/org/login'); return; } load(); /* eslint-disable-next-line */ }, [id]);

  const run = async (fn: () => Promise<any>) => { setError(''); setMsg(''); setBusy(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const op = (name: string, body: Record<string, string> = {}) => client.post<Sinad>(`/claims/${id}/sinad/${name}`, body, 'org').then(setSinad);
  const close = () => router.push('/org/work-desk');

  // Latest document of each item, with this desk's ✓/✕.
  const rows = useMemo(() => {
    const out: { label: string; d: ClaimDoc; code?: string }[] = [];
    checklist?.items.forEach((it) => {
      const d = it.documents.find((x) => x.isLatest) || it.documents[0];
      if (d) out.push({ label: it.label, d, code: it.code });
      (it.extras ?? []).forEach((x, i) => out.push({ label: `${it.label} — صفحهٔ ${(i + 2).toLocaleString('fa-IR')}`, d: x })); // pages added with «+»
    });
    checklist?.otherDocuments?.filter((d) => d.isLatest).forEach((d) => out.push({ label: d.fileName, d }));
    return out;
  }, [checklist]);
  const missing = checklist?.items.filter((it) => !it.documents.length).map((it) => ({ code: it.code, label: it.label, required: !!(it as { required?: boolean }).required })) ?? [];
  const branchReview = (d: ClaimDoc) => d.reviews?.find((r) => r.stage === 'BRANCH');
  // This desk's ✓/✕ on a document: شعبه in «روند سیناد», otherwise whichever desk the viewer may review now.
  const deskReview = (d: ClaimDoc) => (sinad?.canEvaluate ? branchReview(d) : d.reviews?.find((r) => r.canEdit) ?? d.reviews?.find((r) => r.stage === claim?.currentStage));
  const review = (docId: string, state: 'APPROVED' | 'REJECTED' | 'PENDING', stage = 'BRANCH', note?: string) => run(async () => { await client.post(`/claims/${id}/documents/${docId}/review`, { stage, state, ...(note ? { note } : {}) }, 'org'); setRejecting(null); setRejectNote(''); await load(); });
  /** ✕ asks for a reason first (shown to whoever fixes it); ✓ and «لغو» apply at once. */
  const setReview = (d: ClaimDoc, st: 'APPROVED' | 'REJECTED' | 'PENDING', at: 'list' | 'scan' = 'list') => {
    const r = deskReview(d);
    if (!r) return;
    if (st === 'REJECTED') { setRejecting({ docId: d.id, stage: r.stage, at }); setRejectNote(''); return; }
    review(d.id, st, r.stage);
  };
  const approveAll = () => run(async () => {
    for (const { d } of rows) { const r = deskReview(d); if (r?.canEdit && r.state !== 'APPROVED') await client.post(`/claims/${id}/documents/${d.id}/review`, { stage: r.stage, state: 'APPROVED' }, 'org'); }
    await load();
  });
  const rejectBox = (docId: string, at: 'list' | 'scan' = 'list') => rejecting?.docId === docId && rejecting.at === at && (
    <div className="ev-reject">
      <textarea className="input" rows={2} maxLength={300} autoFocus value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="دلیل رد این مدرک (به کسی که آن را اصلاح می‌کند نشان داده می‌شود)" />
      <div className="flex gap-2">
        <button className="ev-btn is-warn" disabled={busy || !rejectNote.trim()} onClick={() => review(docId, 'REJECTED', rejecting.stage, rejectNote.trim())}>ثبت رد مدرک</button>
        <button className="ev-btn" disabled={busy} onClick={() => setRejecting(null)}>انصراف</button>
      </div>
    </div>
  );
  const docRows = (stageLabel: string) => rows.map(({ label, d, code }) => {
    const r = deskReview(d);
    return (
      <div key={d.id}>
        <div className={`ev-doc${doc?.id === d.id ? ' is-on' : ''}`}>
          <button className="ev-doc-name" onClick={() => { const i = docs.findIndex((x) => x.id === d.id); if (i >= 0) setDocIdx(i); }} title="نمایش در تصویر">{label}</button>
          {/* A new version of the document (e.g. a clearer scan), uploaded by this desk itself */}
          {code && !closedNow && <UploadButton className="ev-up" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title="بارگذاری دوبارهٔ مدرک" subtitle={label} onUpload={(f, onP) => uploadDoc(f, onP, code)}>بارگذاری</UploadButton>}
          {r && <ReviewButtons state={r.state} editable={r.canEdit && !closedNow} busy={busy} label={stageLabel} onSet={(st) => setReview(d, st)} />}
        </div>
        {r?.state === 'REJECTED' && r.note && <div className="ev-doc-why">دلیل رد: {r.note}</div>}
        {rejectBox(d.id)}
      </div>
    );
  });

  const w = claim?.workflow;
  const closedNow = ['PAID', 'REJECTED'].includes(claim?.status ?? '');
  const action = (key: string) => w?.actions.find((a) => a.key === key);
  const branchEval = !!sinad?.canEvaluate;
  const requested = Number(claim?.estimatedAmount ?? 0);
  const approved = num(amount);

  /** «تایید و ذخیره»: amount, every document ✓ at شعبه, اعلام خسارت, then on to ستاد (or ask for the originals first). */
  const approveAndSave = () => run(async () => {
    if (!sinad?.fraudCheck) throw new Error('ابتدا در کادر ریسک، نتیجهٔ بررسی تقلب را انتخاب کنید');
    if (sinad.fraudCheck === 'FRAUD') throw new Error('پرونده «تقلب است» علامت خورده؛ از برگهٔ «عودت» استفاده کنید');
    if (!approved) throw new Error('مبلغ تایید شده را وارد کنید');
    if (String(approved) !== String(Number(claim?.finalizedAmount ?? 0))) await client.put(`/claims/${id}/finalized-amount`, { amount: String(approved) }, 'org');
    for (const { d } of rows) {
      const r = branchReview(d);
      if (r?.canEdit && r.state !== 'APPROVED') await client.post(`/claims/${id}/documents/${d.id}/review`, { stage: 'BRANCH', state: 'APPROVED' }, 'org');
    }
    if (sinad.later) await op('resume');
    const c = await client.get<Claim>(`/claims/${id}`, 'org');
    const fwd = c.workflow?.actions.find((a) => a.key === 'FORWARD');
    const phys = c.workflow?.actions.find((a) => a.key === 'REQUEST_PHYSICAL');
    if (fwd && !fwd.disabled) {
      await client.post(`/claims/${id}/action`, { action: 'FORWARD' }, 'org');
      router.push('/org/work-desk');
      return;
    }
    if (phys && !phys.disabled && !c.workflow?.physical?.open) {
      await client.post(`/claims/${id}/action`, { action: 'REQUEST_PHYSICAL' }, 'org');
      await load();
      setMsg(`ارزیابی اولیه ذخیره شد و ${phys.label.replace('درخواست ', '')} درخواست شد؛ پس از دریافت اصل مدارک، پرونده به ${c.workflow?.chain.find((x) => x.stage === 'HQ')?.label ?? 'ستاد'} ارسال می‌شود.`);
      return;
    }
    await load();
    setMsg(fwd?.disabled ? `ارزیابی ذخیره شد. ارسال به مرحلهٔ بعد: ${fwd.disabled}` : 'ارزیابی ذخیره شد.');
  });

  /** «عودت و ذخیره»: the chosen reasons (and «هزینه تقلبی است») become the return's deficiency lines. */
  const returnAndSave = () => run(async () => {
    const ret = action('RETURN');
    if (!ret) throw new Error('عودت در این مرحله ممکن نیست');
    const items = [...(sinad?.fraudCheck === 'FRAUD' ? ['هزینه تقلبی است'] : []), ...picked, ...(returnNote.trim() ? [returnNote.trim()] : [])];
    if (!items.length) throw new Error('حداقل یک علت عودت را انتخاب کنید یا بنویسید');
    await client.post(`/claims/${id}/action`, { action: 'RETURN', deficiencyNotes: items }, 'org');
    router.push('/org/work-desk');
  });

  const openDoctor = (kind: 'doctor-refer' | 'doctor-exam') => {
    setDoctorKind(kind); setNoteText(''); setDoctorId(''); setDoctorReq({ question: '', history: '' }); setModal('doctor');
    if (!doctors) client.get<{ id: string; name: string }[]>('/claims/sinad/doctors', 'org').then(setDoctors).catch(() => setDoctors([]));
  };
  const uploadDoc = async (file: File, onProgress: OnProgress, code = 'OTHER') => {
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'org', onProgress);
    await load();
  };

  if (!claim || !sinad) {
    return <div className="ev-full"><ErrorBox message={error} />{!error && <div className="flex-1 flex items-center justify-center"><FancyLoader label="در حال بارگذاری ارزیابی…" /></div>}</div>;
  }
  const closed = ['PAID', 'REJECTED'].includes(claim.status);
  // Documents not uploaded yet: the desk can upload each one here (e.g. شعبه's «فرم تعیین وضعیت پوشش»).
  const missingRows = missing.length > 0 && (
    <>
      <button className="ev-doc is-missing w-full" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing}>
        <span>{missing.length.toLocaleString('fa-IR')} مدرک بارگذاری نشده است</span><span>{showMissing ? 'بستن ▴' : 'نمایش و بارگذاری ▾'}</span>
      </button>
      {showMissing && missing.map((m) => (
        <div key={m.code} className="ev-doc is-missing">
          <span>{m.label}{m.required ? ' *' : ''}</span>
          {!closed && <UploadButton className="ev-up is-solid" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title="بارگذاری مدرک" subtitle={m.label} onUpload={(f, onP) => uploadDoc(f, onP, m.code)}>بارگذاری</UploadButton>}
        </div>
      ))}
    </>
  );
  const relation = claim.insuredRelation ? INSURED_RELATIONS[claim.insuredRelation] ?? claim.insuredRelation : 'اصلی';
  const doc = docs[docIdx];
  const fraudRed = sinad.fraudCheck === 'FRAUD' || sinad.risk.level === 'HIGH';
  const returns = (claim.deficiencies ?? []).slice().reverse();

  return (
    <div className="ev-full">
      {/* Title bar */}
      <div className="ev-title">
        <span>{branchEval ? 'ارزیابی اولیه' : claim.currentStage === 'BRANCH' ? 'پرونده' : 'ارزیابی نهایی'} — پرونده {claim.claimNumber}</span>
        {sinad.evaluator && <span className="ev-title-sub">ارزیاب: {sinad.evaluator.name}{sinad.evaluator.at ? ` (${sinad.evaluator.at})` : ''}</span>}
        <span className="sk-grow" />
        <StatusBadge status={claim.status} />
        <button className="ev-x" onClick={close} aria-label="بستن">✕</button>
      </div>
      {/* Grey case strip */}
      <div className="ev-strip">
        <div><span>بیمه‌گزار</span><b>{claim.policyHolder?.name || claim.broker?.name || '—'}</b></div>
        <div><span>شماره بیمه‌نامه</span><b>{claim.policyNumber || '—'}</b></div>
        <div><span>نوع بیمه‌نامه</span><b>{claim.lineLabel || '—'}</b></div>
        <div><span>بیمه‌شده</span><b>{personTitle(claim.deceasedName, { death: !!claim.claimTypeDeath, gender: claim.insuredGender }) || '—'}</b></div>
        <div><span>سن</span><b>{claim.deceasedAge != null ? claim.deceasedAge.toLocaleString('fa-IR') : '—'}</b></div>
        <div><span>نسبت</span><b>{relation}{claim.mainInsuredName && relation !== 'اصلی' ? ` (${claim.mainInsuredName})` : ''}</b></div>
        <div><span>کد ملی</span><b className="ltr">{claim.deceasedNationalCode || '—'}</b></div>
        <div><span>مبلغ اعلامی</span><b>{rial(claim.estimatedAmount)}</b></div>
        <div><span>تاریخ وقوع</span><b>{claim.eventDate || '—'}</b></div>
        <div><span>نوع پرونده</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
        {claim.filedBy && <div><span>ثبت‌کننده</span><b>{filerText(claim.filedBy)}</b></div>}
        {fraudRed && <div className="ev-strip-red">{sinad.fraudCheck === 'FRAUD' ? 'این پرونده توسط ارزیاب «تقلب است» علامت خورده است' : `ریسک زیاد: ${sinad.risk.reasons.join('، ')}`}</div>}
      </div>

      <div className="ev-body">
        {/* RIGHT (first in RTL): evaluation */}
        <div className="ev-form">
          <ErrorBox message={error} />
          {msg && <div className="alert-success text-sm">{msg}</div>}

          {/* Risk box */}
          <div className={`ev-risk is-${sinad.risk.level.toLowerCase()}`}>
            <div className="ev-risk-head">
              <span>سطح ریسک: <b>{RISK_FA[sinad.risk.level]}</b></span>
              <button className="ev-link" onClick={() => setModal('family')}>مقایسه با پرونده‌های مرتبط ({sinad.related.length.toLocaleString('fa-IR')})</button>
            </div>
            {sinad.risk.reasons.length > 0 ? <ul className="ev-risk-list">{sinad.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <div className="text-xs">نشانه‌ای از ریسک یافت نشد.</div>}
            {branchEval && !closed && (
              <div className="ev-risk-choice">
                <label><input type="radio" name="fraud" checked={sinad.fraudCheck === 'CLEAN'} disabled={busy} onChange={() => run(() => op('fraud-clean'))} /> بررسی کردم، تقلب نیست</label>
                <label className="is-red"><input type="radio" name="fraud" checked={sinad.fraudCheck === 'FRAUD'} disabled={busy} onChange={() => run(async () => { await op('fraud-flag'); setTab('return'); })} /> تقلب است، عودت شود</label>
              </div>
            )}
          </div>

          {sinad.doctor.state && <div className="ev-yellow">پرونده {sinad.doctor.state === 'EXAM' ? 'در انتظار معاینه توسط پزشک معتمد' : 'در انتظار اظهار نظر پزشک معتمد'} است.</div>}
          {sinad.doctor.note && <div className="ev-yellow"><b>اظهار نظر پزشک معتمد:</b> {sinad.doctor.note}</div>}
          {referrals.length > 0 && (
            <div className="ev-item">
              <div className="ev-item-head"><b>ارجاع به پزشک معتمد</b><span>{referrals.length.toLocaleString('fa-IR')}</span></div>
              {referrals.map((r) => (
                <div key={r.id} className="ev-ref">
                  <div><b>{r.kind === 'EXAM' ? 'دعوت به معاینه' : 'اظهار نظر'}</b> — {r.doctor ?? 'پزشک معتمد'} — {r.at} — {r.status === 'DONE' ? `ثبت شد (${r.answeredAt})` : 'در انتظار پزشک'}</div>
                  {r.request?.question && <div>درخواست شعبه: {r.request.question}</div>}
                  {r.answer && <div className="ev-ref-a">نظر پزشک: {r.answer.opinion}{r.answer.percent ? ` — درصد: ${r.answer.percent}` : ''}{r.answer.examDate ? ` — تاریخ معاینه: ${r.answer.examDate}` : ''}{r.answer.notes ? ` — ${r.answer.notes}` : ''}</div>}
                </div>
              ))}
            </div>
          )}

          {branchEval ? (
            <>
              <div className="ev-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'eval'} className={tab === 'eval' ? 'is-on' : ''} onClick={() => setTab('eval')}>ارزیابی</button>
                <button role="tab" aria-selected={tab === 'return'} className={tab === 'return' ? 'is-on' : ''} onClick={() => setTab('return')}>عودت{returns.length ? ` (${returns.length.toLocaleString('fa-IR')})` : ''}</button>
              </div>

              {tab === 'eval' ? (
                <div className="ev-pane">
                  {/* اصل مدارک: receive (or send) the originals right here — e.g. «دریافت اصل مدارک» from the کارگزاری. */}
                  {w?.physical && (w.physical.actions.length > 0 || w.physical.open) && <WorkflowPanel claimId={id} workflow={w} realm="org" onDone={load} compact physicalOnly />}
                  <div className="ev-fields">
                    <div><span>نوع پرونده</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
                    <div><span>علت</span><b>{claim.causeOfDeath || '—'}{claim.causeDetail ? ` — ${claim.causeDetail}` : ''}</b></div>
                    <div><span>تاریخ وقوع</span><b>{claim.eventDate || '—'}</b></div>
                    <div><span>تاریخ ثبت</span><b>{claim.createdAt || '—'}</b></div>
                  </div>
                  {claim.description && <div className="ev-insured-note"><b>توضیحات بیمه‌گزار:</b> {claim.description}</div>}
                  {claim.coverageStatus && <div className="ev-yellow">{COVER_FA[claim.coverageStatus] ?? claim.coverageStatus}{claim.lateNotice ? ' — اعلام پس از مهلت مقرر' : ''}</div>}

                  <div className="ev-item">
                    <div className="ev-item-head"><b>مدارک پرونده</b><span>{checklist?.complete ? 'کامل' : 'ناقص'}</span></div>
<DeathNoticeDate claimId={id} className="is-ev" />
                    {docRows('شعبه')}
                    {!closed && rows.some(({ d }) => { const r = deskReview(d); return r?.canEdit && r.state !== 'APPROVED'; }) && (
                      <button className="ev-btn w-full mt-2" disabled={busy} onClick={approveAll}>تایید همهٔ مدارک در این مرحله</button>
                    )}
                    {missingRows}
                  </div>

                  <div className="ev-amount">
                    <label htmlFor="ev-amt">مبلغ تایید شده (مبلغ خسارت قطعی)</label>
                    <input id="ev-amt" className="input" inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} disabled={closed}
                      value={amount ? num(amount).toLocaleString('fa-IR') : ''} onChange={(e) => setAmount(String(num(e.target.value) || ''))} placeholder="مبلغ به ریال" />
                  </div>
                  <div className="ev-totals">
                    <div><span>درخواستی</span><b>{rial(requested)}</b></div>
                    <div><span>تاییدی</span><b>{rial(approved || null)}</b></div>
                    <div><span>مانده</span><b>{rial(approved ? requested - approved : null)}</b></div>
                  </div>

                  {!closed && (
                    <>
                      <div className="ev-actions">
                        <button className="ev-btn" disabled={busy} onClick={() => { setReferTo(''); setModal('refer'); if (!evaluators) client.get<{ id: string; name: string }[]>('/claims/sinad/evaluators', 'org').then(setEvaluators).catch(() => setEvaluators([])); }}>ارجاع</button>
                        <button className="ev-btn" disabled={busy} onClick={() => openDoctor('doctor-refer')}>اظهار نظر پزشک معتمد</button>
                        <button className="ev-btn" disabled={busy} onClick={() => openDoctor('doctor-exam')}>دعوت به معاینه</button>
                      </div>
                      <div className="ev-actions">
                        <button className="ev-btn" disabled={busy} onClick={() => run(async () => { await op('later'); router.push('/org/work-desk'); })}>بعدا بررسی میکنم</button>
                        <button className="ev-btn is-main" disabled={busy} onClick={approveAndSave}>{busy ? <Spinner size={16} /> : 'تایید و ذخیره'}</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="ev-pane">
                  <div className="ev-sub">سابقهٔ عودت</div>
                  <table className="sk-table ev-hist">
                    <thead><tr><th>تاریخ</th><th>علت</th><th>وضعیت</th></tr></thead>
                    <tbody>
                      {returns.map((r, i) => <tr key={i}><td>{r.createdAt || '—'}</td><td>{r.items.join('؛ ')}</td><td>{r.resolvedAt ? `رفع شد (${r.resolvedAt})` : 'باز'}</td></tr>)}
                      {returns.length === 0 && <tr><td colSpan={3} className="sk-none">عودتی ثبت نشده است.</td></tr>}
                    </tbody>
                  </table>
                  <label className="ev-check is-red">
                    <input type="checkbox" checked={sinad.fraudCheck === 'FRAUD'} disabled={busy || closed} onChange={(e) => run(() => op(e.target.checked ? 'fraud-flag' : 'fraud-clean'))} /> هزینه تقلبی است
                  </label>
                  <label className="label" htmlFor="ev-rn">علت عودت</label>
                  <textarea id="ev-rn" className="input" rows={2} maxLength={500} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="شرح علت عودت (برای بیمه‌گزار نمایش داده می‌شود)" />
                  <div className="ev-groups">
                    {sinad.returnGroups.map((g, gi) => (
                      <div key={g.label} className="ev-group">
                        <button className="ev-group-head" onClick={() => setOpenGroup(openGroup === gi ? null : gi)} aria-expanded={openGroup === gi}>
                          <span>{g.label}</span><span>{g.items.filter((x) => picked.includes(x)).length ? `(${g.items.filter((x) => picked.includes(x)).length.toLocaleString('fa-IR')})` : ''} {openGroup === gi ? '▴' : '▾'}</span>
                        </button>
                        {openGroup === gi && (
                          <div className="ev-group-body">
                            {g.items.map((it) => (
                              <label key={it}><input type="checkbox" checked={picked.includes(it)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, it] : p.filter((x) => x !== it)))} /> {it}</label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!closed && (
                    <div className="ev-actions">
                      <button className="ev-btn is-warn" disabled={busy || !action('RETURN')} onClick={returnAndSave} title={action('RETURN')?.label}>عودت و ذخیره</button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            // ستاد / شورای فنی (ارزیابی نهایی), a payment order, or a return on its way down: the chain's own actions.
            <div className="ev-pane">
              <div className="ev-sub">{claim.currentStage === 'HQ' || claim.currentStage === 'COUNCIL' ? 'ارزیابی نهایی' : 'اقدام'}</div>
              <div className="ev-totals">
                <div><span>درخواستی</span><b>{rial(requested)}</b></div>
                <div><span>تایید اولیه (شعبه)</span><b>{rial(claim.finalizedAmount)}</b></div>
              </div>
              <div className="ev-item">
                <div className="ev-item-head"><b>مدارک پرونده</b><span>{checklist?.complete ? 'کامل' : 'ناقص'}</span></div>
<DeathNoticeDate claimId={id} className="is-ev" />
                {docRows(w?.currentStageLabel ?? '')}
                {rows.length === 0 && <div className="ev-doc is-missing"><span>مدرکی بارگذاری نشده است.</span></div>}
                {missingRows}
                {!closed && rows.some(({ d }) => { const r = deskReview(d); return r?.canEdit && r.state !== 'APPROVED'; }) && (
                  <button className="ev-btn w-full mt-2" disabled={busy} onClick={approveAll}>تایید همهٔ مدارک در این مرحله</button>
                )}
              </div>
              {w && <PaymentBox claimId={id} info={w} finalizedAmount={claim.finalizedAmount} closed={closed} onDone={load} />}
              {w && <WorkflowPanel claimId={id} workflow={w} realm="org" onDone={load} compact />}
              {!w?.holdsDesk && <div className="text-xs" style={{ color: 'var(--muted)' }}>این پرونده اکنون در «{w?.currentStageLabel || '—'}» است و اقدامی برای شما ندارد.</div>}
            </div>
          )}
        </div>

        {/* LEFT: the scans */}
        <div className="ev-docs">
          <div className="ev-docs-bar">
            <select className="input ev-docs-pick" value={docIdx} onChange={(e) => setDocIdx(Number(e.target.value))} aria-label="انتخاب مدرک">
              {docs.map((d, i) => <option key={d.id} value={i}>{(i + 1).toLocaleString('fa-IR')}. {d.fileName}</option>)}
            </select>
            <button className="zbtn" disabled={docIdx <= 0} onClick={() => setDocIdx((i) => i - 1)} title="مدرک قبلی">›</button>
            <button className="zbtn" disabled={docIdx >= docs.length - 1} onClick={() => setDocIdx((i) => i + 1)} title="مدرک بعدی">‹</button>
            <span className="sk-grow" />
            <button className="zbtn" onClick={() => setZoom((z) => Math.max(40, z - 15))} title="کوچک‌تر">−</button>
            <span style={{ minWidth: 40, textAlign: 'center' }}>{zoom.toLocaleString('fa-IR')}٪</span>
            <button className="zbtn" onClick={() => setZoom((z) => Math.min(250, z + 15))} title="بزرگ‌تر">+</button>
          </div>
          {doc && (() => {
            const row = rows.find((x) => x.d.id === doc.id);
            const r = row ? deskReview(row.d) : undefined;
            const label = row?.label ?? doc.fileName;
            return (
              <div className="ev-docs-rv">
                <span className="ev-docs-rv-t">{label}</span>
                {r ? <ReviewButtons state={r.state} editable={r.canEdit && !closed} busy={busy} onSet={(st) => row && setReview(row.d, st, 'scan')} /> : null}
                {r && <span className={`ev-docs-rv-s is-${r.state}`}>{r.state === 'APPROVED' ? 'تایید شده' : r.state === 'REJECTED' ? 'رد شده' : 'در انتظار بررسی'}</span>}
              </div>
            );
          })()}
          {doc && rejectBox(doc.id, 'scan')}
          {returns.filter((r) => !r.resolvedAt).length > 0 && (
            <div className="ev-pin">{returns.filter((r) => !r.resolvedAt).flatMap((r) => r.items).join('؛ ')}</div>
          )}
          <div className="ev-docs-stage">
            {doc ? <DocMedia key={doc.id} claimId={id} docId={doc.id} fileName={doc.fileName} zoom={zoom} /> : <div className="sk-empty">سندی بارگذاری نشده است.</div>}
          </div>
        </div>
      </div>

      {/* Icon bar */}
      <div className="ev-icons">
        <button title="استعلام از سایر بیمه‌گران (به زودی)" disabled><Icon path="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1" /><span>سایر بیمه‌گران</span></button>
        <button title="استعلام تامین اجتماعی (به زودی)" disabled><Icon path="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" /><span>تامین اجتماعی</span></button>
        <button title="استعلام بیمه سلامت (به زودی)" disabled><Icon path="M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z" /><span>بیمه سلامت</span></button>
        <span className="ev-icons-sep" />
        <button onClick={() => setModal('history')}><Icon path="M12 8v4l3 2M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4" /><span>تاریخچه</span></button>
        <button onClick={() => setModal('family')}><Icon path="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /><span>خسارت اعضای خانواده</span></button>
        <button onClick={() => setModal('heirs')}><Icon path="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" /><span>ذینفعان</span></button>
        <button onClick={() => { setNoteText(''); setModal('note'); }}><Icon path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" /><span>یادداشت ارزیاب</span></button>
        {!closed && <UploadButton className="ev-icon-btn" accept=".pdf,.jpg,.jpeg,.png" maxMB={15} camera title="افزودن پیوست" onUpload={uploadDoc}><Icon path="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" /><span>افزودن پیوست</span></UploadButton>}
        <button onClick={() => window.open(`/org/claims/${id}`, '_blank')}><Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" /><span>پرونده کامل</span></button>
        {branchEval && w && <button onClick={() => setModal('actions')}><Icon path="M12 5v.01M12 12v.01M12 19v.01" /><span>سایر اقدامات</span></button>}
      </div>

      {modal && (
        <Overlay onClose={() => setModal(null)}>
          <div className="pmodal" style={{ maxWidth: modal === 'heirs' ? 1000 : modal === 'actions' || modal === 'family' || modal === 'history' || modal === 'doctor' ? 720 : 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">{({ history: 'تاریخچه', family: 'خسارت اعضای خانواده و پرونده‌های مرتبط', note: 'یادداشت ارزیاب', refer: 'ارجاع به ارزیاب دیگر', actions: 'سایر اقدامات پرونده', heirs: 'ذینفعان / گیرندگان خسارت', doctor: doctorKind === 'doctor-exam' ? 'دعوت به معاینه — فرم پزشک معتمد' : 'اظهار نظر پزشک معتمد — فرم ارجاع' } as const)[modal]}</span>
              <button className="pmodal-x" onClick={() => setModal(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body text-sm space-y-2">
              {modal === 'history' && (
                <table className="sk-table">
                  <thead><tr><th>زمان</th><th>رویداد</th><th>کاربر</th><th>توضیح</th></tr></thead>
                  <tbody>
                    {sinad.history.map((h, i) => <tr key={i}><td>{h.at}</td><td>{h.label}</td><td>{h.by}</td><td>{h.note || '—'}</td></tr>)}
                    {sinad.history.length === 0 && <tr><td colSpan={4} className="sk-none">رویدادی ثبت نشده است.</td></tr>}
                  </tbody>
                </table>
              )}
              {modal === 'family' && (
                <table className="sk-table">
                  <thead><tr><th>شماره پرونده</th><th>نام</th><th>نسبت</th><th>نوع بیمه‌نامه</th><th>نوع پرونده</th><th>مبلغ</th><th>تاریخ ثبت</th><th>وضعیت</th></tr></thead>
                  <tbody>
                    {sinad.related.map((r) => <tr key={r.id} className="cursor-pointer" onClick={() => window.open(`/org/claims/${r.id}`, '_blank')}><td>{r.claimNumber}</td><td>{r.name || '—'}</td><td>{r.relation || '—'}</td><td>{r.line || '—'}</td><td>{r.claimTypeLabel}</td><td>{rial(r.amount)}</td><td>{r.createdAt}</td><td><StatusBadge status={r.status} /></td></tr>)}
                    {sinad.related.length === 0 && <tr><td colSpan={8} className="sk-none">پروندهٔ مرتبطی یافت نشد.</td></tr>}
                  </tbody>
                </table>
              )}
              {modal === 'heirs' && <HeirsCard claimId={id} realm="org" className="" />}
              {modal === 'note' && (
                <textarea className="input" rows={4} maxLength={1000} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="یادداشت ارزیاب (فقط برای کارکنان بیمه‌گر)" />
              )}
              {modal === 'doctor' && (
                // Sinad-style referral form: شعبه's part here; the doctor fills theirs in the پنل پزشک معتمد.
                <div className="ev-dform">
                  <div className="ev-dform-sec">مشخصات بیمه‌شده</div>
                  <div className="ev-dform-grid">
                    <div><span>نام</span><b>{personTitle(claim.deceasedName, { death: !!claim.claimTypeDeath, gender: claim.insuredGender }) || '—'}</b></div>
                    <div><span>کد ملی</span><b className="ltr">{claim.deceasedNationalCode || '—'}</b></div>
                    <div><span>سن</span><b>{claim.deceasedAge != null ? claim.deceasedAge.toLocaleString('fa-IR') : '—'}</b></div>
                    <div><span>نوع پرونده</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
                    <div><span>تاریخ وقوع</span><b>{claim.eventDate || '—'}</b></div>
                    <div><span>علت</span><b>{claim.causeOfDeath || '—'}</b></div>
                  </div>
                  <div className="ev-dform-sec">بخش شعبه</div>
                  <label className="label">پزشک معتمد *</label>
                  {!doctors ? <Spinner size={20} /> : doctors.length === 0
                    ? <div className="text-xs" style={{ color: 'var(--danger)' }}>پزشک معتمدی تعریف نشده است؛ مدیر سازمان کاربری با نقش «پزشک معتمد» بسازد.</div>
                    : <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">انتخاب پزشک معتمد…</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
                  <label className="label">موضوع / سؤال از پزشک معتمد *</label>
                  <textarea className="input" rows={3} maxLength={2000} value={doctorReq.question} onChange={(e) => setDoctorReq({ ...doctorReq, question: e.target.value })} placeholder="مثلاً: تعیین درصد نقص عضو، ارتباط علت فوت با سابقهٔ بیماری…" />
                  <label className="label">سوابق پزشکی / توضیحات شعبه</label>
                  <textarea className="input" rows={2} maxLength={2000} value={doctorReq.history} onChange={(e) => setDoctorReq({ ...doctorReq, history: e.target.value })} />
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>پرونده به برگهٔ «{doctorKind === 'doctor-exam' ? 'دعوت به معاینه' : 'در انتظار اظهار نظر پزشک معتمد'}» و کارتابل پزشک انتخاب‌شده می‌رود و پس از ثبت نظر پزشک به کارتابل شما برمی‌گردد.</div>
                </div>
              )}
              {modal === 'refer' && (
                !evaluators ? <div className="flex justify-center py-4"><Spinner size={28} /></div> : (
                  <select className="input" value={referTo} onChange={(e) => setReferTo(e.target.value)}>
                    <option value="">انتخاب ارزیاب…</option>
                    {evaluators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )
              )}
              {modal === 'actions' && w && <WorkflowPanel claimId={id} workflow={w} realm="org" onDone={() => { setModal(null); load(); }} compact />}
            </div>
            {(modal === 'note' || modal === 'doctor' || modal === 'refer') && (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setModal(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
                <button disabled={busy || (modal === 'note' && !noteText.trim()) || (modal === 'refer' && !referTo) || (modal === 'doctor' && (!doctorId || !doctorReq.question.trim()))} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand-700)' }}
                  onClick={() => {
                    const m = modal; setModal(null);
                    if (m === 'note') run(() => op('note', { note: noteText.trim() }));
                    else if (m === 'doctor') run(async () => { await client.post(`/claims/${id}/sinad/${doctorKind}`, { doctorId, note: doctorReq.question.trim(), request: { question: doctorReq.question.trim(), history: doctorReq.history.trim() } }, 'org'); router.push('/org/work-desk'); });
                    else run(async () => { await op('refer', { userId: referTo }); router.push('/org/work-desk'); });
                  }}>ثبت</button>
              </div>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}
