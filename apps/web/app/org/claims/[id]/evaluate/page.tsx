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
import { DoctorPaper, doctorFormOf } from '../../../../components/paper/DoctorPaper';
import { PaperModal, Values } from '../../../../components/paper/Paper';
import { CaseEditForm } from '../case-edit';
import { AttentionBox } from '../../../../components/AttentionBox';
import { lastPanel } from '../../../../../lib/panel';

/**
 * «ارزیابی» window of «روند سیناد» (Alborz): full screen like Sinad's — grey case strip on top, the scans
 * on the left, the evaluation on the right (risk box, «ارزیابی» / «عودت» tabs, Sinad's buttons) and the
 * icon bar at the bottom. Every button calls the chain's own actions, so the rules are those of panel 2.
 */
interface DocReview { stage: string; state: string; canEdit: boolean; note?: string | null }
interface ClaimDoc { id: string; fileName: string; isLatest: boolean; reviews?: DocReview[] }
interface Checklist { complete: boolean; items: { code: string; label: string; documents: ClaimDoc[]; extras?: ClaimDoc[]; insurerOnly?: boolean; canUpload?: boolean; required?: boolean }[]; otherDocuments?: ClaimDoc[] }
interface DocMeta { id: string; fileName: string }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; line?: string | null; policyholderCompany?: { name: string } | null; claimTypeLabel?: string; lineLabel?: string | null; deceasedName: string | null; insuredGender?: string | null; filedBy?: Filer | null; claimTypeDeath?: boolean; deceasedNationalCode?: string | null;
  insuredRelation?: string | null; mainInsuredName?: string | null; estimatedAmount?: string; finalizedAmount?: string | null; eventDate: string | null; deceasedAge?: number | null;
  createdAt?: string | null; descInCause?: boolean; causeOfDeath?: string | null; causeDetail?: string | null; description?: string | null; policyNumber?: string | null; coverageStatus?: string | null; lateNotice?: boolean;
  policyHolder?: { name: string | null } | null; broker?: { name: string } | null; currentStage?: string | null; flowDirection?: string | null;
  deficiencies?: { items: string[]; createdAt: string | null; resolvedAt: string | null }[];
  workflow?: Workflow & PaymentInfo;
}
interface Referral { id: string; kind: string; status: string; doctor: string | null; by: string | null; request: Record<string, string>; answer: (Record<string, string> & { scanDocId?: string }) | null; at: string; answeredAt: string | null }
interface Sinad {
  enabled: boolean; evaluator: { id: string; name: string; at: string | null; me: boolean } | null; later: boolean;
  doctor: { state: string | null; note: string | null }; fraudCheck: string | null; fraudItems?: { key: string; label: string; reason: string; no: string; why: string | null; value: 'OK' | 'SUSPECT' | null }[];
  exclusions?: { key: string; text: string }[]; exclusionsNote?: string;
  lastActor?: { name: string; at: string } | null; examAllowed?: boolean; examItems?: string[]; contactPhone?: string | null; contactAddress?: string | null; rejectReasons?: string[]; risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
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
  const [modal, setModal] = useState<null | 'history' | 'family' | 'note' | 'refer' | 'actions' | 'doctor' | 'heirs' | 'exclusion' | 'exam'>(null);
  // «دعوت به معاینه» (حوادث, نقص عضو): what شعبه asks the پزشک معتمد
  const [examPick, setExamPick] = useState<string[]>([]);
  // «تطابق ذینفعان»: done (the کارگزاری confirms it before «ارسال به شعبه»)
  const [heirsMatch, setHeirsMatch] = useState<{ at: string } | null>(null);
  // «رد پرونده»: open with its reason (a point of «تطابق شرایط پرونده با بیمه نامه» not approved fills it in).
  const [rejectCase, setRejectCase] = useState<string | null>(null);
  const [exclusion, setExclusion] = useState('');
  // کارگزاری's panel 2 calls this window «بررسی مدارک»; the insurer's keeps «ارزیابی».
  const [brokerDesk, setBrokerDesk] = useState(false);
  useEffect(() => { setBrokerDesk(lastPanel('org') === 'BROKER'); if (new URLSearchParams(window.location.search).get('open') === 'heirs') setModal('heirs'); }, []);
  // «اظهار نظر پزشک معتمد»: which doctor, and شعبه's part of the form (the insurer's form will replace these fields)
  const [doctors, setDoctors] = useState<{ id: string; name: string }[] | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [doctorReq, setDoctorReq] = useState<Values>({});
  const [viewRef, setViewRef] = useState<Referral | null>(null);
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
      client.get<{ match?: { at: string } | null }>(`/claims/${id}/heirs`, 'org').then((h) => setHeirsMatch(h.match ?? null)).catch(() => setHeirsMatch(null));
      setAmount((a) => a || (c.finalizedAmount ? String(Number(c.finalizedAmount)) : ''));
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { if (!getToken('org')) { router.push('/org/login'); return; } load(); /* eslint-disable-next-line */ }, [id]);

  const run = async (fn: () => Promise<any>) => { setError(''); setMsg(''); setBusy(true); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const op = (name: string, body: Record<string, unknown> = {}) => client.post<Sinad>(`/claims/${id}/sinad/${name}`, body, 'org').then(setSinad);
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
  // The insurer's own forms (فرم تعیین وضعیت پوشش …) have their own box for the شعبه operator holding the case.
  const missing = checklist?.items.filter((it) => !it.documents.length && !it.insurerOnly).map((it) => ({ code: it.code, label: it.label, required: !!it.required })) ?? [];
  const insurerForms = checklist?.items.filter((it) => it.insurerOnly) ?? [];
  const canUploadCode = (code?: string) => !code || checklist?.items.find((it) => it.code === code)?.canUpload !== false;
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
          {code && !closedNow && canUploadCode(code) && <UploadButton className="ev-up" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title="بارگذاری دوبارهٔ مدرک" subtitle={label} onUpload={(f, onP) => uploadDoc(f, onP, code)}>بارگذاری</UploadButton>}
          {r && <ReviewButtons state={r.state} editable={r.canEdit && !closedNow} busy={busy} label={stageLabel} onSet={(st) => setReview(d, st)} />}
          {/* The insurer's operator holding the case removes a wrong file */}
          {!brokerDesk && w?.holdsDesk && !closedNow && (
            <button type="button" className="ev-rm" disabled={busy} title="حذف این مدرک" aria-label="حذف این مدرک"
              onClick={() => { if (window.confirm(`«${label}» (${d.fileName}) حذف شود؟ این کار بازگشت‌پذیر نیست.`)) run(async () => { await client.del(`/claims/${id}/documents/${d.id}`, 'org'); await load(); }); }}>
              <Icon path="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
            </button>
          )}
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
  // The insurer's شعبه (not the کارگزاری, ستاد or شورا): «تطابق شرایط پرونده با بیمه نامه» is theirs.
  const insurerBranch = !brokerDesk && (branchEval || w?.myStage === 'BRANCH');
  const requested = Number(claim?.estimatedAmount ?? 0);
  const approved = num(amount);

  /** «تایید و ذخیره»: amount, every document ✓ at شعبه, اعلام خسارت, then on to ستاد (or ask for the originals first). */
  const approveAndSave = () => run(async () => {
    if (!sinad?.fraudCheck) throw new Error('ابتدا موارد «تطابق شرایط پرونده با بیمه نامه» را مشخص کنید');
    if (sinad.fraudCheck === 'FRAUD') throw new Error('موردی از «تطابق شرایط پرونده با بیمه نامه» تأیید نشده است؛ پرونده را رد کنید');
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
    const items = [...picked, ...(returnNote.trim() ? [returnNote.trim()] : [])];
    if (!items.length) throw new Error('حداقل یک علت عودت را انتخاب کنید یا بنویسید');
    await client.post(`/claims/${id}/action`, { action: 'RETURN', deficiencyNotes: items }, 'org');
    router.push('/org/work-desk');
  });

  /** «رد پرونده» (رد نهایی) with its reason. */
  const rejectNow = (note: string) => run(async () => {
    if (!note.trim()) throw new Error('علت رد پرونده را بنویسید');
    await client.post(`/claims/${id}/action`, { action: 'REJECT_FINAL', note: note.trim().slice(0, 1000) }, 'org');
    router.push('/org/work-desk');
  });
  const notApprovedReasons = () => (sinad?.fraudItems ?? []).filter((x) => x.value === 'SUSPECT').map((x) => x.reason).join('\n');
  /** A point of «تطابق شرایط پرونده با بیمه نامه»: approved, or not (the cause first asks which exclusion applies). */
  const setPoint = (key: string, value: 'OK' | 'SUSPECT' | '', why?: string) => run(async () => {
    const s = await client.post<Sinad>(`/claims/${id}/sinad/fraud-item`, { request: { item: key, value, ...(why ? { why } : {}) } }, 'org');
    setSinad(s);
    if (value === 'SUSPECT') setRejectCase((s.fraudItems ?? []).filter((x) => x.value === 'SUSPECT').map((x) => x.reason).join('\n'));
    else if (!(s.fraudItems ?? []).some((x) => x.value === 'SUSPECT')) setRejectCase(null);
  });

  const openDoctor = (kind: 'doctor-refer' | 'doctor-exam') => {
    // شعبه's half of the sheet, filled in with what the case already knows.
    const solo = /انفرادی/.test(claim?.lineLabel ?? '') ? 'انفرادی' : 'گروهی';
    const form = doctorFormOf(claim?.line, claim?.claimType);
    setDoctorKind(kind); setNoteText(''); setDoctorId(''); setModal('doctor');
    setDoctorReq(Object.fromEntries(Object.entries({
      count: '۱', caseNo1: claim?.claimNumber ?? '', plan1: solo, plan2: solo, policyNo1: claim?.policyNumber ?? '',
      title: claim?.insuredGender === 'FEMALE' ? 'خانم' : claim?.insuredGender === 'MALE' ? 'آقای' : '', name: claim?.deceasedName ?? '', insuredOf: claim?.policyholderCompany?.name ?? '',
      pick: form === 'LIFE' ? (claim?.claimType === 'DISABILITY_ILLNESS' ? 'از کارافتادگی دائم و کامل ناشی از بیماری' : 'غرامت فوت')
        : ({ DEATH_ACCIDENT: 'غرامت فوت', DISABILITY_ACCIDENT: 'نقص عضو', MEDICAL_ACCIDENT: 'هزینه پزشکی', DAILY_GENERAL: 'غرامت های روزانه', DAILY_HOSPITAL: 'غرامت های روزانه' } as Record<string, string>)[claim?.claimType ?? ''] ?? '',
    }).filter(([, v]) => v)));
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
  // «تطابق مشخصات هویتی»: the case's data (was «ویرایش» on مشاهده), four fields open, the rest in a drawer.
  const identity = <CaseEditForm key={claim.id} claimId={id} title={claim.deceasedName ?? ''} onSaved={load} match />;
  // «تطابق ذینفعان»: the case's ذینفعان (the کارگزاری confirms them before «ارسال به شعبه»).
  const heirsItem = (
    <button type="button" className={`ev-item ev-open${brokerDesk ? (heirsMatch ? ' is-done' : ' is-due') : ''}`} onClick={() => setModal('heirs')}>
      <b>تطابق ذینفعان</b>
      <span className="ev-open-r">{brokerDesk && (heirsMatch ? <small>✓ انجام شد</small> : <small>انجام نشده</small>)}<Icon path="M9 18l-6-6 6-6" /></span>
    </button>
  );

  return (
    <div className="ev-full">
      {/* Title bar */}
      <div className="ev-title">
        <span>{brokerDesk ? 'بررسی مدارک' : branchEval ? 'ارزیابی اولیه' : claim.currentStage === 'BRANCH' ? 'پرونده' : 'ارزیابی نهایی'} — پرونده {claim.claimNumber}</span>
        {sinad.lastActor && <span className="ev-title-sub">آخرین اقدام کننده: {sinad.lastActor.name} ({sinad.lastActor.at})</span>}
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
        <div><span>مبلغ غرامت</span><b>{rial(claim.estimatedAmount)}</b></div>
        {sinad.contactPhone && insurerBranch && <div><span>شماره تماس</span><b className="ltr">{sinad.contactPhone}</b></div>}
        {sinad.contactAddress && insurerBranch && <div><span>محل سکونت</span><b>{sinad.contactAddress}</b></div>}
        <div><span>تاریخ وقوع</span><b>{claim.eventDate || '—'}</b></div>
        <div><span>نوع پرونده</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
        {claim.filedBy && <div><span>ثبت‌کننده</span><b>{filerText(claim.filedBy)}</b></div>}
        {fraudRed && insurerBranch && <div className="ev-strip-red">{sinad.fraudCheck === 'FRAUD' ? `تأیید نشده: ${(sinad.fraudItems ?? []).filter((x) => x.value === 'SUSPECT').map((x) => x.reason).join('، ')}` : `ریسک زیاد: ${sinad.risk.reasons.join('، ')}`}</div>}
      </div>

      <div className="ev-body">
        {/* RIGHT (first in RTL): evaluation */}
        <div className="ev-form">
          <ErrorBox message={error} />
          {msg && <div className="alert-success text-sm">{msg}</div>}
          {/* what waits for this user on the case, and why an action is blocked */}
          <AttentionBox items={w?.attention} onFix={(f) => {
            if (f === 'HEIRS') setModal('heirs');
            else document.querySelector(f === 'PHYSICAL' ? '.ph-anchor' : '.ev-docs-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }} />

          {/* «تطابق شرایط پرونده با بیمه نامه»: the insurer's شعبه only */}
          {insurerBranch && (
            <div className={`ev-risk is-${sinad.risk.level.toLowerCase()}`}>
              <div className="ev-risk-head">
                <b>تطابق شرایط پرونده با بیمه نامه</b>
                <button className="ev-link" onClick={() => setModal('family')}>مقایسه با پرونده‌های مرتبط ({sinad.related.length.toLocaleString('fa-IR')})</button>
              </div>
              <div className="text-xs">سطح ریسک: <b>{RISK_FA[sinad.risk.level]}</b>{sinad.risk.reasons.length > 0 ? ` — ${sinad.risk.reasons.join('، ')}` : ''}</div>
              <div className="ev-fraud">
                {(sinad.fraudItems ?? []).map((x, i) => (
                  <div key={x.key} className={`ev-fraud-row${x.value === 'SUSPECT' ? ' is-bad' : x.value === 'OK' ? ' is-ok' : ''}`}>
                    <span>{(i + 1).toLocaleString('fa-IR')}. {x.label}{x.value === 'SUSPECT' && x.why ? <small className="ev-fraud-why"> — بند {x.why}</small> : null}</span>
                    {branchEval && !closed ? (
                      <span className="ev-fraud-btns">
                        <button type="button" className={`is-green${x.value === 'OK' ? ' is-on' : ''}`} disabled={busy} onClick={() => setPoint(x.key, x.value === 'OK' ? '' : 'OK')}>مورد تأیید است</button>
                        <button type="button" className={`is-red${x.value === 'SUSPECT' ? ' is-on' : ''}`} disabled={busy}
                          onClick={() => (x.value === 'SUSPECT' ? setPoint(x.key, '') : x.key === 'CAUSE_POLICY' ? (setExclusion(''), setModal('exclusion')) : setPoint(x.key, 'SUSPECT'))}>{x.no}</button>
                      </span>
                    ) : <b>{x.value === 'OK' ? 'مورد تأیید است' : x.value === 'SUSPECT' ? x.no : '—'}</b>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* «رد پرونده»: a point above not approved, or the button below */}
          {/* «رد پرونده»: a dialog in the middle of the screen (the button sits at the bottom of a long form) */}
          {rejectCase !== null && branchEval && !closed && (
            <Overlay onClose={() => !busy && setRejectCase(null)}>
            <div className="pmodal ev-rejectcase" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
              <div className="pmodal-head"><span className="pmodal-title">رد پرونده</span><button className="pmodal-x" onClick={() => setRejectCase(null)} aria-label="بستن">×</button></div>
              <div className="ev-reject-reasons">
                {(sinad.rejectReasons ?? []).map((x) => {
                  const on = rejectCase.split('\n').includes(x);
                  return <label key={x}><input type="checkbox" checked={on} onChange={() => setRejectCase(on ? rejectCase.split('\n').filter((l) => l !== x).join('\n') : [rejectCase.trim(), x].filter(Boolean).join('\n'))} /> {x}</label>;
                })}
              </div>
              <textarea className="input" rows={4} maxLength={1000} autoFocus value={rejectCase} onChange={(e) => setRejectCase(e.target.value)} placeholder="علت رد پرونده" />
              <div className="flex gap-2">
                <button className="ev-btn is-warn" disabled={busy || !rejectCase.trim() || !action('REJECT_FINAL')} onClick={() => rejectNow(rejectCase)}>ثبت رد پرونده</button>
                <button className="ev-btn" disabled={busy} onClick={() => setRejectCase(null)}>انصراف</button>
              </div>
            </div>
            </Overlay>
          )}

          {sinad.doctor.state && <div className="ev-yellow">پرونده {sinad.doctor.state === 'EXAM' ? 'در انتظار معاینه توسط پزشک معتمد' : 'در انتظار اظهار نظر پزشک معتمد'} است.</div>}
          {sinad.doctor.note && <div className="ev-yellow"><b>اظهار نظر پزشک معتمد:</b> {sinad.doctor.note}</div>}
          {referrals.length > 0 && (
            <div className="ev-item">
              <div className="ev-item-head"><b>ارجاع به پزشک معتمد</b><span>{referrals.length.toLocaleString('fa-IR')}</span></div>
              {referrals.map((r) => (
                <div key={r.id} className="ev-ref">
                  <div><b>{r.kind === 'EXAM' ? 'دعوت به معاینه' : 'اظهار نظر'}</b> — {r.doctor ?? 'پزشک معتمد'} — {r.at} — {r.status === 'DONE' ? `ثبت شد (${r.answeredAt})` : 'در انتظار پزشک'}</div>
                  {(r.request?.notes || r.request?.question) && <div>ملاحظات شعبه: {r.request.notes || r.request.question}</div>}
                  {r.answer && <div className="ev-ref-a">نظر پزشک: {r.answer.opinion}{r.answer.percent ? ` — درصد: ${r.answer.percent}` : ''}</div>}
                  <div className="flex gap-2 flex-wrap">
                    <button className="ev-btn" onClick={() => setViewRef(r)}>مشاهده فرم</button>
                    {r.answer?.scanDocId && <button className="ev-btn" onClick={() => client.view(`/claims/${id}/documents/${r.answer!.scanDocId}/file`, 'org').catch((e) => setError(e.message))}>تصویر فرم پزشک</button>}
                    {insurerBranch && !closed && <UploadButton className="ev-btn" accept=".pdf,.jpg,.jpeg,.png" maxMB={15} camera title="بارگذاری فرم پزشک معتمد" subtitle={r.kind === 'EXAM' ? 'دعوت به معاینه' : 'اظهار نظر پزشک معتمد'}
                      onUpload={async (f, onP) => { const fd = new FormData(); fd.append('file', f); await client.upload(`/claims/${id}/doctor-referrals/${r.id}/scan`, fd, 'org', onP); await load(); }}>بارگذاری فرم پزشک</UploadButton>}
                  </div>
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
                  {w?.physical && (w.physical.actions.length > 0 || w.physical.open || w.physical.match) && <div className="ph-anchor"><WorkflowPanel claimId={id} workflow={w} realm="org" onDone={load} compact physicalOnly /></div>}
                  <div className="ev-fields">
                    <div><span>نوع پرونده</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
                    <div><span>علت</span><b>{claim.causeOfDeath || '—'}{claim.causeDetail ? ` — ${claim.causeDetail}` : ''}{claim.descInCause && claim.description ? ` — ${claim.description}` : ''}</b></div>
                    <div><span>تاریخ وقوع</span><b>{claim.eventDate || '—'}</b></div>
                    <div><span>تاریخ ثبت</span><b>{claim.createdAt || '—'}</b></div>
                  </div>
                  {claim.description && !claim.descInCause && <div className="ev-insured-note"><b>توضیحات بیمه‌گزار:</b> {claim.description}</div>}
                  {claim.coverageStatus && <div className="ev-yellow">{COVER_FA[claim.coverageStatus] ?? claim.coverageStatus}{claim.lateNotice ? ' — اعلام پس از مهلت مقرر' : ''}</div>}

                  {identity}

                  {insurerForms.some((it) => it.canUpload) && !closed && (
                    <div className="ev-item ev-forms">
                      <div className="ev-item-head"><b>فرم‌های شعبه</b></div>
                      {insurerForms.map((it) => {
                        const d = it.documents.find((x) => x.isLatest) ?? it.documents[0];
                        return (
                          <div key={it.code} className={`ev-form-row${d ? ' is-done' : ''}`}>
                            <span className="ev-form-l">{d ? '✓ ' : ''}{it.label}{it.required ? ' *' : ''}</span>
                            {d && <button type="button" className="ev-btn" onClick={() => { const i = docs.findIndex((x) => x.id === d.id); if (i >= 0) setDocIdx(i); }}>نمایش</button>}
                            {it.canUpload && <UploadButton className="ev-btn is-main" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title={d ? 'بارگذاری دوباره' : 'بارگذاری'} subtitle={it.label} onUpload={(f, onP) => uploadDoc(f, onP, it.code)}>{d ? 'بارگذاری دوباره' : 'بارگذاری'}</UploadButton>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="ev-item">
                    <div className="ev-item-head ev-docs-anchor"><b>{brokerDesk ? 'مدارک پرونده' : 'تطابق مدارک پرونده'}</b><span>{checklist?.complete ? 'کامل' : 'ناقص'}</span></div>
<DeathNoticeDate claimId={id} className="is-ev" />
                    {docRows('شعبه')}
                    {!closed && rows.some(({ d }) => { const r = deskReview(d); return r?.canEdit && r.state !== 'APPROVED'; }) && (
                      <button className="ev-btn w-full mt-2" disabled={busy} onClick={approveAll}>تایید همهٔ مدارک در این مرحله</button>
                    )}
                    {missingRows}
                  </div>
                  {heirsItem}

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
                        {sinad.examAllowed && <button className="ev-btn" disabled={busy} onClick={() => { setExamPick([]); setNoteText(''); setDoctorId(''); setModal('exam'); if (!doctors) client.get<{ id: string; name: string }[]>('/claims/sinad/doctors', 'org').then(setDoctors).catch(() => setDoctors([])); }}>دعوت به معاینه</button>}
                        <button className="ev-btn" disabled={busy} onClick={() => openDoctor('doctor-refer')}>اظهار نظر پزشک معتمد</button>
                        <button className="ev-btn" disabled={busy} onClick={() => run(async () => { await op('later'); router.push('/org/work-desk'); })}>بعدا بررسی میکنم</button>
                      </div>
                      <div className="ev-actions">
                        <button className="ev-btn" disabled={busy || !action('RETURN')} onClick={() => setTab('return')}>عودت</button>
                        <button className="ev-btn is-warn" disabled={busy || !action('REJECT_FINAL')} onClick={() => setRejectCase(rejectCase ?? notApprovedReasons())}>رد پرونده</button>
                        <button className="ev-btn is-main" disabled={busy} onClick={approveAndSave}>{busy ? <Spinner size={16} /> : 'تأیید و ذخیره'}</button>
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
              {identity}
              <div className="ev-item">
                <div className="ev-item-head ev-docs-anchor"><b>{brokerDesk ? 'مدارک پرونده' : 'تطابق مدارک پرونده'}</b><span>{checklist?.complete ? 'کامل' : 'ناقص'}</span></div>
<DeathNoticeDate claimId={id} className="is-ev" />
                {docRows(w?.currentStageLabel ?? '')}
                {rows.length === 0 && <div className="ev-doc is-missing"><span>مدرکی بارگذاری نشده است.</span></div>}
                {missingRows}
                {!closed && rows.some(({ d }) => { const r = deskReview(d); return r?.canEdit && r.state !== 'APPROVED'; }) && (
                  <button className="ev-btn w-full mt-2" disabled={busy} onClick={approveAll}>تایید همهٔ مدارک در این مرحله</button>
                )}
              </div>
              {heirsItem}
              {w && <PaymentBox claimId={id} info={w} finalizedAmount={claim.finalizedAmount} closed={closed} onDone={load} />}
              {w && <div className="ph-anchor"><WorkflowPanel claimId={id} workflow={w} realm="org" onDone={load} compact /></div>}
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
        <button onClick={() => { setNoteText(''); setModal('note'); }}><Icon path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" /><span>یادداشت کارشناس</span></button>
        {!closed && <UploadButton className="ev-icon-btn" accept=".pdf,.jpg,.jpeg,.png" maxMB={15} camera title="افزودن پیوست" onUpload={uploadDoc}><Icon path="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" /><span>افزودن پیوست</span></UploadButton>}
      </div>

      {modal === 'doctor' && (
        <PaperModal title={doctorKind === 'doctor-exam' ? 'دعوت به معاینه' : 'اظهار نظر پزشک معتمد'} onClose={() => setModal(null)} actions={
          <>
            {!doctors ? <Spinner size={20} /> : doctors.length === 0
              ? <span className="text-sm font-bold" style={{ color: '#fecaca' }}>پزشک معتمدی تعریف نشده است.</span>
              : <select className="input" style={{ width: 'auto', minWidth: 220 }} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">انتخاب پزشک معتمد…</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            <button className="btn btn-solid" disabled={busy || !doctorId} onClick={() => {
              const form = doctorFormOf(claim.line, claim.claimType);
              setModal(null);
              run(async () => { await client.post(`/claims/${id}/sinad/${doctorKind}`, { doctorId, note: doctorReq.notes?.trim() || undefined, request: { ...doctorReq, form } }, 'org'); router.push('/org/work-desk'); });
            }}>ارسال به پزشک معتمد</button>
            <button className="btn" onClick={() => setModal(null)}>انصراف</button>
          </>
        }>
          <DoctorPaper form={doctorFormOf(claim.line, claim.claimType)} request={doctorReq} onRequest={setDoctorReq} answer={{}} />
        </PaperModal>
      )}
      {viewRef && viewRef.kind === 'EXAM' && (
        <Overlay onClose={() => setViewRef(null)}>
          <div className="pmodal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head"><span className="pmodal-title">دعوت به معاینه — {viewRef.doctor ?? 'پزشک معتمد'}</span><button className="pmodal-x" onClick={() => setViewRef(null)} aria-label="بستن">×</button></div>
            <div className="pmodal-body text-sm space-y-2">
              <div><b>درخواست شعبه</b> ({viewRef.by ?? '—'} — {viewRef.at})</div>
              {(viewRef.request?.items ?? '').split('\n').filter(Boolean).map((x) => <div key={x}>• {x}</div>)}
              {viewRef.request?.phone && <div>شماره تماس: <b className="ltr">{viewRef.request.phone}</b></div>}
              {viewRef.request?.notes && <div>ملاحظات: {viewRef.request.notes}</div>}
              <hr style={{ borderColor: 'var(--border)' }} />
              {viewRef.answer ? (
                <>
                  <div><b>نتیجهٔ معاینه</b> ({viewRef.answeredAt})</div>
                  {viewRef.answer.examDate && <div>تاریخ معاینه: {viewRef.answer.examDate}</div>}
                  {viewRef.answer.percent && <div>درصد نقص عضو: {viewRef.answer.percent}</div>}
                  {viewRef.answer.opinion && <div>نظر پزشک: {viewRef.answer.opinion}</div>}
                </>
              ) : <div style={{ color: 'var(--muted)' }}>در انتظار پزشک معتمد</div>}
            </div>
          </div>
        </Overlay>
      )}
      {viewRef && viewRef.kind !== 'EXAM' && (
        <PaperModal title={viewRef.kind === 'EXAM' ? 'دعوت به معاینه' : 'اظهار نظر پزشک معتمد'} onClose={() => setViewRef(null)}>
          <DoctorPaper form={viewRef.request?.form === 'ACCIDENT' ? 'ACCIDENT' : viewRef.request?.form === 'LIFE' ? 'LIFE' : doctorFormOf(claim.line, claim.claimType)}
            request={viewRef.request ?? {}} answer={viewRef.answer ?? {}}
            requestSign={{ name: viewRef.by ?? '', at: viewRef.at.split(' ')[0] }} answerSign={viewRef.answeredAt ? { name: viewRef.doctor ?? '', at: viewRef.answeredAt.split(' ')[0] } : null} />
        </PaperModal>
      )}
      {modal && modal !== 'doctor' && (
        <Overlay onClose={() => setModal(null)}>
          <div className="pmodal" style={{ maxWidth: modal === 'heirs' || modal === 'exclusion' ? 1000 : modal === 'actions' || modal === 'family' || modal === 'history' ? 720 : 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">{({ history: 'تاریخچه', family: 'خسارت اعضای خانواده و پرونده‌های مرتبط', note: 'یادداشت کارشناس', refer: 'ارجاع به کارشناس دیگر', exam: 'دعوت به معاینه', actions: 'سایر اقدامات پرونده', heirs: 'تطابق ذینفعان', exclusion: 'تطابق علت فوت با شرایط خصوصی بیمه نامه' } as Record<string, string>)[modal]}</span>
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
              {modal === 'heirs' && <HeirsCard claimId={id} realm="org" className="" onChanged={load} />}
              {modal === 'exam' && (
                <div className="space-y-3">
                  {!doctors ? <Spinner size={20} /> : doctors.length === 0 ? <div className="text-sm font-bold" style={{ color: 'var(--danger)' }}>پزشک معتمدی تعریف نشده است.</div> : (
                    <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">انتخاب پزشک معتمد…</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  )}
                  <div className="ev-exam-phone">شماره تماس قابل دسترس: <b className="ltr">{sinad.contactPhone || 'ثبت نشده'}</b></div>
                  {sinad.contactAddress && <div className="ev-exam-phone">محل سکونت: <b>{sinad.contactAddress}</b></div>}
                  <div className="ev-reject-reasons">
                    {(sinad.examItems ?? []).map((x) => <label key={x}><input type="checkbox" checked={examPick.includes(x)} onChange={(e) => setExamPick((p) => (e.target.checked ? [...p, x] : p.filter((y) => y !== x)))} /> {x}</label>)}
                  </div>
                  <textarea className="input" rows={3} maxLength={1000} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="ملاحظات شعبه" />
                </div>
              )}
              {modal === 'exclusion' && (
                <div className="ev-excl">
                  {(sinad.exclusions ?? []).map((x) => (
                    <div key={x.key}>
                      {x.key === 'ل' && sinad.exclusionsNote && <p className="ev-excl-note">{sinad.exclusionsNote}</p>}
                      <label className={`ev-excl-row${exclusion === x.key ? ' is-on' : ''}`}>
                        <input type="radio" name="excl" checked={exclusion === x.key} onChange={() => setExclusion(x.key)} />
                        <span><b>{x.key})</b> {x.text}</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {modal === 'note' && (
                <textarea className="input" rows={4} maxLength={1000} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="یادداشت کارشناس (فقط برای کارکنان سازمان)" />
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
            {modal === 'exam' && (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setModal(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
                <button disabled={busy || !doctorId || !examPick.length} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand-700)' }}
                  onClick={() => { setModal(null); run(async () => { await client.post(`/claims/${id}/sinad/doctor-exam`, { doctorId, note: noteText.trim() || undefined, request: { form: 'EXAM', items: examPick.join('\n'), phone: sinad.contactPhone ?? '', notes: noteText.trim() } }, 'org'); router.push('/org/work-desk'); }); }}>ارسال دعوت به معاینه</button>
              </div>
            )}
            {modal === 'exclusion' && (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setModal(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
                <button disabled={busy || !exclusion} className="flex-1 py-3 font-bold" style={{ color: 'var(--danger)' }}
                  onClick={() => { setModal(null); setPoint('CAUSE_POLICY', 'SUSPECT', exclusion); }}>ثبت و رد پرونده</button>
              </div>
            )}
            {(modal === 'note' || modal === 'refer') && (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setModal(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
                <button disabled={busy || (modal === 'note' && !noteText.trim()) || (modal === 'refer' && !referTo)} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand-700)' }}
                  onClick={() => {
                    const m = modal; setModal(null);
                    if (m === 'note') run(() => op('note', { note: noteText.trim() }));
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
