'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Field } from '../../components/ui';

interface Settings {
  enabled: boolean; baseUrl: string; model: string; maxConcurrency: number; threshold: number;
  hasKey: boolean; keyFromEnv: boolean;
  orgs: { id: string; name: string; kind: string; aiReviewEnabled: boolean }[];
  queue: { queued: number; processing: number; doneToday: number; limit: number | null };
}
interface Prompt { code: string; label: string; prompt: string }
const KIND_FA: Record<string, string> = { BROKER: 'کارگزاری', INSURER: 'بیمه‌گر' };
const ltr = { direction: 'ltr' as const, textAlign: 'left' as const };

/**
 * «بررسی هوشمند مدارک» (super admin): the AI checks that each uploaded file is the document of its slot.
 * Master switch, AvalAI key/model, queue size, per-org switches and one pre-prompt per document type.
 */
export default function AiReviewAdmin() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [f, setF] = useState({ apiKey: '', model: '', maxConcurrency: 10, threshold: 0.85 });
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [credit, setCredit] = useState<string>('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const load = async () => {
    try {
      const d = await client.get<Settings>('/platform/ai-review', 'super');
      setS(d); setF({ apiKey: '', model: d.model, maxConcurrency: d.maxConcurrency, threshold: d.threshold });
      const p = await client.get<Prompt[]>('/platform/ai-review/prompts', 'super');
      setPrompts(p); setDraft(Object.fromEntries(p.map((x) => [x.code, x.prompt])));
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (enabled?: boolean) => {
    setMsg(null);
    try {
      await client.put('/platform/ai-review', { ...(enabled !== undefined ? { enabled } : {}), model: f.model, maxConcurrency: Number(f.maxConcurrency), threshold: Number(f.threshold), ...(f.apiKey ? { apiKey: f.apiKey } : {}) }, 'super');
      await load(); setMsg({ t: 'ok', m: 'ذخیره شد' });
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const setOrg = async (id: string, enabled: boolean) => {
    setS((x) => x ? { ...x, orgs: x.orgs.map((o) => o.id === id ? { ...o, aiReviewEnabled: enabled } : o) } : x);
    try { await client.post(`/platform/ai-review/orgs/${id}`, { enabled }, 'super'); } catch (e: any) { setMsg({ t: 'err', m: e.message }); load(); }
  };
  const savePrompt = async (code: string) => {
    setMsg(null);
    try {
      await client.put(`/platform/ai-review/prompts/${encodeURIComponent(code)}`, { prompt: draft[code] ?? '' }, 'super');
      setPrompts((ps) => ps.map((p) => p.code === code ? { ...p, prompt: draft[code] ?? '' } : p));
      setMsg({ t: 'ok', m: 'دستور ذخیره شد' });
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const checkCredit = async () => {
    setCredit('…');
    try {
      const c = await client.get<{ remainingIrt: number; tier: number }>('/platform/ai-review/credit', 'super');
      setCredit(`اعتبار باقی‌مانده: ${Math.round(Number(c.remainingIrt) || 0).toLocaleString('fa-IR')} تومان — سطح حساب ${Number(c.tier).toLocaleString('fa-IR')}`);
    } catch (e: any) { setCredit(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">بررسی هوشمند مدارک</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>هوش مصنوعی بررسی می‌کند که هر فایل همان مدرکی باشد که در جای آن بارگذاری شده است</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      {!s ? <p className="text-sm" style={{ color: 'var(--muted)' }}>در حال بارگذاری…</p> : (
        <>
          <div className="card p-5 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={s.enabled} onChange={(e) => save(e.target.checked)} />
              <span className="font-semibold">بررسی هوشمند مدارک فعال باشد</span>
              {s.enabled && !s.hasKey && <span className="badge badge-danger">کلید AvalAI تنظیم نشده</span>}
            </label>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              خاموش: همهٔ مدارک مثل قبل بدون بررسی پذیرفته می‌شوند. روشن: هر فایل در صف بررسی قرار می‌گیرد؛ کاربر بارگذاری را ادامه می‌دهد و نتیجه را با پیامک دریافت می‌کند.
              فایلی که هوش مصنوعی با اطمینان تشخیص دهد مدرک دیگری است رد می‌شود و پیوند بارگذاری دوباره برای کاربر فرستاده می‌شود؛ در موارد نامطمئن فایل پذیرفته و به کارشناس سپرده می‌شود.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="نشانی سرویس"><input className="input" value={s.baseUrl} readOnly style={{ ...ltr, opacity: 0.7 }} /></Field>
              <Field label="مدل"><input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} style={ltr} placeholder="gemini-3.8-flash" /></Field>
              <Field label={`کلید AvalAI${s.hasKey ? (s.keyFromEnv ? ' (از فایل تنظیمات سرور)' : ' (تنظیم‌شده)') : ''}`}>
                <input className="input" type="password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} placeholder={s.hasKey ? '••••••' : 'sk-…'} style={ltr} autoComplete="off" />
              </Field>
              <Field label="حداکثر بررسی هم‌زمان (۱ تا ۵۰)"><input className="input" type="number" min={1} max={50} value={f.maxConcurrency} onChange={(e) => setF({ ...f, maxConcurrency: Number(e.target.value) })} style={ltr} /></Field>
              <Field label="حداقل اطمینان برای رد فایل (۰٫۵ تا ۱)"><input className="input" type="number" min={0.5} max={1} step={0.05} value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} style={ltr} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => save()} className="btn btn-primary btn-sm">ذخیرهٔ تنظیمات</button>
              <button onClick={checkCredit} className="btn btn-ghost btn-sm" disabled={!s.hasKey}>بررسی اتصال و اعتبار AvalAI</button>
              {credit && <span className="text-xs" style={{ color: 'var(--muted)' }}>{credit}</span>}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge">در صف: {s.queue.queued.toLocaleString('fa-IR')}</span>
              <span className="badge">در حال بررسی: {s.queue.processing.toLocaleString('fa-IR')}</span>
              <span className="badge">بررسی‌شده در ۲۴ ساعت: {s.queue.doneToday.toLocaleString('fa-IR')}</span>
              {s.queue.limit != null && <span className="badge">ظرفیت فعلی صف: {s.queue.limit.toLocaleString('fa-IR')}</span>}
            </div>
          </div>

          <div className="card p-5 space-y-2">
            <h3 className="font-semibold">فعال بودن برای هر سازمان</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>پرونده‌ای بررسی می‌شود که هم بیمه‌گر و هم کارگزاری آن روشن باشند.</p>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {s.orgs.map((o) => (
                <label key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm cursor-pointer">
                  <span>{o.name} <span className="text-xs" style={{ color: 'var(--muted)' }}>({KIND_FA[o.kind] ?? o.kind})</span></span>
                  <input type="checkbox" checked={o.aiReviewEnabled} onChange={(e) => setOrg(o.id, e.target.checked)} />
                </label>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="font-semibold">دستور بررسی هر نوع مدرک (پیش‌دستور)</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              برای هر مدرک توضیح دهید که چه شکلی دارد و با چه چیزی اشتباه گرفته می‌شود (مثلاً «سربرگ سازمان، عنوان «حکم کارگزینی»، مهر و امضای بیمه‌گزار»). این متن همراه فایل برای هوش مصنوعی فرستاده می‌شود. خالی بودن یعنی فقط عنوان مدرک ملاک است.
            </p>
            {prompts.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>هنوز فهرست مدارکی تعریف نشده است.</p>}
            {prompts.map((p) => (
              <div key={p.code} className="space-y-1 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs" style={{ color: 'var(--muted)', ...ltr }}>{p.code}</div>
                <textarea className="input" rows={3} value={draft[p.code] ?? ''} onChange={(e) => setDraft({ ...draft, [p.code]: e.target.value })} maxLength={4000} />
                {(draft[p.code] ?? '') !== p.prompt && <button onClick={() => savePrompt(p.code)} className="btn btn-primary btn-sm">ذخیرهٔ دستور</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
