'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../lib/client';
import { Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { Flash } from '../../components/Toaster';

interface Fields { valid: string; firstName: string; lastName: string; insuredCode: string; birthYear: string; nationalCode: string; policyNumber: string; policyStart: string; policyEnd: string }
interface Config {
  enabled: boolean; url: string; method: 'GET' | 'POST'; nationalCodeParam: string; extraParams: string; authHeader: string; hasSecret: boolean;
  timeoutSec: number; perMinute: number; rowsPath: string; fields: Fields; validValues: string;
  onUncovered: 'BLOCK' | 'WARN'; onUnavailable: 'ALLOW' | 'BLOCK'; checkPeriod: boolean; autoFill: boolean; matchPolicy: boolean;
}
interface Insurer { id: string; name: string; isActive: boolean; config: Config; cases: { valid: number; invalid: number; notChecked: number } }
interface TestResult {
  ok: boolean; ms: number; httpStatus?: number; raw?: string; error?: string; readError?: string; effect?: string; message?: string;
  result?: { status: string; reason?: string; person: Record<string, string | null> | null; policy: { number: string | null; start: string | null; end: string | null } | null };
}

const faN = (n: number) => n.toLocaleString('fa-IR');
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const jToIso = (v: string) => {
  const p = toAscii(v).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => !n)) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  return new Date(Date.UTC(gy, gm - 1, gd)).toISOString();
};
const STATUS_FA: Record<string, string> = { VALID: 'پوشش معتبر', INVALID: 'پوشش نامعتبر', NOT_FOUND: 'در سامانهٔ بیمه‌گر یافت نشد' };
const FIELD_FA: [keyof Fields, string, string][] = [
  ['valid', 'ستون «معتبر» *', 'مقدار این ستون تعیین می‌کند فرد پوشش دارد یا نه'],
  ['nationalCode', 'ستون کد ملی', 'وقتی پاسخ فهرست خانواده است، ردیف همان کد ملی برداشته می‌شود'],
  ['firstName', 'ستون نام', ''],
  ['lastName', 'ستون نام خانوادگی', ''],
  ['insuredCode', 'ستون کد رایانه', ''],
  ['birthYear', 'ستون سال تولد', ''],
  ['policyNumber', 'ستون شماره بیمه‌نامه', 'خالی = پاسخ شماره بیمه‌نامه ندارد'],
  ['policyStart', 'ستون شروع بیمه‌نامه', 'شمسی (۱۴۰۵/۰۵/۰۱) یا میلادی'],
  ['policyEnd', 'ستون پایان بیمه‌نامه', ''],
];

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="card p-4 space-y-3">
      <h3 className="font-extrabold">{title}</h3>
      {hint && <p className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</p>}
      {children}
    </div>
  );
}
function Check({ on, set, children, hint }: { on: boolean; set: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => set(e.target.checked)} />
      <span><span className="font-semibold">{children}</span>{hint && <span className="block text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}</span>
    </label>
  );
}
function Choice<T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string, string][] }) {
  return (
    <div className="space-y-1.5">
      {options.map(([v, label, hint]) => (
        <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" className="mt-1" checked={value === v} onChange={() => set(v)} />
          <span><span className="font-semibold">{label}</span><span className="block text-xs" style={{ color: 'var(--muted)' }}>{hint}</span></span>
        </label>
      ))}
    </div>
  );
}

/**
 * Super Admin › «اتصال فن‌آوران»: per insurer, the coverage inquiry the panel-1 filing form runs on the
 * insured's کد ملی (is this person — their بیمه‌نامه and its period — defined in the insurer's system?).
 * Where to call and how to sign it, how to read the reply (their column names), what the answer does to a
 * new case, a test with the raw reply, and a re-check of cases filed while the service was down.
 */
