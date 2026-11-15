'use client';
import { Icon } from '../components/Shell';
import { blankVal, STATUS_FA } from '../components/case-ui';
import { personTitle } from '../components/claim-wording';
import { DEATH_TYPES, EstelamFrame, EstelamTiles, FrameCtx, fmtAmt, phaseText, phaseTone } from './shared';

const CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z';
const DOC = 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5';
// Sinad's glyphs: person outline, a lined page, a ticked square, a filled speech bubble; filled person / form for the pickers.
const ICO = {
  person: 'M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM3.5 21.5c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z',
  policy: 'M6 2.5h8.5L19.5 7.5V21a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5zM14 2.5V8h5.5M8.5 11.5h8M8.5 14.5h8M8.5 17.5h8',
  check: 'M4 3.5h16a.5.5 0 01.5.5v16a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5zM7.5 12.5l3.2 3.2L17 9',
  chat: 'M12 3C6.8 3 2.5 6.6 2.5 11c0 2.3 1.2 4.4 3.1 5.9L4.6 21l4.3-2.4c1 .3 2 .4 3.1.4 5.2 0 9.5-3.6 9.5-8S17.2 3 12 3z',
  form: 'M8 3h8v3H8zM6 4.5H4.5v17h15v-17H18M8 11h8M8 14.5h8M8 18h5',
  user: 'M12 11.5a4.2 4.2 0 100-8.4 4.2 4.2 0 000 8.4zM4 21c0-4 3.6-7 8-7s8 3 8 7z',
};
const val = (v: any) => (v == null || v === '' || blankVal(v) ? 'ندارد' : v);

/** مشاهده سریع و استعلام پرونده — Sinad's first page: the policy box, four cards, the tiles and the notice. */
export default function EstelamResult() {
  return <EstelamFrame>{(r, _t, ctx) => <Result r={r} ctx={ctx} />}</EstelamFrame>;
}

