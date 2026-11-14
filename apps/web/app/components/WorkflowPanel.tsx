'use client';
import { useEffect, useState } from 'react';
import { toGregorian } from 'jalaali-js';
import { client } from '../../lib/client';
import { JalaliDatePicker } from './JalaliDatePicker';
import { Overlay } from './ui';
import { UploadButton } from './upload';
import { Flash } from './Toaster';

/** Shape of `workflow` on GET /claims/:id (see apps/api/src/modules/claims/workflow.ts). */
export interface WorkflowAction {
  key: string; label: string; tone: 'primary' | 'warning' | 'danger' | 'ghost';
  disabled?: string; adminOnly?: boolean; needsDeficiencies?: boolean; needsNote?: boolean; confirm?: boolean;
  branchOptions?: { id: string; name: string; code: string }[]; selectedBranchId?: string | null;
}
export interface Workflow {
  chain: { stage: string; label: string }[];
  currentStage: string | null; currentStageLabel: string | null;
  direction: 'UP' | 'DOWN' | null; purpose: 'REVIEW' | 'DEFICIENCY' | 'PAYMENT' | null;
  returnTargetStage: string | null; returnTargetLabel: string | null;
  myStage: string | null; holdsDesk: boolean;
  lossNotice: { number: string | null; date: string | null; at?: string | null } | null; canRecordLossNotice: boolean;
  chargoon?: boolean; // the viewer's organization uses چارگون: letters ask «شماره چارگون»
  lossNoticeAsksNumber?: boolean; // false: شعبه records اعلام خسارت with one click (no number / date)
  actions: WorkflowAction[];
  physical?: PhysicalView;
}

/** Where the original documents are, the open request (if any), its history, and this user's moves. */
export interface PhysicalView {
  at: string; atLabel: string; collected: boolean;
  open: { requesterStage: string; holderStage: string; status: 'REQUESTED' | 'SENT'; requesterLabel: string; holderLabel: string } | null;
  actions: { key: string; label: string; seat: string }[];
  events: { id: string; stageLabel: string; action: string; note: string | null; trackingNo: string | null; at: string; by: string | null; letters: TimelineStep['letters'] }[];
}

const PHYSICAL_EVENT_FA: Record<string, string> = { REQUEST: 'درخواست اصل مدارک', RELAY: 'ارسال درخواست به سطح پایین‌تر', SEND: 'ارسال اصل مدارک', RECEIVE: 'تایید دریافت اصل مدارک', RETURN: 'بازگرداندن اصل مدارک به شعبه' };

const TONE: Record<string, string> = { primary: 'btn btn-solid btn-sm', warning: 'btn btn-ghost btn-sm', danger: 'btn btn-ghost btn-sm', ghost: 'btn btn-ghost btn-sm' };
const TONE_COLOR: Record<string, string | undefined> = { warning: 'var(--warning)', danger: 'var(--danger)' };

function jalaliToIso(v: string): string | undefined {
  const p = v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((x) => !x)) return undefined;
  const g = toGregorian(p[0], p[1], p[2]);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).toISOString();
}

function phase(w: Workflow): string {
  if (!w.currentStage) return 'پرونده بسته شده است';
  if (w.purpose === 'PAYMENT') return 'دستور پرداخت صادر شده — در مسیر پرداخت';
  if (w.direction === 'DOWN') return 'عودت‌شده برای رفع نقص — در مسیر بازگشت';
  if (w.currentStage === 'POLICYHOLDER') return 'در انتظار تکمیل و ارسال مدارک';
  return 'در حال بررسی';
}

// The yes / no question of a confirm-first action — each says what «بله» actually does.
const CONFIRM_DEFAULT = { q: 'آیا از انجام این اقدام مطمئن هستید؟', yes: 'بله، انجام شود' };
function confirmText(key: string): { q: string; yes: string } {
  if (key === 'MARK_PAID') return { q: 'آیا مطمئن هستید که پرداخت این پرونده به ذینفع ثبت شود؟ پس از ثبت، مجوز سرپرستی باطل می‌شود و این کار برگشت‌پذیر نیست.', yes: 'بله، پرداخت ثبت شود' };
  if (key === 'APPROVE_AMOUNT') return { q: 'آیا مبلغ خسارت پیشنهادی شعبه تایید شود؟', yes: 'بله، تایید شود' };
  if (key === 'RETURN_DIRECT') return { q: 'آیا مطمئن هستید که این پرونده را به بیمه‌گزار برمی‌گردانید؟', yes: 'بله، برگشت داده شود' };
  return CONFIRM_DEFAULT;
}

