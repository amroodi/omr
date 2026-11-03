'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';

type Stage = 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';
type Mode = 'required' | 'optional' | 'hidden';
type RuleKey = 'councilEnabled' | 'requireLossNotice' | 'requireOriginals';
interface Rights { upload: boolean; submit: boolean }
interface LineForm { insuredLabel: string; claimTypes: string[] }
interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean }
type Line = 'LIFE' | 'ACCIDENT' | 'LIABILITY' | 'CREDIT_LIFE' | 'SAVINGS_LIFE';
interface CompanyGroup { id: string; label: string; companyIds: string[]; lines: Record<Line, string[]>; dependents: boolean }
interface Model {
  councilEnabled: boolean; requireLossNotice: boolean; requireOriginals: boolean;
  stages: Record<Stage, { label: string; reviewDocs: boolean }>;
  byType: Record<string, Partial<Record<RuleKey, boolean>>>;
  panels: { COMPANY: Rights; REPRESENTATIVE: Rights };
  insured: { enabled: boolean; docCodes: string[]; linkDays: number };
  entry: { way: 'BROKER' | 'BRANCH' | 'ASK' };
  form: { eventLabel: string; birthDate: Mode; cause: Mode; causeLists: { DEATH: string[]; ACCIDENT: string[] }; lines: Record<Line, LineForm>; caseTypes: CaseType[]; groups: CompanyGroup[]; dependents: boolean; docsNote: string };
}
interface Doc { code: string; label: string; isActive: boolean; appliesToTypes: string[]; requiredTypes: string[] }
interface Coverage { enabled: boolean; url: string; nationalCodeParam: string; authHeader: string; hasSecret: boolean; perMinute: number; notChecked: number; secret?: string }
interface Insurer { id: string; name: string; customized: boolean; casesAtCouncil: number; model: Model; docs: Doc[]; companies: { id: string; name: string; parentId: string | null }[]; coverage: Coverage }
interface NoticeRule { enabled: boolean; targets: string[]; default: string }
interface NoticeOrg { id: string; name: string; kind: string; sources: { key: string; label: string; allowed: string[]; rule: NoticeRule }[] }
interface Data { defaults: Model; insurers: Insurer[]; notice: NoticeOrg[]; targets: { key: string; label: string }[] }

const STAGES: Stage[] = ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'];
// نوع بیمه‌نامه; the last three start with no نوع پرونده until set here.
const LINES: Line[] = ['LIFE', 'ACCIDENT', 'LIABILITY', 'CREDIT_LIFE', 'SAVINGS_LIFE'];
const LINE_FA: Record<Line, string> = { LIFE: 'عمر', ACCIDENT: 'حوادث', LIABILITY: 'مسئولیت', CREDIT_LIFE: 'عمر مانده بدهکار', SAVINGS_LIFE: 'عمر پس‌انداز' };
const RULE_FA: Record<RuleKey, string> = { councilEnabled: 'شورای فنی', requireLossNotice: 'الزام اعلام خسارت', requireOriginals: 'الزام اصل مدارک' };
const TABS = [['stages', 'مراحل'], ['types', 'قوانین نوع پرونده'], ['form', 'فرم ثبت پرونده'], ['docs', 'مدارک'], ['panels', 'پنل‌ها'], ['notice', 'اعلام خسارت'], ['coverage', 'استعلام فن‌آوران']] as const;
const tabStyle = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });

function Toggle({ on, onChange, children, hint }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{children}</b>{hint && <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</span>}</span>
    </label>
  );
}
const Card = ({ title, children }: { title: string; children: ReactNode }) => <div className="card p-4 space-y-3"><h3 className="font-extrabold">{title}</h3>{children}</div>;