function Result({ r, ctx }: { r: any; ctx: FrameCtx }) {
  // Panel 3 with no case yet (a کد ملی registered at فن‌آوران, «اعلام خسارت» on): the box and the tiles.
  if (r.selfEntry) return (
    <>
      <div className="sn-box">
        <div className="sn-boxhead"><h3>پنل بیمه‌شده</h3><hr /></div>
        <div className="sn-boxbody"><div>{r.insurerName}</div></div>
      </div>
      <EstelamTiles r={r} />
    </>
  );
  const isDeath = DEATH_TYPES.has(r.claimType);
  const co = r.company?.name || r.companyName;
  const age = r.deceasedAge != null ? `${Number(r.deceasedAge).toLocaleString('fa-IR')} سال` : null;
  const notes = r.caseNotes || phaseText(r);
  // The people among the looked-up cases (a main insured's family), and the current person's own cases.
  const personKey = (c: any) => `${c.name ?? c.deceasedName ?? ''}|${c.relation ?? ''}`;
  const people = [...new Map(ctx.cases.map((c) => [personKey(c), { key: personKey(c), label: [c.name, c.relation].filter(Boolean).join(' — ') }])).values()];
  const cur = ctx.cases.find((c) => c.id === r.id);
  const mine = cur ? ctx.cases.filter((c) => personKey(c) === personKey(cur)) : [];
  return (
    <>
      <div className="sn-box">
        <div className="sn-boxhead"><h3>مشخصات بیمه‌نامه</h3><hr /></div>
        <div className="sn-boxbody">
          {co && <div>{co}</div>}
          <div className="sn-policy">
            <div className="sn-policy-sel">
              <span className="sn-pick-ico"><Icon path={ICO.form} /></span>
              {people.length > 1 ? (
                <div className="sn-pill"><select value={personKey(r)} onChange={(e) => { const c = ctx.cases.find((x) => personKey(x) === e.target.value); if (c) ctx.pick(c.id); }}>
                  {people.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select></div>
              ) : <div className="sn-pill"><span>{[r.policyNumber, r.insurerName, co].filter(Boolean).join(' | ') || '—'}</span></div>}
            </div>
            <div className="sn-status">
              {!(r.imported && (r.status === 'PAID' || r.status === 'REJECTED')) && <div><span className="sn-ic is-green"><Icon path={CAL} /></span>تاریخ ثبت اولیه: <b>{r.createdAt?.split(' ')[0] || '—'}</b></div>}
              <div><span className="sn-ic is-red"><Icon path={CAL} /></span>تاریخ پرداخت: <b>{blankVal(r.paidDate) ? 'ندارد' : r.paidDate}</b></div>
              <div><span className={`sn-dot tone-${phaseTone(r, notes)}`} />وضعیت: <b>{STATUS_FA[r.status] ?? r.status}</b></div>
            </div>
          </div>
          {/* This person's cases, one per نوع بیمه‌نامه (عمر and حوادث are assessed apart): pick the one to follow. */}
          <div className="sn-policy-sel is-kind">
            <span className="sn-pick-ico is-solid"><Icon path={ICO.user} /></span>
            <div className="sn-pill">
              {mine.length > 1 ? (
                <select value={r.id} onChange={(e) => ctx.pick(e.target.value)}>
                  {mine.map((c) => <option key={c.id} value={c.id}>{[c.line, c.claimType].filter(Boolean).join(' — ')}</option>)}
                </select>
              ) : <span>{[r.line, r.claimTypeLabel || mine[0]?.claimType].filter(Boolean).join(' — ') || '—'}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="sn-cards">
        <section className="sn-box sn-card">
          <h4>بیمه شده</h4><span className="sn-card-ico"><Icon path={ICO.person} /></span>
          <b>{r.deceasedName ? personTitle(String(r.deceasedName), { death: isDeath, gender: r.insuredGender }) : '—'}</b>
          <p className="ltr-val">{r.nationalCode || r.nationalCodeMasked || '—'}</p>
          <p>تاریخ تولد: {val(r.birthDate)}</p>
          <p>{isDeath ? 'سن هنگام فوت' : 'سن هنگام حادثه'}: {val(age)}</p>
        </section>
        <section className="sn-box sn-card">
          <h4>بیمه نامه <small>[{STATUS_FA[r.status] ?? r.status}]</small></h4><span className="sn-card-ico"><Icon path={ICO.policy} /></span>
          <p>شماره</p>
          <b>{r.policyNumber || '—'}</b>
          <p>{[r.insurerName, r.line].filter(Boolean).join(' — ') || '—'}</p>
          <p>تاریخ شروع: {val(r.policyStartDate)}</p>
        </section>
        <section className="sn-box sn-card">
          <h4>مبلغ قابل پرداخت</h4><span className="sn-card-ico"><Icon path={ICO.check} /></span>
          <b>{fmtAmt(r.payableAmount)?.replace(' ریال', '') ?? 'ندارد'}</b>
          <p>ریال</p>
          {/^حوادث/.test(r.line ?? '') ? <p>سرمایه حادثه: {fmtAmt(r.accidentCapital) ?? 'ندارد'}</p> : <p>سرمایه فوت: {fmtAmt(r.deathCapital) ?? 'ندارد'}</p>}
          {mine.length > 1 && <p>جمع پرونده‌های این شخص: <b>{fmtAmt(String(mine.reduce((t, c) => t + Number(c.payable || 0), 0))) ?? 'ندارد'}</b></p>}
        </section>
        <section className="sn-box sn-card">
          <h4>{isDeath ? 'اطلاعات فوت' : 'اطلاعات حادثه'}</h4><span className="sn-card-ico is-fill"><Icon path={ICO.chat} /></span>
          <b>{val(r.causeOfDeath)}</b>
          <p>{isDeath ? 'تاریخ فوت' : 'تاریخ حادثه'}: {val(r.eventDate)}</p>
          <p>ذینفع: {val(r.beneficiaries?.type)}</p>
          <p>مرحلهٔ فعلی: {val(r.currentStageLabel)}</p>
        </section>
      </div>

      <EstelamTiles r={r} />
      <div className="sn-box sn-notice"><div className={`sn-banner tone-${phaseTone(r, notes)}`}>{notes}</div></div>
    </>
  );
}