/**
 * The claim's position in the chain (بیمه‌گزار → کارگزاری → شعبه → ستاد → شورای فنی), the اعلام خسارت
 * record, and the actions the server offers this user. Every action can carry a note and — for
 * organizations — a letter (number/date/subject + optional scan).
 */
export function WorkflowPanel({ claimId, workflow: w, realm, onDone, compact, actionsOnly, physicalOnly }: {
  claimId: string; workflow: Workflow; realm: 'org' | 'customer'; onDone: () => void; compact?: boolean;
  /** Just the action buttons (the «نقص مدارک» box shows the rest itself). */
  actionsOnly?: boolean;
  /** Just the «اصل مدارک» box (send / receive the originals) — e.g. on شعبه's ارزیابی. */
  physicalOnly?: boolean;
}) {
  const [open, setOpen] = useState<(WorkflowAction & { physical?: boolean }) | null>(null);
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [defs, setDefs] = useState(''); // «نقص دیگر»: each line becomes an upload slot of its own
  const [defNotes, setDefNotes] = useState(''); // reasons that ask for no upload
  const [defDocs, setDefDocs] = useState<string[]>([]); // documents of the case's list asked for again
  const [docList, setDocList] = useState<{ code: string; label: string; uploaded: boolean }[] | null>(null);
  // The return dialog lists the case's documents to pick from.
  useEffect(() => {
    if (!open?.needsDeficiencies || docList || realm !== 'org') return;
    client.get<{ items: { code: string; label: string; uploaded: boolean; deficiency?: { custom?: boolean } }[] }>(`/claims/${claimId}/checklist`, 'org')
      .then((c) => setDocList(c.items.filter((i) => !i.deficiency?.custom).map((i) => ({ code: i.code, label: i.label, uploaded: i.uploaded }))))
      .catch(() => setDocList([]));
  }, [open, docList, claimId, realm]);
  const [branchId, setBranchId] = useState('');
  const [letter, setLetter] = useState({ number: '', date: '', subject: '', chargoonNo: '' });
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [ln, setLn] = useState({ number: '', date: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(false); // «آیا مطمئن هستید؟» step of a confirm-first action
  const ask = open ? confirmText(open.key) : CONFIRM_DEFAULT;
  const base = realm === 'customer' ? '/customer/claims' : '/claims';
  const cur = w.chain.findIndex((c) => c.stage === w.currentStage);
  const asksNumber = w.lossNoticeAsksNumber !== false;

  const start = (a: WorkflowAction & { physical?: boolean }) => {
    setErr(''); setNote(''); setDefs(''); setDefNotes(''); setDefDocs([]); setTracking(''); setSure(false); setLetter({ number: '', date: '', subject: '', chargoonNo: '' }); setLetterFile(null);
    setBranchId(a.selectedBranchId || (a.branchOptions?.length === 1 ? a.branchOptions[0].id : ''));
    setOpen(a);
  };

  const submit = async () => {
    if (!open) return;
    if (open.confirm && !sure) { setSure(true); return; } // ask yes / no first
    setErr(''); setBusy(true);
    try {
      if (realm === 'customer') {
        if (open.physical) await client.post(`${base}/${claimId}/physical`, { action: open.key, note: note || undefined, trackingNo: tracking || undefined }, 'customer');
        else await client.post(`${base}/${claimId}/rectify`, { note: note || undefined }, 'customer');
      } else {
        let letterId: string | undefined;
        if (letter.number.trim() || letter.chargoonNo.trim() || letterFile) {
          const fd = new FormData();
          if (letter.number.trim()) fd.append('number', letter.number.trim());
          if (letter.chargoonNo.trim()) fd.append('chargoonNo', letter.chargoonNo.trim());
          const iso = letter.date ? jalaliToIso(letter.date) : undefined;
          if (iso) fd.append('date', iso);
          if (letter.subject.trim()) fd.append('subject', letter.subject.trim());
          if (letterFile) fd.append('file', letterFile);
          letterId = (await client.postForm<{ id: string }>(`/claims/${claimId}/letters`, fd, 'org')).id;
        }
        const deficiencies = defs.split('\n').map((s) => s.trim()).filter(Boolean);
        const deficiencyNotes = defNotes.split('\n').map((s) => s.trim()).filter(Boolean);
        if (open.physical) await client.post(`/claims/${claimId}/physical`, { action: open.key, note: note || undefined, trackingNo: tracking || undefined, letterId }, 'org');
        else await client.post(`/claims/${claimId}/action`, {
          action: open.key, note: note || undefined, letterId,
          deficiencies: deficiencies.length ? deficiencies : undefined,
          deficiencyNotes: deficiencyNotes.length ? deficiencyNotes : undefined,
          deficiencyDocs: defDocs.length ? defDocs : undefined,
          branchId: branchId || undefined,
        }, 'org');
      }
      setOpen(null); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const saveLossNotice = async () => {
    setErr(''); setBusy(true);
    try {
      await client.put(`/claims/${claimId}/loss-notice`, asksNumber ? { number: ln.number, date: ln.date ? jalaliToIso(ln.date) : undefined } : {}, 'org');
      onDone();
    }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {!actionsOnly && <>
      {!physicalOnly && <>
      {/* Chain */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        {w.chain.map((c, i) => {
          const here = c.stage === w.currentStage;
          const passed = cur >= 0 && i < cur && w.direction === 'UP';
          return (
            <span key={c.stage} className="flex items-center gap-1">
              <span className="rounded-full px-2.5 py-1 font-bold whitespace-nowrap"
                style={{ background: here ? 'var(--brand)' : passed ? 'var(--brand-soft)' : 'var(--surface-2)', color: here ? '#fff' : passed ? 'var(--brand-700)' : 'var(--muted)' }}>
                {c.label}{c.stage === w.myStage && realm === 'org' ? ' (شما)' : ''}
              </span>
              {i < w.chain.length - 1 && <span style={{ color: 'var(--muted)' }}>{w.direction === 'DOWN' && cur > i ? '‹' : '›'}</span>}
            </span>
          );
        })}
      </div>
      <div className="text-sm">
        <span style={{ color: 'var(--muted)' }}>وضعیت: </span><span className="font-semibold">{phase(w)}</span>
        {w.currentStageLabel && <><span style={{ color: 'var(--muted)' }}> — در اختیار: </span><span className="font-semibold" style={{ color: 'var(--brand)' }}>{w.currentStageLabel}</span></>}
      </div>
      {w.returnTargetLabel && w.currentStage && (
        <div className="text-xs rounded-lg p-2" style={{ background: 'var(--brand-soft)' }}>
          این پرونده توسط «{w.returnTargetLabel}» عودت شده است؛ پس از رفع نقص، مدارک اصلاح‌شده دوباره مرحله‌به‌مرحله تا «{w.returnTargetLabel}» بررسی می‌شوند.
        </div>
      )}

      </>}
      {/* «اعلام خسارت» has no button for now: it is a document the بیمه‌گزار uploads. */}
      {/* Original documents (side track) */}
      {w.physical && (w.physical.collected || w.physical.open || w.physical.actions.length > 0 || w.physical.events.length > 0) && (
        <div className="rounded-lg p-2.5 text-sm space-y-1.5" style={{ background: 'var(--surface-2)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold">اصل مدارک (فیزیکی)</span>
            <span className="text-xs">محل نگهداری: <b style={{ color: 'var(--brand)' }}>{w.physical.atLabel}</b></span>
          </div>
          {w.physical.open && (
            <div className="text-xs">
              {w.physical.open.status === 'REQUESTED'
                ? <>درخواست «{w.physical.open.requesterLabel}» — در دست بررسی «{w.physical.open.holderLabel}»</>
                : <>اصل مدارک برای «{w.physical.open.requesterLabel}» ارسال شده — در دست بررسی دریافت</>}
            </div>
          )}
          {w.physical.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {w.physical.actions.map((a) => (
                <button key={a.key + a.seat} onClick={() => start({ key: a.key, label: a.label, tone: 'primary', physical: true })} disabled={busy} className="btn btn-solid btn-sm">{a.label}</button>
              ))}
            </div>
          )}
          {w.physical.events.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer" style={{ color: 'var(--muted)' }}>سوابق جابه‌جایی اصل مدارک ({w.physical.events.length.toLocaleString('fa-IR')})</summary>
              <ul className="mt-1.5 space-y-1">
                {w.physical.events.map((e) => (
                  <li key={e.id}>
                    <b>{e.stageLabel}</b>: {PHYSICAL_EVENT_FA[e.action] || e.action}
                    <span style={{ color: 'var(--muted)' }}> — {e.at}{e.by ? ` — ${e.by}` : ''}</span>
                    {e.trackingNo && <span> — کد رهگیری: {e.trackingNo}</span>}
                    {e.note && <div>«{e.note}»</div>}
                    {(e.letters || []).map((l) => (
                      <div key={l.id} style={{ color: 'var(--muted)' }}>نامه {l.number ? `شمارهٔ ${l.number}` : ''}{l.chargoonNo ? ` — چارگون ${l.chargoonNo}` : ''}{l.date ? ` — ${l.date}` : ''}
                        {l.hasFile && realm === 'org' && <button className="btn btn-ghost btn-sm" onClick={() => client.view(`/claims/${claimId}/letters/${l.id}/file`, 'org')}>مشاهده</button>}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      </>}

      {/* Actions */}
      {physicalOnly ? null : w.actions.length > 0 ? (
        <div className="space-y-1.5">
          <div className={`flex flex-wrap gap-2 ${compact ? '' : 'items-center'}`}>
            {w.actions.map((a) => (
              <button key={a.key} onClick={() => start(a)} disabled={busy || !!a.disabled} title={a.disabled || a.label}
                className={TONE[a.tone]} style={TONE_COLOR[a.tone] ? { color: TONE_COLOR[a.tone] } : undefined}>
                {a.label}{a.adminOnly && !a.confirm ? ' ★' : ''}
              </button>
            ))}
          </div>
          {w.actions.filter((a) => a.disabled).map((a) => (
            <div key={a.key} className="text-xs" style={{ color: 'var(--muted)' }}>• {a.label}: {a.disabled}</div>
          ))}
        </div>
      ) : w.currentStage && !actionsOnly ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>پرونده در حال حاضر نزد «{w.currentStageLabel}» است؛ اقدامی برای شما در این مرحله نیست.</div>
      ) : null}
      <Flash text={err && !open ? err : null} ok={false} />

      {open && (
        <Overlay onClose={() => !busy && setOpen(null)}>
          <div className="pmodal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">{open.label}</span>
              <button className="pmodal-x" onClick={() => setOpen(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3 text-sm">
              {open.adminOnly && <div className="text-xs rounded-lg p-2" style={{ background: 'var(--brand-soft)' }}>★ این اقدام از اختیارات مدیریت است و مراحل میانی را رد می‌کند؛ در سوابق پرونده ثبت می‌شود.</div>}
              {open.branchOptions && (
                <div>
                  <label className="label">شعبهٔ رسیدگی‌کننده</label>
                  <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— انتخاب شعبه —</option>
                    {open.branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                </div>
              )}
              {open.needsDeficiencies && (
                <div className="space-y-2">
                  <div className="text-xs rounded-lg p-2" style={{ background: 'var(--brand-soft)' }}>مدارکی که در این مرحله ✕ (رد) زده‌اید خودکار جزو نقص می‌آیند. برای هر مدرکی که در زیر انتخاب یا نوشته شود، گیرنده یک جای بارگذاری می‌بیند و تا بارگذاری نکند پرونده جلو نمی‌رود.</div>
                  {realm === 'org' && (
                    <div>
                      <label className="label">مدارکی که باید دوباره یا تازه بارگذاری شوند</label>
                      <div className="rounded-lg p-2 space-y-1 overflow-y-auto" style={{ maxHeight: 190, border: '1px solid var(--border)' }}>
                        {docList === null ? <div className="text-xs" style={{ color: 'var(--muted)' }}>در حال دریافت فهرست مدارک…</div>
                          : docList.length === 0 ? <div className="text-xs" style={{ color: 'var(--muted)' }}>مدرکی در فهرست این پرونده نیست.</div>
                          : docList.map((d) => (
                            <label key={d.code} className="flex items-start gap-2 text-xs cursor-pointer">
                              <input type="checkbox" className="mt-0.5" checked={defDocs.includes(d.code)} onChange={(e) => setDefDocs((cur) => (e.target.checked ? [...cur, d.code] : cur.filter((x) => x !== d.code)))} />
                              <span>{d.label}{!d.uploaded && <span style={{ color: 'var(--muted)' }}> (بارگذاری نشده)</span>}</span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="label">مدرک دیگری که در فهرست نیست (هر مدرک در یک خط)</label>
                    <textarea className="input" rows={2} value={defs} onChange={(e) => setDefs(e.target.value)} placeholder="مثلاً: گواهی پزشک قانونی" />
                  </div>
                  <div>
                    <label className="label">توضیح نقص بدون نیاز به بارگذاری (هر مورد در یک خط)</label>
                    <textarea className="input" rows={2} value={defNotes} onChange={(e) => setDefNotes(e.target.value)} placeholder="مثلاً: مبلغ برآوردی با مدارک هم‌خوانی ندارد" />
                  </div>
                </div>
              )}
              {open.physical && (open.key === 'PHYSICAL_SEND' || open.key === 'PHYSICAL_RETURN') && (
                <div>
                  <label className="label">کد رهگیری پست / پیک (اختیاری)</label>
                  <input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} />
                </div>
              )}
              <div>
                <label className="label">توضیحات{open.needsNote ? ' (الزامی)' : ' (اختیاری)'}</label>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {realm === 'org' && (
                <details className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }} open={!!letter.number || !!letter.chargoonNo}>
                  <summary className="cursor-pointer font-semibold">پیوست نامه (مکاتبه) — اختیاری</summary>
                  <div className="grid sm:grid-cols-2 gap-2 mt-2">
                    <input className="input" placeholder="شمارهٔ نامه" value={letter.number} onChange={(e) => setLetter({ ...letter, number: e.target.value })} />
                    {w.chargoon && <input className="input" placeholder="شماره چارگون" value={letter.chargoonNo} onChange={(e) => setLetter({ ...letter, chargoonNo: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} />}
                    <JalaliDatePicker value={letter.date} onChange={(v) => setLetter({ ...letter, date: v })} placeholder="تاریخ نامه" />
                    <input className="input sm:col-span-2" placeholder="موضوع" value={letter.subject} onChange={(e) => setLetter({ ...letter, subject: e.target.value })} />
                    <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
                      <UploadButton accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} title="فایل نامه" camera
                        note="فایل همراه با «تایید و ارسال» بارگذاری می‌شود." onUpload={(f) => setLetterFile(f)}>{letterFile ? 'تغییر فایل نامه' : 'پیوست فایل نامه'}</UploadButton>
                      {letterFile && <span className="text-xs truncate"><bdi>{letterFile.name}</bdi> <button type="button" className="underline" style={{ color: 'var(--danger)' }} onClick={() => setLetterFile(null)}>حذف</button></span>}
                    </div>
                  </div>
                </details>
              )}
              <Flash text={err} ok={false} />
              {sure && (
                <div className="rounded-lg p-3 font-bold" style={{ background: 'var(--surface-2)', color: 'var(--danger)' }} role="alert">
                  {ask.q}
                </div>
              )}
            </div>
            {sure ? (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setSure(false)} disabled={busy} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>خیر</button>
                <button onClick={submit} disabled={busy} className="flex-1 py-3 font-bold" style={{ color: 'var(--danger)' }}>{busy ? 'در حال ارسال…' : ask.yes}</button>
              </div>
            ) : (
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setOpen(null)} disabled={busy} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
                <button onClick={submit} disabled={busy || (!!open.branchOptions && !branchId) || (!!open.needsNote && !note.trim())} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>{busy ? 'در حال ارسال…' : 'تایید و ارسال'}</button>
              </div>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}

export const ACTION_FA: Record<string, string> = {
  LOSS_NOTICE: 'ثبت اعلام خسارت',
  SUBMIT: 'ارسال', FORWARD: 'تایید و ارسال', REFER_COUNCIL: 'ارجاع به شورای فنی', PAY_ORDER: 'دستور پرداخت',
  RETURN: 'عودت برای رفع نقص', RETURN_DIRECT: 'برگشت از سرپرستی به بیمه‌گزار', DOWN_FORWARD: 'ارسال به سطح پایین‌تر', FIX_HERE: 'رفع نقص و ادامهٔ بررسی',
  DOWN_DIRECT: 'ارسال مستقیم به بیمه‌گزار (اختیار مدیریت)', MARK_PAID: 'ثبت پرداخت', REJECT_FINAL: 'رد نهایی',
};
/** Older steps (before workflow v2) carry only a state, no action. */
export const STATE_FA: Record<string, string> = {
  PENDING: 'در دست بررسی', FORWARDED: 'تایید و ارسال', ESCALATED: 'ارجاع به سطح بالاتر', APPROVED: 'تایید شد',
  RETURNED_INCOMPLETE: 'عودت برای رفع نقص', REJECTED: 'رد شد', ACKED: 'دریافت و ارسال',
};

export interface TimelineStep {
  order: number; stage?: string | null; stageLabel?: string | null; direction?: string; purpose?: string | null;
  state: string; action?: string | null; note?: string | null; decidedAt?: string | null; decidedByName?: string | null;
  holderName?: string | null; branchName?: string | null;
  letters?: { id: string; number: string | null; chargoonNo?: string | null; subject: string | null; date: string | null; hasFile: boolean; fileName: string | null }[];
}

/** The case's «ثبت اعلام خسارت» (from the API), placed among its hand-offs. */
export interface LossNoticeEntry { stageLabel: string; at: string; number: string | null; afterOrder: number }
/** The hand-offs with «ثبت اعلام خسارت» as one more (done) row, right after the step decided before it. */
export function withLossNotice(steps: TimelineStep[] | undefined, ln?: LossNoticeEntry | null): TimelineStep[] {
  const list = steps ?? [];
  if (!ln) return list;
  const row: TimelineStep = { order: ln.afterOrder + 0.5, stageLabel: ln.stageLabel, state: 'DONE', action: 'LOSS_NOTICE', decidedAt: ln.at, note: ln.number ? `شماره ${ln.number}` : null };
  const i = list.findIndex((s) => s.order > ln.afterOrder);
  return i < 0 ? [...list, row] : [...list.slice(0, i), row, ...list.slice(i)];
}

/** Every hand-off of the claim, oldest first: desk, what was done, by whom, note and letters. */
export function WorkflowTimeline({ claimId, steps, realm }: { claimId: string; steps?: TimelineStep[]; realm: 'org' | 'customer' }) {
  return (
    <div className="space-y-3">
      {(steps || []).map((s) => {
        const pending = s.state === 'PENDING';
        const color = pending ? 'var(--brand)' : s.action === 'RETURN' || s.action === 'RETURN_DIRECT' ? 'var(--warning)' : s.state === 'REJECTED' ? 'var(--danger)' : 'var(--success)';
        return (
          <div key={s.order} className="flex gap-2.5 text-sm">
            <span className="flex items-center justify-center rounded-full shrink-0 mt-0.5" style={{ width: 24, height: 24, background: color, color: '#fff', fontSize: 11 }}>{s.order}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold">{s.stageLabel || s.holderName || '—'}{s.branchName ? ` — ${s.branchName}` : ''}</span>
                <span className="badge" style={{ background: 'var(--surface-2)', color }}>
                  {pending ? (s.direction === 'DOWN' ? (s.purpose === 'PAYMENT' ? 'در دست بررسی (دستور پرداخت)' : 'در دست بررسی (عودت)') : 'در دست بررسی') : (ACTION_FA[s.action || ''] || STATE_FA[s.state] || s.state)}
                </span>
              </div>
              {/* Operator names stay inside the organizations; outside parties see the desk and time only. */}
              {(s.decidedAt || (realm === 'org' && s.decidedByName)) && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{realm === 'org' && s.decidedByName ? `اقدام‌کننده: ${s.decidedByName} — ` : ''}{s.decidedAt ?? ''}</div>}
              {s.note && <div className="text-xs mt-0.5">«{s.note}»</div>}
              {(s.letters || []).map((l) => (
                <div key={l.id} className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                  <span>نامه {l.number ? `شمارهٔ ${l.number}` : ''}{l.chargoonNo ? ` — چارگون ${l.chargoonNo}` : ''}{l.date ? ` — ${l.date}` : ''}{l.subject ? ` — ${l.subject}` : ''}</span>
                  {l.hasFile && realm === 'org' && <button className="btn btn-ghost btn-sm" onClick={() => client.view(`/claims/${claimId}/letters/${l.id}/file`, 'org')}>مشاهده</button>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