/** Model View: how each insurer's chain works. Only Super Admin reaches it; every save is in the audit log. */
export default function ModelView() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [id, setId] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('stages');
  const [m, setM] = useState<Model | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docType, setDocType] = useState('DEATH_ILLNESS');
  const [cov, setCov] = useState<Coverage | null>(null);
  const [noticeOrg, setNoticeOrg] = useState('');
  const [notice, setNotice] = useState<NoticeOrg | null>(null);
  const [testCode, setTestCode] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (d: Data, insurerId: string) => {
    const x = d.insurers.find((i) => i.id === insurerId) ?? d.insurers[0];
    if (!x) return;
    setId(x.id); setM(x.model); setDocs(x.docs); setCov(x.coverage);
  };
  const load = (keep?: string) => client.get<Data>('/admin/workflow-model', 'super').then((d) => {
    setData(d); pick(d, keep ?? '');
    const o = d.notice.find((n) => n.id === noticeOrg) ?? d.notice[0];
    if (o) { setNoticeOrg(o.id); setNotice(o); }
  }).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    load();
    // eslint-disable-next-line
  }, []);

  const cur = data?.insurers.find((i) => i.id === id) ?? null;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await load(id); setMsg({ t: 'ok', m: ok }); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const saveModel = () => run(() => client.put(`/admin/workflow-model/${id}`, m, 'super'), 'ذخیره شد؛ از همین لحظه روی پرونده‌های این بیمه‌گر اعمال می‌شود.');
  const modelDirty = !!m && !!cur && JSON.stringify(m) !== JSON.stringify(cur.model);
  const setStage = (s: Stage, p: Partial<Model['stages'][Stage]>) => m && setM({ ...m, stages: { ...m.stages, [s]: { ...m.stages[s], ...p } } });
  const setPanel = (p: keyof Model['panels'], k: keyof Rights, v: boolean) => m && setM({ ...m, panels: { ...m.panels, [p]: { ...m.panels[p], [k]: v } } });
  const setForm = (p: Partial<Model['form']>) => m && setM({ ...m, form: { ...m.form, ...p } });
  const setLine = (l: Line, p: Partial<LineForm>) => m && setForm({ lines: { ...m.form.lines, [l]: { ...m.form.lines[l], ...p } } });
  const setOverride = (t: string, k: RuleKey, v: string) => {
    if (!m) return;
    const o = { ...(m.byType[t] ?? {}) };
    if (v === '') delete o[k]; else o[k] = v === 'on';
    const byType = { ...m.byType, [t]: o };
    if (!Object.keys(o).length) delete byType[t];
    setM({ ...m, byType });
  };
  const saveBar = (
    <div className="flex gap-2 flex-wrap">
      <button className="btn btn-primary" disabled={!modelDirty || busy} onClick={saveModel}>{busy ? '…' : 'ذخیره'}</button>
      {data && m && <button className="btn btn-ghost" disabled={busy || JSON.stringify(m) === JSON.stringify(data.defaults)} onClick={() => setM(data.defaults)}>بازگشت به پیش‌فرض</button>}
    </div>
  );
  const toggled = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const setType = (code: string, p: Partial<CaseType>) => m && setForm({ caseTypes: m.form.caseTypes.map((t) => (t.code === code ? { ...t, ...p } : t)) });
  const setGroup = (gid: string, p: Partial<CompanyGroup>) => m && setForm({ groups: m.form.groups.map((g) => (g.id === gid ? { ...g, ...p } : g)) });
  const setDocMode = (code: string, mode: string) => setDocs(docs.map((d) => (d.code !== code ? d : {
    ...d,
    appliesToTypes: mode === 'off' ? d.appliesToTypes.filter((x) => x !== docType) : [...new Set([...d.appliesToTypes, docType])],
    requiredTypes: mode === 'required' ? [...new Set([...d.requiredTypes, docType])] : d.requiredTypes.filter((x) => x !== docType),
  })));
  const chain = m ? STAGES.filter((s) => s !== 'COUNCIL' || m.councilEnabled).map((s) => m.stages[s].label) : [];

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">Model View</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/network" className="btn btn-ghost btn-sm">نقشهٔ اتصال‌ها</Link>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
        </div>
      </div>
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      {!data ? <div className="card p-8 text-center"><Spinner /></div> : !m || !cur || !cov ? <div className="card p-6 text-sm">بیمه‌گری ثبت نشده است.</div> : (
        <>
          <div className="card p-4 space-y-3">
            {tab !== 'notice' && (
              <label className="text-sm block max-w-sm">بیمه‌گر
                <select className="input mt-1" value={id} onChange={(e) => { pick(data, e.target.value); setMsg(null); }}>
                  {data.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}{i.customized ? ' (سفارشی)' : ''}</option>)}
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {chain.map((c, i) => <span key={i} className="flex items-center gap-2">{i > 0 && <span style={{ color: 'var(--muted)' }}>←</span>}<span className="badge badge-info">{c}</span></span>)}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setMsg(null); }} className="btn btn-sm" style={tabStyle(tab === k)}>{l}</button>)}
          </div>

          {tab === 'stages' && (
            <>
              <Card title="مراحل پرونده">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>نام هر مرحله در پرونده‌ها، اقدام‌ها و پیامک‌های همین بیمه‌گر نشان داده می‌شود.</p>
                {STAGES.map((s) => (
                  <div key={s} className="grid sm:grid-cols-2 gap-3 items-center">
                    <input className="input" value={m.stages[s].label} maxLength={40} onChange={(e) => setStage(s, { label: e.target.value })} aria-label={`نام مرحلهٔ ${data.defaults.stages[s].label}`} />
                    {s === 'POLICYHOLDER'
                      ? <span className="text-xs" style={{ color: 'var(--muted)' }}>ثبت پرونده و بارگذاری مدارک</span>
                      : <Toggle on={m.stages[s].reviewDocs} onChange={(v) => setStage(s, { reviewDocs: v })}>این مرحله باید همهٔ مدارک را تایید کند</Toggle>}
                  </div>
                ))}
              </Card>
              <Card title="قوانین بیمه‌گر">
                <Toggle on={m.requireLossNotice} onChange={(v) => setM({ ...m, requireLossNotice: v })} hint="خاموش: شعبه بدون ثبت اعلام خسارت هم می‌تواند پرونده را ارسال کند.">ثبت اعلام خسارت الزامی است</Toggle>
                <Toggle on={m.requireOriginals} onChange={(v) => setM({ ...m, requireOriginals: v })} hint="خاموش: درخواست اصل مدارک همچنان ممکن است، اما شرط ارسال نیست.">دریافت اصل مدارک پیش از ارسال الزامی است</Toggle>
                <Toggle on={m.councilEnabled} onChange={(v) => setM({ ...m, councilEnabled: v })} hint="خاموش: ستاد خودش دستور پرداخت می‌دهد و سقف اختیار ستاد اعمال نمی‌شود.">شورای فنی فعال است</Toggle>
                {!m.councilEnabled && cur.casesAtCouncil > 0 && <div className="text-xs rounded-lg p-2" style={{ background: 'var(--warning-soft)' }}>{cur.casesAtCouncil.toLocaleString('fa-IR')} پرونده اکنون نزد شورای فنی است و تا پایان همان‌جا می‌ماند.</div>}
              </Card>
              {saveBar}
            </>
          )}

          {tab === 'types' && (
            <>
              <Card title="تفاوت قوانین بر اساس نوع پرونده">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>«مانند بیمه‌گر» یعنی قانون تب مراحل اعمال می‌شود.</p>
                <div className="overflow-x-auto">
                  <table className="table text-sm w-full">
                    <thead><tr><th>نوع پرونده</th>{(Object.keys(RULE_FA) as RuleKey[]).map((k) => <th key={k}>{RULE_FA[k]}</th>)}</tr></thead>
                    <tbody>
                      {m.form.caseTypes.map(({ code: t, label: tl }) => (
                        <tr key={t}>
                          <td className="font-semibold">{tl}</td>
                          {(Object.keys(RULE_FA) as RuleKey[]).map((k) => {
                            const v = m.byType[t]?.[k];
                            return (
                              <td key={k}><select className="input" aria-label={`${RULE_FA[k]} — ${tl}`} value={v === undefined ? '' : v ? 'on' : 'off'} onChange={(e) => setOverride(t, k, e.target.value)}>
                                <option value="">مانند بیمه‌گر ({m[k] ? 'روشن' : 'خاموش'})</option><option value="on">روشن</option><option value="off">خاموش</option>
                              </select></td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {saveBar}
            </>
          )}

          {tab === 'form' && (
            <>
              <Card title="نوع پرونده‌ها">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>نام هر نوع در همهٔ پنل‌های این بیمه‌گر نشان داده می‌شود. انواع استاندارد حذف نمی‌شوند؛ برای پنهان‌کردن، آن‌ها را از فهرست بیمه‌نامه بردارید.</p>
                <div className="space-y-2">
                  {m.form.caseTypes.map((t) => (
                    <div key={t.code} className="grid sm:grid-cols-[1fr_12rem_auto_auto] gap-2 items-center">
                      <input className="input" aria-label="نام نوع پرونده" value={t.label} maxLength={120} onChange={(e) => setType(t.code, { label: e.target.value })} />
                      <select className="input" aria-label="فهرست علت خسارت" value={t.causeGroup} onChange={(e) => setType(t.code, { causeGroup: e.target.value as CaseType['causeGroup'] })}><option value="DEATH">فهرست علت: فوت</option><option value="ACCIDENT">فهرست علت: حادثه</option></select>
                      <Toggle on={t.death} onChange={(v) => setType(t.code, { death: v })}>پروندهٔ فوت</Toggle>
                      {data.defaults.form.caseTypes.some((x) => x.code === t.code) ? <span /> : <button className="btn btn-ghost btn-sm" onClick={() => setForm({ caseTypes: m.form.caseTypes.filter((x) => x.code !== t.code), lines: Object.fromEntries(LINES.map((l) => [l, { ...m.form.lines[l], claimTypes: m.form.lines[l].claimTypes.filter((x) => x !== t.code) }])) as Record<Line, LineForm> })}>حذف</button>}
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ caseTypes: [...m.form.caseTypes, { code: `T_${Date.now().toString(36).toUpperCase()}`, label: 'نوع پروندهٔ جدید', causeGroup: 'ACCIDENT', death: false }] })}>افزودن نوع پرونده</button>
              </Card>
              {LINES.map((l) => (
                <Card key={l} title={`بیمه‌نامهٔ ${LINE_FA[l]}`}>
                  <label className="text-sm block">عنوان نام بیمه‌شده
                    <input className="input mt-1" value={m.form.lines[l].insuredLabel} maxLength={80} onChange={(e) => setLine(l, { insuredLabel: e.target.value })} />
                  </label>
                  <div className="text-sm font-bold">نوع پرونده‌های مجاز برای سایر بیمه‌گزاران</div>
                  {m.form.lines[l].claimTypes.length === 0 && <div className="text-xs" style={{ color: 'var(--danger)' }}>هنوز نوع پرونده‌ای انتخاب نشده؛ ثبت پرونده در این نوع بیمه‌نامه بسته است.</div>}
                  <div className="flex flex-wrap gap-4">
                    {m.form.caseTypes.map((t) => (
                      <Toggle key={t.code} on={m.form.lines[l].claimTypes.includes(t.code)} onChange={(v) => setLine(l, { claimTypes: toggled(m.form.lines[l].claimTypes, t.code, v) })}>{t.label}</Toggle>
                    ))}
                  </div>
                </Card>
              ))}
              <Card title="نوع بیمه‌شده">
                <Toggle on={m.form.dependents} onChange={(v) => setForm({ dependents: v })}>سایر بیمه‌گزاران «نوع بیمه‌شده» (اصلی / همسر / فرزند) را در فرم ثبت پرونده انتخاب می‌کنند</Toggle>
              </Card>
              <Card title="گروه‌های بیمه‌گزار">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>بیمه‌گزار، نماینده و بیمه‌شدهٔ شرکت‌های تیک‌خورده (و شرکت‌های زیرمجموعهٔ آن‌ها) به‌جای فهرست‌های بالا، نوع پرونده‌های این گروه را می‌بینند.</p>
                {m.form.groups.map((g) => (
                  <div key={g.id} className="rounded-lg p-3 space-y-3" style={{ border: '1px solid var(--border)' }}>
                    <div className="flex gap-2">
                      <input className="input" aria-label="نام گروه" value={g.label} maxLength={120} onChange={(e) => setGroup(g.id, { label: e.target.value })} />
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ groups: m.form.groups.filter((x) => x.id !== g.id) })}>حذف گروه</button>
                    </div>
                    <Toggle on={g.dependents} onChange={(v) => setGroup(g.id, { dependents: v })}>«نوع بیمه‌شده» (اصلی / همسر / فرزند) در فرم ثبت پرونده</Toggle>
                    <div className="text-sm font-bold">شرکت‌ها</div>
                    {cur.companies.length === 0 ? <div className="text-xs" style={{ color: 'var(--muted)' }}>هنوز شرکتی با این بیمه‌گر بیمه‌نامه ندارد.</div> : (
                      <div className="grid sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto">
                        {cur.companies.map((c) => <Toggle key={c.id} on={g.companyIds.includes(c.id)} onChange={(v) => setGroup(g.id, { companyIds: toggled(g.companyIds, c.id, v) })}>{c.name}</Toggle>)}
                      </div>
                    )}
                    {LINES.map((l) => (
                      <div key={l} className="space-y-1">
                        <div className="text-sm font-bold">نوع پرونده‌های {LINE_FA[l]}</div>
                        <div className="flex flex-wrap gap-4">
                          {m.form.caseTypes.map((t) => <Toggle key={t.code} on={g.lines[l].includes(t.code)} onChange={(v) => setGroup(g.id, { lines: { ...g.lines, [l]: toggled(g.lines[l], t.code, v) } })}>{t.label}</Toggle>)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ groups: [...m.form.groups, { id: `g${Date.now().toString(36)}`, label: 'گروه جدید', companyIds: [], lines: Object.fromEntries(LINES.map((l) => [l, m.form.lines[l].claimTypes])) as Record<Line, string[]>, dependents: m.form.dependents }] })}>افزودن گروه</button>
              </Card>
              <Card title="فیلدها">
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="text-sm">عنوان تاریخ<input className="input mt-1" value={m.form.eventLabel} maxLength={80} onChange={(e) => setForm({ eventLabel: e.target.value })} /></label>
                  {([['birthDate', 'تاریخ تولد'], ['cause', 'علت خسارت']] as const).map(([k, l]) => (
                    <label key={k} className="text-sm">{l}
                      <select className="input mt-1" value={m.form[k]} onChange={(e) => setForm({ [k]: e.target.value as Mode })}><option value="required">الزامی</option><option value="optional">اختیاری</option><option value="hidden">پنهان</option></select>
                    </label>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {([['DEATH', 'گزینه‌های علت خسارت — فوت و ازکارافتادگی ناشی از بیماری'], ['ACCIDENT', 'گزینه‌های علت خسارت — حادثه']] as const).map(([g, l]) => (
                    <label key={g} className="text-sm block">{l} (هر خط یک گزینه؛ کادر تایپ همیشه می‌ماند)
                      <textarea className="input mt-1" rows={12} value={m.form.causeLists[g].join('\n')} onChange={(e) => setForm({ causeLists: { ...m.form.causeLists, [g]: e.target.value.split('\n') } })} onBlur={() => setForm({ causeLists: { ...m.form.causeLists, [g]: m.form.causeLists[g].map((c) => c.trim()).filter(Boolean) } })} />
                    </label>
                  ))}
                </div>
              </Card>
              {saveBar}
            </>
          )}

          {tab === 'docs' && (
            <>
              <Card title="مدارک هر نوع پرونده">
                <label className="text-sm block max-w-md">نوع پرونده
                  <select className="input mt-1" value={docType} onChange={(e) => setDocType(e.target.value)}>
                    {m.form.caseTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                  </select>
                </label>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>بدون مدارک «الزامی» پرونده ارسال نمی‌شود؛ «برحسب نیاز» در فهرست می‌آید ولی مانع ارسال نیست. غیرفعال‌کردن مدرک آن را از همهٔ نوع پرونده‌ها برمی‌دارد و فایل‌های قبلی در «سایر مدارک» می‌ماند.</p>
                <div className="space-y-2">
                  {[...docs.filter((d) => d.appliesToTypes.includes(docType)), ...docs.filter((d) => !d.appliesToTypes.includes(docType))].map((d) => (
                    <div key={d.code} className="grid md:grid-cols-[1fr_9rem_auto] gap-2 items-start">
                      <textarea className="input text-sm" rows={2} aria-label="عنوان مدرک" value={d.label} maxLength={500} onChange={(e) => setDocs(docs.map((x) => (x.code === d.code ? { ...x, label: e.target.value } : x)))} />
                      <select className="input" aria-label="وضعیت در این نوع پرونده" value={!d.appliesToTypes.includes(docType) ? 'off' : d.requiredTypes.includes(docType) ? 'required' : 'optional'} onChange={(e) => setDocMode(d.code, e.target.value)}>
                        <option value="off">نیاز نیست</option><option value="optional">برحسب نیاز</option><option value="required">الزامی</option>
                      </select>
                      <Toggle on={d.isActive} onChange={(v) => setDocs(docs.map((x) => (x.code === d.code ? { ...x, isActive: v } : x)))}>فعال</Toggle>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDocs([{ code: `other_${Date.now().toString(36)}`, label: 'مدرک جدید', isActive: true, appliesToTypes: [docType], requiredTypes: [] }, ...docs])}>افزودن مدرک</button>
                  <button className="btn btn-primary" disabled={busy || docs.some((d) => d.label.trim().length < 2) || JSON.stringify(docs) === JSON.stringify(cur.docs)} onClick={() => run(() => client.put(`/admin/workflow-model/${id}/docs`, { docs }, 'super'), 'مدارک ذخیره شد.')}>ذخیرهٔ مدارک</button>
                </div>
              </Card>
              <Card title="یادآوری بالای فهرست مدارک">
                <textarea className="input" rows={2} maxLength={500} aria-label="یادآوری" value={m.form.docsNote} onChange={(e) => setForm({ docsNote: e.target.value })} />
                {saveBar}
              </Card>
            </>
          )}

          {tab === 'panels' && (
            <>
              <Card title="ورود داده بیمه‌گر (پنل ۱)">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>پرونده‌ای که کارکنان بیمه‌گر از «ورود برای بارگزاری مدارک» برای کارگزاران خود ثبت می‌کنند، از کجا شروع شود؟</p>
                {([
                  ['BROKER', 'میز کارگزاری', 'پرونده نخست به ارزیابی اولیهٔ همان کارگزاری می‌رود؛ انگار کارگزاری خودش ثبت کرده است. باید کارگزاری انتخاب شود.'],
                  ['BRANCH', 'مستقیم به شعبهٔ بیمه‌گر', 'ارزیابی کارگزاری انجام نمی‌شود؛ پرونده به شعبه‌ای که انتخاب می‌شود می‌رود.'],
                  ['ASK', 'هر بار انتخاب شود', 'در فرم ثبت پرونده، کاربر بیمه‌گر یکی از دو راه بالا را انتخاب می‌کند.'],
                ] as const).map(([k, l, h]) => (
                  <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="radio" name="entry-way" className="mt-1" checked={m.entry.way === k} onChange={() => setM({ ...m, entry: { way: k } })} />
                    <span><b>{l}</b><span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{h}</span></span>
                  </label>
                ))}
              </Card>
              <Card title="پنل‌های بیمه‌گزار و نماینده">
                <div className="grid sm:grid-cols-2 gap-4">
                  {([['COMPANY', 'پنل بیمه‌گزار'], ['REPRESENTATIVE', 'پنل نماینده']] as const).map(([p, l]) => (
                    <div key={p} className="space-y-2">
                      <div className="font-bold text-sm">{l}</div>
                      <Toggle on={m.panels[p].upload} onChange={(v) => setPanel(p, 'upload', v)}>بارگذاری مدارک</Toggle>
                      <Toggle on={m.panels[p].submit} onChange={(v) => setPanel(p, 'submit', v)}>ارسال پرونده به مرحلهٔ بعد</Toggle>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="بیمه‌شده و افراد تحت تکفل">
                <Toggle on={m.insured.enabled} onChange={(v) => setM({ ...m, insured: { ...m.insured, enabled: v } })} hint="بیمه‌گزار یا نماینده از صفحهٔ پرونده شماره‌ای را دعوت می‌کند؛ آن فرد با کد پیامکی وارد پنل می‌شود، وضعیت پرونده را می‌بیند و فقط مدارک انتخاب‌شده را بارگذاری می‌کند.">پنل بیمه‌شده فعال است</Toggle>
                {m.insured.enabled && (
                  <>
                    <label className="text-sm block max-w-[12rem]">اعتبار دعوت (روز)<input className="input mt-1" type="number" min={1} max={60} value={m.insured.linkDays} onChange={(e) => setM({ ...m, insured: { ...m.insured, linkDays: Number(e.target.value) } })} /></label>
                    <div className="text-sm font-bold">مدارکی که بیمه‌شده بارگذاری می‌کند</div>
                    <div className="space-y-1">
                      {cur.docs.filter((d) => d.isActive).map((d) => <Toggle key={d.code} on={m.insured.docCodes.includes(d.code)} onChange={(v) => setM({ ...m, insured: { ...m.insured, docCodes: v ? [...m.insured.docCodes, d.code] : m.insured.docCodes.filter((x) => x !== d.code) } })}>{d.label}</Toggle>)}
                    </div>
                  </>
                )}
              </Card>
              {saveBar}
            </>
          )}

          {tab === 'notice' && notice && (
            <Card title="اعلام خسارت">
              <label className="text-sm block max-w-sm">سازمان
                <select className="input mt-1" value={noticeOrg} onChange={(e) => { setNoticeOrg(e.target.value); setNotice(data.notice.find((n) => n.id === e.target.value) ?? null); }}>
                  {data.notice.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </label>
              {notice.sources.map((src) => {
                const upd = (p: Partial<NoticeRule>) => {
                  const rule = { ...src.rule, ...p };
                  if (!rule.targets.includes(rule.default)) rule.default = rule.targets[0] ?? src.rule.default;
                  setNotice({ ...notice, sources: notice.sources.map((x) => (x.key === src.key ? { ...x, rule } : x)) });
                };
                return (
                  <div key={src.key} className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--border)' }}>
                    <Toggle on={src.rule.enabled} onChange={(v) => upd({ enabled: v })}>{src.label}</Toggle>
                    <div className="flex flex-wrap gap-3">
                      {src.allowed.map((t) => <Toggle key={t} on={src.rule.targets.includes(t)} onChange={(v) => upd({ targets: v ? [...src.rule.targets, t] : src.rule.targets.filter((x) => x !== t) })}>{data.targets.find((x) => x.key === t)?.label ?? t}</Toggle>)}
                    </div>
                    <label className="text-xs block max-w-xs">پیش‌فرض
                      <select className="input mt-1" value={src.rule.default} onChange={(e) => upd({ default: e.target.value })}>{src.rule.targets.map((t) => <option key={t} value={t}>{data.targets.find((x) => x.key === t)?.label ?? t}</option>)}</select>
                    </label>
                  </div>
                );
              })}
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => client.put(`/admin/workflow-model/${notice.id}/notice`, Object.fromEntries(notice.sources.map((x) => [x.key, x.rule])), 'super'), 'اعلام خسارت ذخیره شد.')}>ذخیرهٔ اعلام خسارت</button>
            </Card>
          )}

          {tab === 'coverage' && (
            <Card title="استعلام پوشش از فن‌آوران">
              <Toggle on={cov.enabled} onChange={(v) => setCov({ ...cov, enabled: v })} hint="خاموش: هیچ استعلامی انجام نمی‌شود و فرم ثبت پرونده تغییری نمی‌کند. روشن: اگر سرویس در دسترس نباشد، پرونده ثبت و «بررسی‌نشده» علامت می‌خورد و به‌محض برگشت سرویس خودکار بررسی می‌شود.">استعلام برای این بیمه‌گر فعال است</Toggle>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm sm:col-span-2">نشانی سرویس<input className="input mt-1 latin-digits" style={{ direction: 'ltr' }} value={cov.url} onChange={(e) => setCov({ ...cov, url: e.target.value })} placeholder="https://…" /></label>
                <label className="text-sm">نام پارامتر کد ملی<input className="input mt-1" style={{ direction: 'ltr' }} value={cov.nationalCodeParam} onChange={(e) => setCov({ ...cov, nationalCodeParam: e.target.value })} /></label>
                <label className="text-sm">حداکثر استعلام در دقیقه<input className="input mt-1" type="number" min={1} max={600} value={cov.perMinute} onChange={(e) => setCov({ ...cov, perMinute: Number(e.target.value) })} /></label>
                <label className="text-sm">نام هدر احراز هویت<input className="input mt-1" style={{ direction: 'ltr' }} value={cov.authHeader} onChange={(e) => setCov({ ...cov, authHeader: e.target.value })} /></label>
                <label className="text-sm">مقدار هدر {cov.hasSecret && '(ثبت شده؛ خالی بماند تا تغییر نکند)'}<input className="input mt-1" type="password" autoComplete="off" style={{ direction: 'ltr' }} value={cov.secret ?? ''} onChange={(e) => setCov({ ...cov, secret: e.target.value })} /></label>
              </div>
              {cov.notChecked > 0 && <div className="text-xs rounded-lg p-2" style={{ background: 'var(--warning-soft)' }}>{cov.notChecked.toLocaleString('fa-IR')} پرونده در انتظار بررسی است.</div>}
              <div className="flex gap-2 flex-wrap items-end">
                <button className="btn btn-primary" disabled={busy} onClick={() => run(() => client.put(`/admin/workflow-model/${id}/coverage`, { enabled: cov.enabled, url: cov.url, nationalCodeParam: cov.nationalCodeParam, authHeader: cov.authHeader, perMinute: cov.perMinute, ...(cov.secret ? { secret: cov.secret } : {}) }, 'super'), 'تنظیمات استعلام ذخیره شد.')}>ذخیره</button>
                <input className="input w-40 latin-digits" style={{ direction: 'ltr' }} value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="کد ملی آزمایشی" maxLength={10} aria-label="کد ملی آزمایشی" />
                <button className="btn btn-ghost" disabled={busy || testCode.length !== 10 || !cur.coverage.url} onClick={async () => {
                  setMsg(null);
                  const r = await client.post<any>(`/admin/workflow-model/${id}/coverage/test`, { nationalCode: testCode }, 'super').catch((e) => ({ ok: false, error: e.message }));
                  setMsg(r.ok ? { t: 'ok', m: `پاسخ سرویس: ${r.status}` } : { t: 'err', m: `سرویس پاسخ نداد: ${r.error}` });
                }}>آزمایش اتصال</button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
