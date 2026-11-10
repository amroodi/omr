'use client';
import { client, Realm } from '../../lib/client';
import { CaseClaim, Checklist, ChecklistItem } from './case-ui';
import { UploadButton, OnProgress } from './upload';
import { WorkflowPanel } from './WorkflowPanel';

/**
 * «نقص مدارک»: one box, the same in every panel, at the top of the case. It says who returned the case
 * and when, where it is now and whether it waits on the viewer; lists what was asked — each document
 * with its own upload slot right here (also an operator's own line, «نقص دیگر») — and, for the desk
 * holding the case, the buttons that move it on: «رفع نقص در …» or «ارسال به … برای رفع نقص».
 */
export function DeficiencyBox({ claimId, claim, checklist, realm, canUpload, onChanged, actions = true }: {
  claimId: string; claim: CaseClaim; checklist: Checklist | null; realm: Realm; canUpload: boolean; onChanged: () => void; actions?: boolean;
}) {
  const open = (claim.deficiencies ?? []).filter((d) => !d.resolvedAt);
  if (!open.length || claim.status === 'PAID' || claim.status === 'REJECTED') return null;
  const w = claim.workflow;
  const mine = !!w?.holdsDesk && w.direction === 'DOWN';
  const atPolicyholder = w?.currentStage === 'POLICYHOLDER';
  const api = realm === 'customer' ? `/customer/claims/${claimId}` : `/claims/${claimId}`;

  // What to upload: the slots an open return asks for, and documents a desk rejected (to be replaced).
  const items = checklist?.items ?? [];
  const slots = items.filter((it) => it.deficiency?.open);
  const rejected = items.filter((it) => !it.deficiency?.open && it.documents[0]?.reviews?.some((r) => r.state === 'REJECTED'));
  const slotLabels = new Set([...slots, ...rejected].map((s) => s.label));
  // Lines that ask for no upload (reasons, explanations).
  const notes = open.flatMap((d) => d.items).filter((x) => !x.startsWith('مدرک ردشده:') && !x.startsWith('مدرک: ') && !slotLabels.has(x));
  const first = open[0];

  const upload = async (code: string, f: File, onP: OnProgress, extra = false) => {
    const fd = new FormData(); fd.append('file', f);
    await client.upload(`${api}/documents?docCode=${encodeURIComponent(code)}${extra ? '&extra=1' : ''}`, fd, realm, onP);
    onChanged();
  };

  const row = (it: ChecklistItem, kind: 'slot' | 'rejected') => {
    const done = kind === 'slot' ? it.uploaded : false;
    return (
      <li key={it.code} className={`dfx-row${done ? ' is-done' : ''}`}>
        <span className={`dfx-dot${done ? ' is-ok' : ''}`}>{done ? '✓' : '!'}</span>
        <span className="dfx-label">
          {it.label}
          <span className="dfx-sub">{kind === 'rejected' ? 'رد شده — فایل را جایگزین کنید' : done ? 'بارگذاری شد' : it.deficiency?.custom ? 'نقص اعلام‌شده — فایل مربوط را بارگذاری کنید' : 'دوباره بارگذاری شود'}</span>
        </span>
        <span className="dfx-ops">
          {it.documents[0] && realm === 'org' && <button type="button" className="dfx-btn is-ghost" onClick={() => client.view(`/claims/${claimId}/documents/${it.documents[0].id}/file`, 'org')}>مشاهده</button>}
          {canUpload && (
            <UploadButton className="dfx-btn" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title={it.documents[0] ? 'جایگزینی فایل' : 'بارگذاری فایل'} subtitle={it.label} onUpload={(f, onP) => upload(it.code, f, onP)}>
              {it.documents[0] && (done || kind === 'rejected') ? 'جایگزینی فایل' : 'بارگذاری فایل'}
            </UploadButton>
          )}
          {canUpload && done && (
            <UploadButton className="dfx-btn is-ghost" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera multiple title="افزودن صفحه یا مدرک تکمیلی" subtitle={it.label}
              note="هر فایل به‌عنوان صفحهٔ دیگری از همین مدرک ذخیره می‌شود و فایل قبلی سر جایش می‌ماند." onUpload={(f, onP) => upload(it.code, f, onP, true)}>
              + صفحهٔ دیگر
            </UploadButton>
          )}
        </span>
      </li>
    );
  };

  const fixKeys = ['FIX_HERE', 'DOWN_FORWARD', 'DOWN_DIRECT'];
  const moves = w?.actions.filter((a) => fixKeys.includes(a.key)) ?? [];

  return (
    <section className={`dfx${mine || (atPolicyholder && realm !== 'org') ? ' is-mine' : ''}`}>
      <div className="dfx-head">
        <span className="dfx-title">نقص مدارک{mine || (atPolicyholder && realm === 'customer') ? ' — نیازمند اقدام شما' : ''}</span>
        <span className="dfx-meta">
          {first.raisedByLabel ? <>اعلام‌شده توسط <b>{first.raisedByLabel}</b></> : 'اعلام‌شده'}{first.createdAt ? ` — ${first.createdAt}` : ''}
          {w?.currentStageLabel && <> · اکنون نزد <b>{w.currentStageLabel}</b></>}
        </span>
      </div>
      {(slots.length > 0 || rejected.length > 0) && <ul className="dfx-list">{slots.map((s) => row(s, 'slot'))}{rejected.map((s) => row(s, 'rejected'))}</ul>}
      {notes.length > 0 && <ul className="dfx-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <div className="dfx-help">
        {mine && w?.currentStage !== 'POLICYHOLDER'
          ? 'مدارک خواسته‌شده را همین‌جا بارگذاری کنید و «رفع نقص» را بزنید تا پرونده دوباره در مرحلهٔ شما بررسی و به بالا ارسال شود؛ اگر رفع نقص با شما نیست، پرونده را به مرحلهٔ پایین‌تر بفرستید.'
          : atPolicyholder && (realm === 'customer' || mine)
            ? 'مدارک خواسته‌شده را همین‌جا بارگذاری کنید و سپس «ثبت نهایی» / «ارسال» را بزنید.'
            : `پرونده برای رفع نقص نزد «${w?.currentStageLabel ?? '—'}» است؛ پس از رفع نقص دوباره برای بررسی ارسال می‌شود.`}
      </div>
      {actions && realm === 'org' && mine && moves.length > 0 && w && (
        <div className="dfx-actions">
          <WorkflowPanel claimId={claimId} workflow={{ ...w, actions: moves }} realm="org" onDone={onChanged} actionsOnly />
        </div>
      )}
    </section>
  );
}