export default function AdminFanavaran() {
  const router = useRouter();
  const [list, setList] = useState<Insurer[] | null>(null);
  const [id, setId] = useState('');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [testDate, setTestDate] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);

  const load = (keep?: string) => client.get<Insurer[]>('/admin/coverage', 'super').then((l) => {
    setList(l);
    const want = keep || new URLSearchParams(window.location.search).get('insurer') || '';
    const pick = l.find((x) => x.id === want) ?? l[0];
    if (pick) { setId(pick.id); setCfg(pick.config); }
  }).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { if (!getToken('super')) { router.push('/admin/login'); return; } load(); /* eslint-disable-next-line */ }, []);

  const cur = list?.find((x) => x.id === id);
  const choose = (x: Insurer) => { setId(x.id); setCfg(x.config); setSecret(''); setClearSecret(false); setTest(null); setMsg(null); };
  const set = (patch: Partial<Config>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const setField = (k: keyof Fields, v: string) => setCfg((c) => (c ? { ...c, fields: { ...c.fields, [k]: v } } : c));

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setMsg(null);
    try {
      const { hasSecret: _h, ...body } = cfg;
      await client.put(`/admin/coverage/${id}`, { ...body, ...(secret ? { secret } : {}), ...(clearSecret ? { clearSecret: true } : {}) }, 'super');
      setSecret(''); setClearSecret(false);
      await load(id);
      setMsg({ ok: true, text: 'تنظیمات فن‌آوران ذخیره شد.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true); setTest(null); setMsg(null);
    try {
      const eventDate = testDate ? jToIso(testDate) : null;
      setTest(await client.post<TestResult>(`/admin/coverage/${id}/test`, { nationalCode: toAscii(testCode).trim(), ...(eventDate ? { eventDate } : {}) }, 'super'));
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const recheck = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await client.post<{ checked: number; remaining: number }>(`/admin/coverage/${id}/recheck`, {}, 'super');
      setMsg({ ok: true, text: `${faN(r.checked)} پرونده بررسی شد؛ ${faN(r.remaining)} پرونده هنوز بررسی‌نشده است.` });
      await load(id);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const dirty = !!cur && !!cfg && (JSON.stringify(cfg) !== JSON.stringify(cur.config) || !!secret || clearSecret);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">اتصال فن‌آوران</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>استعلام پوشش بیمه‌ای با کد ملی بیمه‌شده، پیش از ثبت پرونده در پنل ۱</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/model" className="btn btn-ghost btn-sm">Model View</Link>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت</Link>
        </div>
      </div>
      <Flash id={msg} text={msg?.text} ok={!!msg && msg.ok} />

      {!list ? <div className="card p-10 flex justify-center"><Spinner /></div> : !list.length ? <div className="card p-6 text-sm">هیچ بیمه‌گری تعریف نشده است.</div> : (
        <>
          <div className="flex gap-2 flex-wrap">
            {list.map((x) => (
              <button key={x.id} className="btn btn-sm" onClick={() => choose(x)}
                style={x.id === id ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                {x.name} {x.config.enabled ? <span className="badge badge-success mr-1">روشن</span> : <span className="badge badge-neutral mr-1">خاموش</span>}
              </button>
            ))}
          </div>

          {cur && cfg && (
            <>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="card p-3 text-sm">پوشش معتبر: <b>{faN(cur.cases.valid)}</b> پرونده</div>
                <div className="card p-3 text-sm">بدون پوشش / یافت‌نشده: <b>{faN(cur.cases.invalid)}</b> پرونده</div>
                <div className="card p-3 text-sm flex items-center justify-between gap-2">
                  <span>بررسی‌نشده: <b>{faN(cur.cases.notChecked)}</b> پرونده</span>
                  <button className="btn btn-ghost btn-sm" disabled={busy || !cur.config.enabled || !cur.cases.notChecked} onClick={recheck}>بررسی دوباره اکنون</button>
                </div>
              </div>

              <Section title="اتصال" hint="خاموش: هیچ استعلامی انجام نمی‌شود و فرم ثبت پرونده مانند امروز کار می‌کند. نشانی در محیط اصلی باید https باشد. مقدار هدر احراز هویت رمزنگاری‌شده نگه داشته می‌شود و هرگز نمایش داده نمی‌شود.">
                <Check on={cfg.enabled} set={(v) => set({ enabled: v })} hint="روشن: فرم ثبت پرونده ابتدا کد ملی بیمه‌شده را از این سرویس استعلام می‌کند.">استعلام فن‌آوران برای «{cur.name}» فعال است</Check>
                <div className="grid sm:grid-cols-4 gap-3">
                  <label className="text-sm sm:col-span-3">نشانی سرویس<input className="input mt-1 latin-digits" style={{ direction: 'ltr' }} value={cfg.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" /></label>
                  <label className="text-sm">روش
                    <select className="input mt-1" value={cfg.method} onChange={(e) => set({ method: e.target.value as 'GET' | 'POST' })}>
                      <option value="GET">GET (پارامتر در نشانی)</option>
                      <option value="POST">POST (بدنهٔ JSON)</option>
                    </select>
                  </label>
                  <label className="text-sm">نام پارامتر کد ملی<input className="input mt-1" style={{ direction: 'ltr' }} value={cfg.nationalCodeParam} onChange={(e) => set({ nationalCodeParam: e.target.value })} /></label>
                  <label className="text-sm">نام هدر احراز هویت<input className="input mt-1" style={{ direction: 'ltr' }} value={cfg.authHeader} onChange={(e) => set({ authHeader: e.target.value })} /></label>
                  <label className="text-sm sm:col-span-2">مقدار هدر {cfg.hasSecret && !clearSecret ? '(ثبت شده؛ خالی بماند تا تغییر نکند)' : ''}
                    <input className="input mt-1" type="password" autoComplete="off" style={{ direction: 'ltr' }} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="مثلاً Bearer …" />
                    {cfg.hasSecret && <label className="flex items-center gap-1.5 text-xs mt-1"><input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} /> پاک کردن مقدار ثبت‌شده</label>}
                  </label>
                  <label className="text-sm sm:col-span-2">پارامترهای ثابت (هر خط «نام=مقدار»)
                    <textarea className="input mt-1 latin-digits" rows={3} style={{ direction: 'ltr' }} value={cfg.extraParams} onChange={(e) => set({ extraParams: e.target.value })} placeholder={'insurerCode=…\nusername=…'} />
                  </label>
                  <label className="text-sm">مهلت پاسخ (ثانیه)<input className="input mt-1" type="number" min={2} max={60} value={cfg.timeoutSec} onChange={(e) => set({ timeoutSec: Number(e.target.value) })} /></label>
                  <label className="text-sm">حداکثر استعلام در دقیقه<input className="input mt-1" type="number" min={1} max={600} value={cfg.perMinute} onChange={(e) => set({ perMinute: Number(e.target.value) })} /></label>
                </div>
              </Section>

              <Section title="خواندن پاسخ" hint="نام ستون‌ها را همان‌طور که در پاسخ سرویس آمده بنویسید (ی/ک عربی و فاصله‌ها یکسان در نظر گرفته می‌شوند). «مسیر ردیف‌ها» جای فهرست در پاسخ است، مثلاً data یا result.items؛ خالی = خودکار.">
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="text-sm">مسیر ردیف‌ها<input className="input mt-1" style={{ direction: 'ltr' }} value={cfg.rowsPath} onChange={(e) => set({ rowsPath: e.target.value })} placeholder="(خودکار)" /></label>
                  <label className="text-sm sm:col-span-2">مقدارهایی از «معتبر» که یعنی پوشش دارد (با ویرگول جدا کنید)<input className="input mt-1" value={cfg.validValues} onChange={(e) => set({ validValues: e.target.value })} /></label>
                  {FIELD_FA.map(([k, label, hint]) => (
                    <label key={k} className="text-sm" title={hint}>{label}<input className="input mt-1" value={cfg.fields[k]} onChange={(e) => setField(k, e.target.value)} placeholder={hint ? '—' : ''} /></label>
                  ))}
                </div>
              </Section>

              <Section title="اثر پاسخ بر ثبت پرونده" hint="فرم ثبت پرونده در پنل ۱ اول کد ملی بیمه‌شده را می‌گیرد و همین قواعد را نشان می‌دهد؛ هنگام «ثبت پرونده» همین استعلام دوباره در سرور انجام می‌شود.">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-bold mb-1.5">اگر فرد یا بیمه‌نامه‌اش تعریف نشده یا پوشش نامعتبر بود</div>
                    <Choice value={cfg.onUncovered} set={(v) => set({ onUncovered: v })} options={[
                      ['BLOCK', 'پرونده ثبت نشود', 'پرونده‌ای که فن‌آوران پوشش آن را تایید نکند، برای پرداخت خسارت ثبت نمی‌شود.'],
                      ['WARN', 'فقط هشدار، ثبت شود', 'پرونده ثبت می‌شود و وضعیت «بدون پوشش» روی آن می‌ماند.'],
                    ]} />
                  </div>
                  <div>
                    <div className="text-sm font-bold mb-1.5">اگر سرویس در دسترس نبود</div>
                    <Choice value={cfg.onUnavailable} set={(v) => set({ onUnavailable: v })} options={[
                      ['ALLOW', 'ثبت شود و بعداً بررسی شود', 'پرونده «بررسی‌نشده» علامت می‌خورد و به‌محض برگشت سرویس خودکار بررسی می‌شود.'],
                      ['BLOCK', 'تا برگشت سرویس ثبت نشود', 'تا فن‌آوران پاسخ ندهد هیچ پرونده‌ای برای این بیمه‌گر ثبت نمی‌شود.'],
                    ]} />
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-3 pt-1">
                  <Check on={cfg.checkPeriod} set={(v) => set({ checkPeriod: v })} hint="اگر پاسخ، بازهٔ بیمه‌نامه را داشته باشد، تاریخ وقوع باید داخل آن باشد.">بررسی بازهٔ بیمه‌نامه</Check>
                  <Check on={cfg.autoFill} set={(v) => set({ autoFill: v })} hint="نام و نام خانوادگی بیمه‌شده از پاسخ در فرم نوشته می‌شود (قابل ویرایش).">تکمیل خودکار نام</Check>
                  <Check on={cfg.matchPolicy} set={(v) => set({ matchPolicy: v })} hint="بیمه‌نامهٔ شرکت با همان شماره‌ای که پاسخ می‌دهد انتخاب می‌شود.">انتخاب خودکار بیمه‌نامه</Check>
                </div>
              </Section>

              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? '…' : 'ذخیرهٔ تنظیمات'}</button>
                {dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => choose(cur)}>بازگرداندن تغییرات</button>}
              </div>

              <Section title="آزمایش اتصال" hint="با تنظیمات ذخیره‌شده یک کد ملی را استعلام می‌کند؛ هیچ پرونده‌ای تغییر نمی‌کند. پاسخ خام سرویس هم نمایش داده می‌شود تا نام ستون‌ها را درست تنظیم کنید.">
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="text-sm">کد ملی<input className="input mt-1 w-44 latin-digits" style={{ direction: 'ltr' }} value={testCode} onChange={(e) => setTestCode(e.target.value)} maxLength={10} inputMode="numeric" /></label>
                  <div className="text-sm">تاریخ وقوع (اختیاری)<div className="mt-1 w-44"><JalaliDatePicker value={testDate} onChange={setTestDate} placeholder="۱۴۰۵/۰۷/۰۱" /></div></div>
                  <button className="btn btn-ghost" disabled={busy || toAscii(testCode).trim().length !== 10 || !cur.config.url} onClick={runTest}>آزمایش</button>
                  {dirty && <span className="text-xs" style={{ color: 'var(--warning)' }}>ابتدا تغییرات را ذخیره کنید؛ آزمایش با تنظیمات ذخیره‌شده انجام می‌شود.</span>}
                </div>
                {test && (
                  <div className="space-y-2 text-sm">
                    {!test.ok ? <div className="alert-error">سرویس پاسخ نداد ({faN(test.ms)} میلی‌ثانیه): {test.error}<div className="text-xs mt-1">اثر بر ثبت پرونده: {test.effect}</div></div>
                      : test.readError ? <div className="alert-error">پاسخ HTTP {test.httpStatus} رسید اما خوانده نشد: {test.readError}</div>
                      : test.result && (
                        <div className={test.result.status === 'VALID' ? 'alert-success' : 'alert-error'}>
                          <b>{STATUS_FA[test.result.status] ?? test.result.status}</b>{test.result.reason === 'OUT_OF_PERIOD' ? ' (خارج از بازهٔ بیمه‌نامه)' : ''} — {test.effect} <span className="text-xs">({faN(test.ms)} میلی‌ثانیه، HTTP {test.httpStatus})</span>
                          {test.result.person && <div className="text-xs mt-1">{[test.result.person.firstName, test.result.person.lastName].filter(Boolean).join(' ') || '—'}{test.result.person.insuredCode ? ` — کد رایانه ${test.result.person.insuredCode}` : ''}{test.result.person.birthYear ? ` — سال تولد ${test.result.person.birthYear}` : ''}</div>}
                          {test.result.policy && <div className="text-xs">بیمه‌نامه {test.result.policy.number ?? '—'}{test.result.policy.start ? ` از ${new Date(test.result.policy.start).toLocaleDateString('fa-IR')}` : ''}{test.result.policy.end ? ` تا ${new Date(test.result.policy.end).toLocaleDateString('fa-IR')}` : ''}</div>}
                        </div>
                      )}
                    {test.raw !== undefined && (
                      <details open={!!test.readError}>
                        <summary className="cursor-pointer text-xs" style={{ color: 'var(--muted)' }}>پاسخ خام سرویس</summary>
                        <pre className="text-xs p-2 rounded-lg overflow-auto" style={{ background: 'var(--surface-2)', direction: 'ltr', textAlign: 'left', maxHeight: 320 }}>{test.raw}</pre>
                      </details>
                    )}
                  </div>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
