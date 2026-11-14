'use client';
import { Alt, B, Band, Box, Lines, Paper, PaperFields, Sign, Values } from './Paper';

export type DoctorForm = 'LIFE' | 'ACCIDENT';

/** Which form a case gets: حوادث for accident kinds and cases, عمر otherwise (as the API decides). */
export function doctorFormOf(line?: string | null, claimType?: string | null): DoctorForm {
  if (line === 'ACCIDENT' || line === 'ACCIDENT_INDIVIDUAL') return 'ACCIDENT';
  if (line === 'LIFE' || line === 'CREDIT_LIFE') return 'LIFE';
  return claimType && ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL'].includes(claimType) ? 'ACCIDENT' : 'LIFE';
}

const PICKS: Record<DoctorForm, string[]> = {
  LIFE: ['غرامت فوت', 'از کارافتادگی دائم و کامل ناشی از بیماری'],
  ACCIDENT: ['غرامت فوت', 'نقص عضو', 'از کارافتادگی دائم', 'هزینه پزشکی', 'غرامت های روزانه'],
};

/**
 * «فرم اظهار نظر پزشک معتمد» (عمر / حوادث), as the printed sheet. The top half is شعبه's (`request`), the bottom
 * half the doctor's (`answer`); whichever half has an onChange is typed into, the other is shown as filled.
 */
export function DoctorPaper({ form, request, answer, onRequest, onAnswer, requestSign, answerSign }: {
  form: DoctorForm; request: Values; answer: Values;
  onRequest?: (v: Values) => void; onAnswer?: (v: Values) => void;
  requestSign?: { name: string; at: string } | null; answerSign?: { name: string; at: string } | null;
}) {
  const life = form === 'LIFE';
  const g = life ? 'ع' : 'ح';
  return (
    <Paper title="فرم اظهار نظر پزشک معتمد" sub={life ? '( عمر )' : '(حوادث)'} formNo={life ? '۰۴/۲۱۲' : '۰۳/۲۱۳'}>
      <PaperFields values={request} onChange={onRequest} can={() => true}>
        <Band side="مدیریت بیمه های اشخاص / مجتمع / شعبه" active={!!onRequest}>
          <div className="paper-h">پزشک / پزشکان محترم معتمد شرکت</div>
          <p className="paper-p">
            به پیوست <B k="count" w={5} /> فقره پرونده{' '}
            <Alt k="pick" opts={PICKS[form]} />{' '}
            {life ? 'به شماره های' : <>ناشی از حادثه <B k="acc" w={10} /> به شماره های</>} <B k="caseNo1" w={16} ltr /> و <B k="caseNo2" w={16} ltr />{' '}
            /خ.{g}. <Alt k="plan1" opts={['گروهی', 'انفرادی']} /> به نام <Alt k="title" opts={['خانم', 'آقای']} /> <B k="name" w={22} /> بیمه شده <B k="insuredOf" w={22} />{' '}
            به شماره بیمه نامه های <B k="policyNo1" w={14} ltr /> و <B k="policyNo2" w={14} ltr /> /{g}. <Alt k="plan2" opts={['گروهی', 'انفرادی']} /> ایفاد می‌گردد.
            خواهشمند است نتیجه بررسی‌های به عمل آمده را جهت اقدام مقتضی اعلام فرمائید.
          </p>
          <div className="paper-p"><b>ملاحظات:</b></div>
          <Lines k="notes" rows={3} />
          <Sign label="نام و امضاء کارشناس" sign={requestSign} />
        </Band>
      </PaperFields>
      <PaperFields values={answer} onChange={onAnswer} can={() => true}>
        <Band side="پزشک معتمد شرکت" active={!!onAnswer} dashedTop>
          <div className="paper-h is-center">نظریه پزشک / پزشکان معتمد شرکت</div>
          <div className="paper-h">مدیرمحترم بیمه های اشخاص / رئیس محترم مجتمع / شعبه</div>
          <div className="paper-p paper-opt">
            <span>الف)</span><Box k="mode" opt="A" />
            <span>پرونده غرامت فوق‌الذکر مورد بررسی قرار گرفت و با توجه به محتویات پرونده نظریه پزشکی به شرح ذیل اعلام می‌گردد.</span>
          </div>
          <div className="paper-p paper-opt">
            <span>ب)</span><Box k="mode" opt="B" />
            <span>
              <Alt k="exTitle" opts={['خانم', 'آقای']} /> <B k="exName" w={18} /> درتاریخ <B k="exDate" w={11} ph="۱۴۰۵/۰۸/۲۳" /> مورد معاینه قرار گرفت و با توجه به معاینات انجام شده و محتویات
              پرونده ایشان نظریه شورای پزشکی به شرح ذیل اعلام می‌گردد.
            </span>
          </div>
          <div className="paper-h">شرح نظریه پزشکی بر اساس بند <B k="clause" w={10} /></div>
          <Lines k="opinion" rows={12} />
          <Sign label="مهروامضاء پزشک / پزشکان معتمد" sign={answerSign} />
        </Band>
      </PaperFields>
    </Paper>
  );
}
