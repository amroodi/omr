'use client';
import { Icon } from '../components/Shell';
import { blankVal, STATUS_FA } from '../components/case-ui';
import { personTitle } from '../components/claim-wording';
import { DEATH_TYPES, EstelamFrame, EstelamTiles, FrameCtx, fmtAmt, phaseText, phaseTone } from './shared';

const CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z';
const DOC = 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5';
const ICO = {
  person: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  policy: DOC,
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  chat: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
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
  const caseLine = (c: any) => [c.name, c.relation, c.line, c.claimType, c.eventDate].filter(Boolean).join(' | ');
  return (
    <>
      <div className="sn-box">
        <div className="sn-boxhead"><h3>مشخصات بیمه‌نامه</h3><hr /></div>
        <div className="sn-boxbody">
          {co && <div>{co}</div>}
          <div className="sn-policy">
            <div className="sn-policy-sel">
              <Icon path={DOC} />
              {ctx.cases.length > 1 ? (
                <select value={r.id} onChange={(e) => ctx.pick(e.target.value)}>
                  {ctx.cases.map((c) => <option key={c.id} value={c.id}>{caseLine(c)}</option>)}
                </select>
              ) : <span className="sn-sel">{[r.policyNumber, r.insurerName, r.line].filter(Boolean).join(' | ') || '—'}</span>}
            </div>
            <div className="sn-status">
              {!(r.imported && (r.status === 'PAID' || r.status === 'REJECTED')) && <div><span className="sn-ic is-green"><Icon path={CAL} /></span>تاریخ ثبت اولیه: <b>{r.createdAt?.split(' ')[0] || '—'}</b></div>}
              <div><span className="sn-ic is-red"><Icon path={CAL} /></span>تاریخ پرداخت: <b>{blankVal(r.paidDate) ? 'ندارد' : r.paidDate}</b></div>
              <div><span className={`sn-dot tone-${phaseTone(r, notes)}`} />وضعیت: <b>{STATUS_FA[r.status] ?? r.status}</b></div>
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
          <p>سرمایه فوت: {fmtAmt(r.deathCapital) ?? 'ندارد'}</p>
          <p>سرمایه حادثه: {fmtAmt(r.accidentCapital) ?? 'ندارد'}</p>
        </section>
        <section className="sn-box sn-card">
          <h4>{isDeath ? 'اطلاعات فوت' : 'اطلاعات حادثه'}</h4><span className="sn-card-ico"><Icon path={ICO.chat} /></span>
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
