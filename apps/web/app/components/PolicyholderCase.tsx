'use client';
import { useEffect, useState } from 'react';
import { toGregorian } from 'jalaali-js';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../lib/client';
import { lastPanel } from '../../lib/panel';
import { BigIcon, claimTypeLabel, ErrorBox, Spinner } from './ui';
import { Icon, Shell } from './Shell';
import { CUSTOMER_NAV } from '../customer/nav';
import { Diamond, IC } from '../customer/launcher';
import { ORG_NAV } from '../org/nav';
import { WorkflowPanel } from './WorkflowPanel';
import { caseTitle } from '../../lib/caseTitle';
import { AI_QUEUED_FA, aiVerdict, ChecklistItem, ClaimDoc, dateOnly, STATUS_FA, useCase } from './case-ui';
import { DocUploadTile, OnProgress, UploadButton } from './upload';
import { BENEFICIARY_FORM, BeneficiaryChoice, INHERITANCE_CERT, NO_FORM_LETTER } from './heirs';
import { JalaliDatePicker } from './JalaliDatePicker';
import { Flash } from './Toaster';
import { DeficiencyBox } from './DeficiencyBox';

const DESK_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'مدیریت ستاد', COUNCIL: 'شورای فنی' };
const OK = 'M20 6L9 17l-5-5';
const NO = 'M18 6L6 18M6 6l12 12';
const RESULT_KEY = (id: string) => `submitResult:${id}`;
const asc = (s: string | null | undefined) => (s ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
function jalaliToIso(input: string): string | null {
  const p = asc(input).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

type FilingForm = { name: string; nid: string; birth: string; event: string; cause: string; description: string };

/**
 * «ویرایش مشخصات»: panel 1 corrects what it filed until panel 2 starts on the case (its first review,
 * hand-off or «ویرایش»). Only the changed fields go to the server, which checks the window again.
 */
function FilingEditor({ claim, api, realm, onSaved, onCancel }: { claim: any; api: string; realm: 'customer' | 'org'; onSaved: () => void; onCancel: () => void }) {
  const start: FilingForm = {
    name: claim.deceasedName ?? '', nid: /^\d{10}$/.test(asc(claim.deceasedNationalCode)) ? asc(claim.deceasedNationalCode) : '',
    birth: asc(claim.deceasedBirthDate), event: asc(claim.eventDate), cause: claim.causeOfDeath ?? '', description: claim.description ?? '',
  };
  const [f, setF] = useState(start);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError('');
    const body: Record<string, string> = {};
    if (f.name.trim() !== start.name) { if (f.name.trim().length < 2) return setError('نام بیمه‌شده را بنویسید'); body.deceasedFullName = f.name.trim(); }
    if (asc(f.nid).trim() !== start.nid) { if (!/^\d{10}$/.test(asc(f.nid).trim())) return setError('کد ملی باید ۱۰ رقم باشد'); body.deceasedNationalCode = asc(f.nid).trim(); }
    if (f.event !== start.event) { const iso = jalaliToIso(f.event); if (!iso) return setError('تاریخ وقوع نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱)'); body.eventDate = iso; }
    if (f.birth !== start.birth) { const iso = f.birth ? jalaliToIso(f.birth) : ''; if (iso === null) return setError('تاریخ تولد نامعتبر است (نمونه: ۱۳۴۵/۰۵/۱۲)'); body.deceasedBirthDate = iso; }
    if (f.cause.trim() !== start.cause) body.causeOfDeath = f.cause.trim();
    if (f.description.trim() !== start.description) body.description = f.description.trim();
    if (!Object.keys(body).length) return onCancel();
    setBusy(true);
    try { await client.put(`${api}/filing`, body, realm); onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const set = (k: keyof FilingForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3 mt-3">
      <Flash text={error} ok={false} />
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
        <label className="block"><span className="label">کد ملی بیمه‌شده</span><input className="input latin-digits" value={f.nid} onChange={set('nid')} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} placeholder={claim.deceasedNationalCode ?? ''} /></label>
        <label className="block"><span className="label">نام بیمه‌شده</span><input className="input" value={f.name} onChange={set('name')} maxLength={120} /></label>
        <label className="block"><span className="label">تاریخ تولد</span><JalaliDatePicker value={f.birth} onChange={(v) => setF({ ...f, birth: v })} placeholder="۱۳۴۵/۰۵/۱۲" /></label>
        <label className="block"><span className="label">تاریخ وقوع</span><JalaliDatePicker value={f.event} onChange={(v) => setF({ ...f, event: v })} placeholder="۱۴۰۵/۰۷/۰۱" /></label>
        <label className="block md:col-span-2"><span className="label">علت</span><input className="input" value={f.cause} onChange={set('cause')} maxLength={300} /></label>
        <label className="block md:col-span-2 lg:col-span-3"><span className="label">توضیحات</span><textarea className="input" rows={2} value={f.description} onChange={set('description')} maxLength={2000} /></label>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'ذخیرهٔ مشخصات'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>انصراف</button>
      </div>
    </div>
  );
}

/** Upload state of one checklist row while a file is going up, or the outcome right after. */
type UpState = { pct: number; eta: number | null } | { done: true } | { error: string };

/** Plain-language status of one required document, from its upload and every desk's decision. */
function docStory(it: ChecklistItem, manual = false): { tone: 'ok' | 'bad' | 'wait' | 'none'; text: string } {
  const d = it.documents[0];
  if (!d) return { tone: 'none', text: 'هنوز بارگذاری نشده است' };
  // A hand-completed case («ویرایش») has no desk-by-desk review to tell.
  if (manual) return { tone: 'ok', text: 'بارگذاری شد' };
  const rv = d.reviews ?? [];
  const rejected = rv.find((r) => r.state === 'REJECTED');
  if (rejected) return { tone: 'bad', text: `${DESK_FA[rejected.stage] || rejected.stage} این مدرک را رد کرد؛ لطفاً مدرک صحیح را دوباره بارگذاری کنید` };
  if (rv.length && rv.every((r) => r.state === 'APPROVED')) return { tone: 'ok', text: 'این مدرک در همهٔ مراحل تایید شده است' };
  const done = rv.filter((r) => r.state === 'APPROVED').map((r) => DESK_FA[r.stage]);
  const next = rv.find((r) => r.state !== 'APPROVED');
  if (done.length) return { tone: 'wait', text: `تایید ${done.join('، ')} — در دست بررسی ${next ? DESK_FA[next.stage] : ''}` };
  return { tone: 'wait', text: 'بارگذاری شد — در دست بررسی کارگزاری' };
}

/**
 * بیمه‌گزار — «جزئیات پرونده»: the case header card, every required document with its precise review
 * trail and an upload ring, then «روند پرونده» (its own page) and «ثبت نهایی» (send the documents on).
 */
/** Model View: who else may sign in to the پنل بیمه‌شده for this case (the insured, a dependent). */
function InsuredAccess({ claimId }: { claimId: string }) {
  const base = `/customer/claims/${claimId}/insured-access`;
  const [rows, setRows] = useState<{ id: string; fullName: string | null; phone: string; expiresAt: string }[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const load = () => client.get<typeof rows>(base, 'customer').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [claimId]);
  const invite = async () => {
    setState(null);
    try { await client.post(base, { phone, fullName: name || undefined }, 'customer'); setState({ t: 'ok', m: 'دعوت پیامک شد.' }); setPhone(''); setName(''); await load(); }
    catch (e: any) { setState({ t: 'err', m: e.message }); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm('دسترسی این شماره قطع شود؟')) return;
    try { await client.del(`${base}/${id}`, 'customer'); await load(); } catch (e: any) { setState({ t: 'err', m: e.message }); }
  };
  return (
    <section className="pcard cu-spec">
      <h2 className="cu-spec-h"><span>پنل بیمه‌شده</span></h2>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>بیمه‌شده یا افراد تحت تکفل با این شماره وارد می‌شوند و فقط مدارک خود را بارگذاری می‌کنند.</p>
      <Flash id={state} text={state?.m} ok={!!state && state.t === 'ok'} />
      <div className="flex gap-2 flex-wrap">
        <input className="input max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام (اختیاری)" maxLength={120} aria-label="نام" />
        <input className="input max-w-xs" inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" aria-label="موبایل" />
        <button type="button" className="btn btn-primary" disabled={phone.length < 10} onClick={invite}>دعوت با پیامک</button>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>{r.fullName ?? 'بدون نام'} — <bdi className="latin-digits">{r.phone}</bdi></span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => revoke(r.id)}>قطع دسترسی</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The case as the بیمه‌گزار / نماینده see it — and, on panel 1, an organization's own staff filing it
 * (`realm="org"`: the same page on the organization's endpoints; no «پنل بیمه‌شده» invitations there).
 */
export function PolicyholderCase({ realm }: { realm: 'customer' | 'org' }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const org = realm === 'org';
  const api = `${org ? '/claims' : '/customer/claims'}/${id}`;
  const page = org ? `/org/claims/${id}` : `/customer/claims/${id}`;
  const { claim, checklist, error, setError, reload } = useCase(id, realm);
  const [sentOk, setSentOk] = useState(false);
  const [insurers, setInsurers] = useState<Record<string, string>>({});
  const [lateWarn, setLateWarn] = useState(true);
  const [up, setUp] = useState<Record<string, UpState>>({});
  const [sending, setSending] = useState(false);
  const [aiNote, setAiNote] = useState(false); // an upload went to the AI check queue (result comes by SMS)
  const [isBroker, setIsBroker] = useState(false); // a brokerage's staff on panel 1 (batch upload)
  const [editing, setEditing] = useState(false); // «ویرایش مشخصات» open

  useEffect(() => {
    client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', realm).then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {});
    // A brokerage's staff on panel 1 may drop many files at once («بارگذاری گروهی»).
    if (org) { setIsBroker(lastPanel('org') === 'BROKER'); return; }
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    client.get<{ id: string; name: string }[]>('/customer/insurers', 'customer').then((a) => setInsurers(Object.fromEntries(a.map((i) => [i.id, i.name])))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by the document's upload dialog: progress goes both to the dialog/tile ring and to `up`
  // (so «ثبت نهایی» knows an upload is still running); a failure is re-thrown for the dialog to show.
  const upload = async (code: string, file: File, onProgress: OnProgress) => {
    setError('');
    setUp((u) => ({ ...u, [code]: { pct: 0, eta: null } }));
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await client.upload<{ aiQueued?: boolean }>(`${api}/documents?docCode=${encodeURIComponent(code)}`, fd, realm,
        (pct, eta) => { onProgress(pct, eta); setUp((u) => ({ ...u, [code]: { pct, eta } })); });
      if (r?.aiQueued) setAiNote(true);
      setUp((u) => ({ ...u, [code]: { done: true } }));
      await reload();
    } catch (e: any) {
      setUp((u) => ({ ...u, [code]: { error: e.message } }));
      throw e;
    }
  };
  const [heirsMissing, setHeirsMissing] = useState(false);
  const viewDoc = (docId: string) => client.view(`${api}/documents/${docId}/file`, realm).catch((e) => setError(e.message));

  const atMyDesk = claim?.workflow?.currentStage === 'POLICYHOLDER';
  const submitAction = claim?.workflow?.actions.find((a) => a.key === 'SUBMIT');
  const uploading = Object.values(up).some((s) => 'pct' in s);

  /** «ثبت نهایی»: check the documents, send the case on, and show the outcome on its own page. */
  const finalSubmit = async () => {
    if (!checklist || !claim || sending) return;
    const missing = checklist.items.filter((it) => !it.uploaded && it.required).map((it) => it.label);
    const rejected = checklist.items.filter((it) => it.documents[0]?.reviews?.some((r) => r.state === 'REJECTED')).map((it) => it.label);
    const fail = (reason: string, items: string[] = []) => {
      if (org) { setError([reason, ...items].join(' ')); return; } // panel 1: said right here
      try { sessionStorage.setItem(RESULT_KEY(id), JSON.stringify({ ok: false, reason, items })); } catch { /* ignore */ }
      router.push(`/customer/claims/${id}/result`);
    };
    if (uploading) return fail('بارگذاری یک یا چند مدرک هنوز تمام نشده است؛ پس از پایان بارگذاری دوباره «ثبت نهایی» را بزنید.');
    if (heirsMissing) return fail('نام، کد ملی و شماره شبای ذینفعان را بنویسید و «ذخیرهٔ ذینفعان» را بزنید.');
    if (missing.length) return fail('مدارک الزامی زیر هنوز بارگذاری نشده‌اند؛ پس از بارگذاری آن‌ها دوباره «ثبت نهایی» را بزنید:', missing);
    if (rejected.length) return fail('مدارک زیر رد شده‌اند و باید مدرک صحیح جایگزین شود:', rejected);
    if (submitAction?.disabled) return fail(submitAction.disabled);
    setSending(true);
    try {
      await client.post(`${api}/rectify`, {}, realm);
      if (org) { setSentOk(true); await reload(); return; }
      try { sessionStorage.setItem(RESULT_KEY(id), JSON.stringify({ ok: true })); } catch { /* ignore */ }
      router.push(`/customer/claims/${id}/result`);
    } catch (e: any) {
      fail(e.message || 'ثبت مدارک انجام نشد؛ لطفاً دوباره تلاش کنید.');
    } finally { setSending(false); }
  };

  const physicalMoves = (claim?.workflow?.physical?.actions.length ?? 0) > 0;
  const insurerName = org ? claim?.insurer?.name : claim?.insurerTenantId ? insurers[claim.insurerTenantId] : undefined;
  const open = !!claim && !['PAID', 'REJECTED', 'CLOSED'].includes(claim.status);
  /** Where the case is now, in a sentence (the notice under the action tiles). */
  const whereNow = !claim ? '' : atMyDesk
    ? 'مدارک مورد نیاز را بارگذاری کنید و سپس «ثبت نهایی» را بزنید تا پرونده برای رسیدگی ارسال شود.'
    : claim.story?.manual ? `وضعیت پرونده: ${claim.story.caseStage || (STATUS_FA[claim.status] ?? claim.status)}`
    : claim.workflow?.currentStage ? `مدارک ثبت نهایی شده و پرونده نزد «${claim.workflow.currentStageLabel}» است.`
    : `پرونده بسته شده است (${STATUS_FA[claim.status] ?? claim.status}).`;

  return (
    <Shell title="جزئیات پرونده" breadcrumb="جزئیات پرونده" sectionLabel="خسارت عمر و حادثه" nav={org ? ORG_NAV : CUSTOMER_NAV} realm={realm}
      action={claim ? (
        <>
          <Link href={`${page}/workflow`} className="cu-intro-btn text-center">مرحله بعد</Link>
          <Link href={org ? '/org/entry/claims' : '/customer/claims'} className="cu-intro-btn text-center">مرحله قبل</Link>
        </>
      ) : undefined}>
      <div className="cu-home">
        <ErrorBox message={error} />
        <Flash text={sentOk ? 'مدارک ثبت نهایی شد و پرونده برای رسیدگی ارسال شد.' : null} ok />
        {!claim ? <div className="pcard p-10 flex justify-center"><Spinner /></div> : (
          <>
            {/* مشخصات پرونده — laid out like the home's «مشخصات بیمه نامه» */}
            <section className="pcard cu-spec">
              <h2 className="cu-spec-h">
                <span>مشخصات پرونده</span>
                {claim.filingEdit?.editable && !editing && <button type="button" className="btn btn-ghost btn-sm no-print" onClick={() => setEditing(true)}>ویرایش مشخصات</button>}
              </h2>
              <div className="cu-spec-row">
                <div className="cu-select is-static">
                  <span className="cu-select-ico" style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.policy} size={20} /></span>
                  <span>{caseTitle(claim)} | {claimTypeLabel(claim)} | {claim.deceasedName || '—'}</span>
                </div>
                <div className="cu-spec-facts">
                  <span><span style={{ color: 'var(--cu-ink)' }}><BigIcon path={IC.cal} size={18} /></span> تاریخ ثبت: {dateOnly(claim.createdAt) || '—'}</span>
                  <span><i className={`cu-dot${open ? ' is-on' : ''}`} /> وضعیت: {STATUS_FA[claim.status] ?? claim.status}</span>
                </div>
              </div>
              {claim.filingEdit?.editable && !editing && <p className="text-xs" style={{ color: 'var(--muted)' }}>تا پیش از آغاز بررسی پرونده می‌توانید مشخصات آن را اصلاح کنید.</p>}
              {claim.filingEdit && !claim.filingEdit.editable && claim.filingEdit.reason && <p className="text-xs" style={{ color: 'var(--muted)' }}>{claim.filingEdit.reason}</p>}
              {editing && <FilingEditor claim={claim} api={api} realm={realm} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload(); }} />}
            </section>

            {/* Four summary cards, as on the home page */}
            <div className="cu-cards">
              <div className="pcard cu-card">
                <div><div className="cu-card-t">پرونده خسارت</div><div className="cu-card-v latin-digits">{claim.claimNumber}</div>
                  <div className="cu-card-s">{claimTypeLabel(claim)}</div></div>
                <span className="cu-card-ico"><BigIcon path={IC.doc} size={34} /></span>
              </div>
              <div className="pcard cu-card">
                <div><div className="cu-card-t">بیمه‌شده (متوفی)</div><div className="cu-card-v">{claim.deceasedName || '—'}</div>
                  {claim.deceasedNationalCode && <div className="cu-card-s">کد ملی: <bdi className="latin-digits">{claim.deceasedNationalCode}</bdi></div>}
                  <div className="cu-card-s">{claim.claimTypeDeath === false ? 'تاریخ حادثه' : 'تاریخ فوت'}: {claim.eventDate || '—'}</div>
                  {claim.causeOfDeath && <div className="cu-card-s">علت: {claim.causeOfDeath}</div>}</div>
                <span className="cu-card-ico"><BigIcon path={IC.user} size={34} /></span>
              </div>
              <div className="pcard cu-card">
                <div><div className="cu-card-t">بیمه‌گر</div><div className="cu-card-v">{insurerName || '—'}</div>
                  <div className="cu-card-s">بیمه‌نامه: <span className="latin-digits">{claim.policyNumber || '—'}</span></div></div>
                <span className="cu-card-ico"><BigIcon path={IC.policy} size={34} /></span>
              </div>
              <div className="pcard cu-card">
                <div><div className="cu-card-t">وضعیت پرونده</div><div className="cu-card-v">{STATUS_FA[claim.status] ?? claim.status}</div>
                  <div className="cu-card-s">{claim.workflow?.currentStage ? `نزد ${claim.workflow.currentStageLabel}` : claim.paidDate ? `پرداخت: ${claim.paidDate}` : '—'}</div>
                  {checklist && <div className="cu-card-s">مدارک: {checklist.complete ? 'کامل' : 'ناقص'}</div>}</div>
                <span className="cu-card-ico"><BigIcon path={IC.check} size={34} /></span>
              </div>
            </div>
            {claim.coverageStatus && <div className={claim.coverageStatus === 'VALID' ? 'alert-success' : 'alert-error'}>استعلام پوشش: {({ VALID: 'معتبر', INVALID: 'نامعتبر', NOT_FOUND: 'یافت نشد', NOT_CHECKED: 'بررسی‌نشده؛ به‌محض در دسترس بودن سامانهٔ بیمه‌گر خودکار بررسی می‌شود' } as Record<string, string>)[claim.coverageStatus] ?? claim.coverageStatus}</div>}
            {claim.lateNotice && lateWarn && <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر بوده است (مهلت: {claim.noticeDeadline}).</div>}
            {claim.description && (
              <section className="pcard cu-spec">
                <h2 className="cu-spec-h"><span>توضیحات</span></h2>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{claim.description}</p>
              </section>
            )}

            {/* نقص مدارک: what was asked (with its upload slots) and where the case is — «نیازمند اقدام شما» only when it waits here */}
            <DeficiencyBox claimId={id} claim={claim} checklist={checklist} realm={realm} canUpload={claim.workflow?.currentStage === 'POLICYHOLDER'} onChanged={reload} actions={false} />

            {/* The originals were asked for: the move stays right here, not only in «روند پرونده». */}
            {physicalMoves && claim.workflow && (
              <section className="pcard cu-spec"><h2 className="cu-spec-h"><span>اصل مدارک</span></h2><WorkflowPanel claimId={id} workflow={{ ...claim.workflow, actions: claim.workflow.actions.filter((a) => a.key !== 'SUBMIT') }} realm={realm} onDone={reload} /></section>
            )}

            {claim.insuredLinkEnabled && !org && <InsuredAccess claimId={id} />}
            <section className="pcard cu-spec">
              <h2 className="cu-spec-h">
                <span>مدارک مورد نیاز</span>
                {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
              </h2>
              <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>مدارک ستاره‌دار (*) الزامی است؛ بقیه را برحسب مورد بارگذاری کنید.{checklist?.note ? ` ${checklist.note}` : ''}</p>
              <Flash text={aiNote ? AI_QUEUED_FA : null} ok />
              <div className="space-y-2.5">
                {(() => { let n = 0; return checklist?.items.map((it) => {
                  // دارد / ندارد not answered yet: one row asks; the answer decides which document stays.
                  const unchosen = checklist.items.some((x) => x.code === BENEFICIARY_FORM) && checklist.items.some((x) => x.code === INHERITANCE_CERT);
                  const isBeneficiary = it.code === BENEFICIARY_FORM || it.code === INHERITANCE_CERT;
                  if (unchosen && (it.code === INHERITANCE_CERT || it.code === NO_FORM_LETTER)) return null;
                  // The کارگزاری's own panel-1 list: what it doesn't require shows greyed (still uploadable).
                  const greyed = !!checklist.entryList && !it.required && !it.uploaded && !it.accidentOnly;
                  const no = ++n; // number in the list (rows hidden above don't count)
                  const story = docStory(it, !!claim.story?.manual);
                  const st = up[it.code];
                  const d = it.documents[0] as ClaimDoc | undefined;
                  const older = it.documents.slice(1);
                  return (
                    <div key={it.code} className={`doc-row cu-doc tone-${story.tone}${greyed ? ' is-optional' : ''}`}>
                      <div className="cu-doc-head">
                        <div className="text-sm min-w-0">
                          <div className="font-bold"><span className="doc-n">{(no).toLocaleString('fa-IR')}</span>{it.label}{(it.required || it.accidentOnly) && <span style={{ color: 'var(--danger)' }}> *</span>}</div>
                          {it.accidentOnly && <div className="text-xs font-bold" style={{ color: 'var(--danger)' }}>در صورت وقوع سانحه تصادف{it.required ? '' : ' (برای این پرونده الزامی نیست)'}</div>}
                          <div className="cu-story">{story.text}</div>
                        </div>
                        <div className="cu-doc-up">
                          {claim.status !== 'PAID' && !(unchosen && isBeneficiary) && (
                            <DocUploadTile label={it.label} required={!!it.required} {...(it.code === INHERITANCE_CERT ? { addText: 'بارگزاری فرم انحصار وراثت' } : {})} uploaded={it.uploaded} rejected={story.tone === 'bad' || !!it.aiRefused}
                              cameraOnly onUpload={(f, onP) => upload(it.code, f, onP)} />
                          )}
                        </div>
                      </div>
                      {isBeneficiary && <BeneficiaryChoice claimId={id} realm={realm} onChosen={reload} onMissing={setHeirsMissing} />}
                      {st && 'error' in st && <div className="cu-err">بارگذاری انجام نشد: {st.error}</div>}

                      {/* Precise trail of the current file: when it was uploaded, then each desk's decision */}
                      {d && (
                        <div className="cu-trail">
                          <span className="cu-step is-ok"><Icon path={OK} />بارگذاری{d.uploadedAt ? ` — ${d.uploadedAt}` : ''}{d.version > 1 ? ` (نسخهٔ ${d.version.toLocaleString('fa-IR')})` : ''}</span>
                          {(() => { const v = aiVerdict(d.ai); return v && <span className={`cu-step is-${v.tone}`}><Icon path={v.tone === 'ok' ? OK : v.tone === 'no' ? NO : 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 7v5l3 2'} />{v.text}</span>; })()}
                          {(claim.story?.manual ? [] : d.reviews ?? []).map((r) => (
                            <span key={r.stage} className={`cu-step is-${r.state === 'APPROVED' ? 'ok' : r.state === 'REJECTED' ? 'no' : 'wait'}`} title={r.note ? `دلیل: ${r.note}` : undefined}>
                              <Icon path={r.state === 'APPROVED' ? OK : r.state === 'REJECTED' ? NO : 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 7v5l3 2'} />
                              {DESK_FA[r.stage] || r.stage}: {r.state === 'APPROVED' ? 'تایید شد' : r.state === 'REJECTED' ? 'رد شد' : 'در دست بررسی'}{r.changedAt && r.state !== 'PENDING' ? ` — ${r.changedAt}` : ''}
                            </span>
                          ))}
                          <button type="button" className="cu-view" onClick={() => viewDoc(d.id)}><Icon path="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z" /> مشاهدهٔ فایل</button>
                          {d.ai?.status === 'MISMATCH' && <div className="cu-reason">{aiVerdict(d.ai)?.why}</div>}
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
                }); })()}
              </div>
            </section>

            {/* A brokerage's staff (panel 1): drop any number of files at once — they're kept as «سایر مدارک», no matter
                which required item they belong to; each file uploads (or is refused) on its own. */}
            {isBroker && claim.status !== 'PAID' && (
              <section className="pcard cu-spec">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="cu-spec-h flex-1"><span>بارگذاری گروهی مدارک</span></h2>
                  <UploadButton multiple camera cameraOnly accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} className="cu-go"
                    title="بارگذاری گروهی مدارک" subtitle="چند فایل را با هم بکشید یا انتخاب کنید"
                    note="لازم نیست هر فایل با یکی از مدارک مورد نیاز جور باشد؛ همه با عنوان «سایر مدارک» ذخیره می‌شوند و کارگزاری و بیمه‌گر آن‌ها را می‌بینند. فایلی که قالبش مجاز نیست جدا اعلام می‌شود و بقیه بارگذاری می‌شوند."
                    onUpload={async (file, onP) => {
                      const fd = new FormData(); fd.append('file', file);
                      await client.upload(`${api}/documents?docCode=OTHER`, fd, realm, onP);
                      await reload();
                    }}>انتخاب چند فایل</UploadButton>
                </div>
                {(checklist?.otherDocuments ?? []).length === 0
                  ? <p className="text-sm" style={{ color: 'var(--muted)' }}>هنوز فایلی به‌صورت گروهی بارگذاری نشده است.</p>
                  : (
                    <ul className="space-y-1.5">
                      {(checklist?.otherDocuments ?? []).map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate"><bdi>{d.fileName}</bdi>{d.uploadedAt ? <span style={{ color: 'var(--muted)' }}> — {d.uploadedAt}</span> : null}</span>
                          <button type="button" className="cu-view" onClick={() => viewDoc(d.id)}>مشاهده</button>
                        </li>
                      ))}
                    </ul>
                  )}
              </section>
            )}

            {/* Action launcher, like the home page's */}
            <div className="pcard cu-launch">
              <div className="cu-tiles">
                <Diamond href={`${page}/workflow`} title="روند پرونده" sub="مراحل و وضعیت رسیدگی" icon={IC.tray} />
                {atMyDesk && <Diamond onClick={finalSubmit} active={sending} title={sending ? 'در حال ثبت…' : 'ثبت نهایی'} sub="ارسال مدارک برای رسیدگی" icon={IC.check} />}
                <Diamond href={org ? '/org/entry/claims' : '/customer/claims'} title="پیگیری خسارت" sub="بازگشت به فهرست پرونده‌ها" icon={IC.search} />
              </div>
              <div className="cu-notice">{whereNow}</div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
