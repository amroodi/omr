'use client';
import { B, Band, Box, Lines, Paper, PaperFields, Sign, Values } from './Paper';

export type ConcessionSection = 'BRANCH' | 'HQ' | 'COUNCIL';
type Signs = Partial<Record<ConcessionSection, { name: string; at: string }>>;

const PREFIX: Record<ConcessionSection, string[]> = { BRANCH: ['b_'], HQ: ['h_'], COUNCIL: ['c_', 'm_'] };
const COSTS = ['فوت به هر علت', 'فوت ناشی از حوادث', 'نقص عضو ناشی از حوادث', 'از کارافتادگی ناشی از بیماری', 'هزینه پزشکی ناشی از حوادث', 'غرامت روزانه عمومی', 'غرامت روزانه بیمارستانی'];

/**
 * «فرم گزارش خسارت ارفاقی (عمر و حوادث گروهی – انفرادی)», as the printed sheet. `section` is the part the
 * caller fills now (شعبه: everything down to «شعبه / مجتمع»; ستاد: «مدیریت بیمه های اشخاص»; شورای فنی: its own
 * and the «مدیر عامل / هیئت مدیره» part); every other part shows what was registered.
 */
export function ConcessionPaper({ values, onChange, section, signs }: { values: Values; onChange?: (v: Values) => void; section: ConcessionSection | null; signs: Signs }) {
  const can = (k: string) => !!section && PREFIX[section].some((p) => k.startsWith(p));
  const on = (s: ConcessionSection) => section === s && !!onChange;
  return (
    <Paper title="فرم گزارش خسارت ارفاقی" sub="( عمرو حوادث گروهی – انفرادی )" formNo="۱/۱۴۰۴/۲۱۱۸/۰۰">
      <PaperFields values={values} onChange={onChange} can={can}>
        <div className={`paper-head${on('BRANCH') ? ' is-active' : ''}`}>
          <span><b>شماره پرونده خسارت:</b> <B k="b_claimNo" w={20} ltr /></span>
          <span><b>شماره بیمه نامه:</b> <B k="b_policyNo" w={16} ltr /></span>
        </div>
        <Band side="مشخصات بیمه گذار و بیمه شده" active={on('BRANCH')}>
          <div className="paper-grid2">
            <div className="paper-row">نوع بیمه گذار : <Box k="b_phType" opt="حقیقی" label="حقیقی" /> <Box k="b_phType" opt="حقوقی" label="حقوقی" /></div>
            <div>نام و کد واحد صدور بیمه نامه : <B k="b_unit" w={20} /></div>
            <div>نام و کد بیمه گذار : <B k="b_phName" w={26} /></div>
            <div className="paper-row">سنوات قرارداد همکاری : <B k="b_years" w={4} /> سال <Box k="b_over5" label="بیش از ۵ سال" /></div>
            <div>تاریخ شروع بیمه نامه : <B k="b_start" w={11} ph="۱۴۰۵/۰۱/۰۱" /></div>
            <div>تاریخ انقضاء بیمه نامه : <B k="b_end" w={11} ph="۱۴۰۵/۱۲/۲۹" /></div>
            <div>نام بیمه شده : <B k="b_insured" w={24} /></div>
            <div>کد ملی بیمه شده : <B k="b_nid" w={15} ltr /></div>
          </div>
        </Band>
        <Band side="سوابق خسارت ارفاقی" active={on('BRANCH')}>
          {[['b_h1', 'مجموع خسارت ارفاقی پرداخت شده در طول سنوات همکاری بیمه گذار'], ['b_h2', 'مجموع خسارت ارفاقی پرداخت شده در بیمه نامه جاری بیمه گذار'], ['b_h3', 'مجموع خسارت ارفاقی پرداخت شده برای بیمه شده در بیمه نامه جاری']].map(([k, l]) => (
            <div key={k} className="paper-line3"><span>{l} :</span><span>تعداد : <B k={`${k}n`} w={5} amount /></span><span>مبلغ (ریال) : <B k={`${k}a`} w={16} amount /></span></div>
          ))}
        </Band>
        <Band side="مشخصات هزینه درخواست ارفاقی" active={on('BRANCH')}>
          <div className="paper-row paper-wrap">نوع هزینه خسارت : {COSTS.map((c) => <Box key={c} k="b_costType" opt={c} multi label={c} />)}</div>
          <div className="paper-grid2">
            <div>علت درخواست ارفاقی : <B k="b_reason" w={30} /></div>
            <div>مبلغ ارفاقی درخواستی : <B k="b_amount" w={18} amount /> ریال</div>
          </div>
          <div className="paper-p">توضیحات کارشناس خسارت :</div>
          <Lines k="b_notes" rows={3} />
          <Sign label="نام و امضاء کارشناس خسارت" sign={signs.BRANCH} />
        </Band>
        <Band side="آمار عملکرد کلی بیمه گذار" active={on('BRANCH')}>
          <div className="paper-line3"><span>حق بیمه صادره : <B k="b_premium" w={16} amount /></span><span>خسارت پرداختی : <B k="b_paid" w={16} amount /></span><span>خسارت معوق : <B k="b_pending" w={16} amount /></span></div>
          <div className="paper-grid2"><div>نسبت خسارت کل بیمه گذار : <B k="b_ratioAll" w={8} /></div><div>نسبت خسارت عمروحوادث : <B k="b_ratioLife" w={8} /></div></div>
          <div>کل مانده بدهی حق بیمه عمروحوادث : <B k="b_debt" w={18} amount /> ریال</div>
        </Band>
        <Band side="شعبه / مجتمع" active={on('BRANCH')}>
          <div className="paper-row">تعداد و مبلغ ارفاقی طبق آئین نامه ،در حدود اختیارات شعبه / مجتمع می باشد؟ <Box k="b_within" opt="بله" label="بله" /> <Box k="b_within" opt="خیر" label="خیر" /></div>
          <div>۱ ) پرداخت مبلغ <B k="b_agree" w={18} amount /> ریال موافقت می گردد.</div>
          <div>۲ ) پرداخت مبلغ <B k="b_propose" w={18} amount /> ریال پیشنهاد می گردد.</div>
          <Sign label="مهر و امضاء رئیس مجتمع / شعبه" sign={signs.BRANCH} />
        </Band>
        <Band side="مدیریت بیمه های اشخاص" active={on('HQ')}>
          <div>۱ ) پرداخت مبلغ <B k="h_1amt" w={18} amount /> ریال ( مطابق حداکثر سقف حدود اختیارات ) تایید و <Box k="h_1verb" opt="موافقت" label="موافقت" /> / <Box k="h_1verb" opt="پیشنهاد" label="پیشنهاد" /> می گردد.</div>
          <div className="paper-row paper-wrap">۲ ) طبق آئین نامه حدود اختیارات مبلغ <B k="h_2amt" w={18} amount /> ریال <Box k="h_2count" label="براساس تعداد ارفاقی" /> <Box k="h_2cap" label="سقف حدود اختیارات" /> تایید و پیشنهاد می گردد.</div>
          <Sign label="مهر و امضاء مدیر بیمه های اشخاص" sign={signs.HQ} />
        </Band>
        <Band side="معاون فنی / شورای فنی" active={on('COUNCIL')}>
          <div className="paper-row">پرداخت مبلغ <B k="c_amt" w={18} amount /> ریال <Box k="c_ok" opt="موافقت می گردد" label="موافقت می گردد" /> <Box k="c_ok" opt="نمی گردد" label="نمی گردد" /></div>
          <Sign label="مهر و امضاء" sign={signs.COUNCIL} />
        </Band>
        <Band side="مدیر عامل / هیئت مدیره" active={on('COUNCIL')}>
          <div className="paper-row">پرداخت مبلغ <B k="m_amt" w={18} amount /> ریال <Box k="m_ok" opt="موافقت می گردد" label="موافقت می گردد" /> <Box k="m_ok" opt="نمی گردد" label="نمی گردد" /></div>
          <Sign label="مهر و امضاء" sign={values.m_ok || values.m_amt ? signs.COUNCIL : null} />
        </Band>
      </PaperFields>
    </Paper>
  );
}
