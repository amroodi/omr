'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

const SCOPE_LABELS: Record<string, string> = {
  'claim:status': 'استعلام وضعیت پرونده (بدون اطلاعات شخصی)',
};

export default function Integration() {
  const [tab, setTab] = useState<'embed' | 'keys'>('embed');
  return (
    <Shell title="اتصال و یکپارچه‌سازی" subtitle="افزودن ویجت استعلام به وب‌سایت، و کلیدهای API سرور به سرور" nav={ORG_NAV} realm="org">
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('embed')} className="btn btn-sm" style={tab === 'embed' ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>ویجت استعلام (iframe)</button>
        <button onClick={() => setTab('keys')} className="btn btn-sm" style={tab === 'keys' ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>کلیدهای API</button>
      </div>
      {tab === 'embed' ? <EmbedTab /> : <KeysTab />}
    </Shell>
  );
}

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 items-start">
      <textarea readOnly value={text} className="input" rows={text.length > 90 ? 3 : 2} style={{ direction: 'ltr', fontFamily: 'monospace', fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
      <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>{copied ? 'کپی شد' : 'کپی'}</button>
    </div>
  );
}

function EmbedTab() {
  const [slug, setSlug] = useState('');
  const [origins, setOrigins] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const load = () => client.get<any>('/tenant/settings', 'org').then((s) => { setSlug(s.slug); setOrigins(s.embedOrigins || []); }).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);

  const save = async (next: string[]) => {
    setMsg(null);
    try { await client.patch('/tenant/settings', { embedOrigins: next }, 'org'); setOrigins(next); setMsg({ t: 'ok', m: 'ذخیره شد' }); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const add = () => {
    let v = draft.trim();
    if (!v) return;
    if (!/^https?:\/\//.test(v)) v = 'https://' + v;
    if (!/^https?:\/\/[a-zA-Z0-9.:-]+$/.test(v)) return setMsg({ t: 'err', m: 'نشانی نامعتبر (نمونه: https://damuon.ir)' });
    if (origins.includes(v)) return;
    setDraft(''); save([...origins, v]);
  };

  const iframe = `<iframe src="${client.base}/embed/inquiry?tenant=${slug}" width="100%" height="560" style="border:0;max-width:440px" title="استعلام پرونده خسارت"></iframe>`;

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm">دامنه‌های مجاز برای نمایش ویجت</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>فقط دامنه‌هایی که اینجا ثبت می‌کنید اجازه دارند ویجت را در iframe نمایش دهند (محافظت در برابر clickjacking).</p>
        {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
        <div className="flex gap-2">
          <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://damuon.ir" style={{ direction: 'ltr', textAlign: 'left' }} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button onClick={add} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>افزودن</button>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {origins.length === 0 ? <p className="text-sm py-3" style={{ color: 'var(--muted)' }}>دامنه‌ای ثبت نشده</p> :
            origins.map((o) => (
              <div key={o} className="flex justify-between items-center py-2 text-sm" style={{ direction: 'ltr' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{o}</span>
                <button onClick={() => save(origins.filter((x) => x !== o))} className="text-xs" style={{ color: 'var(--danger)' }}>حذف</button>
              </div>
            ))}
        </div>
      </div>
      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-sm">کد جاسازی (کپی در وب‌سایت)</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>این کد را در صفحه‌ای از وب‌سایت خود قرار دهید (حتی روی هاست اشتراکی). بیمه‌گزار با کد ملی و موبایل، کد تایید پیامکی و سپس وضعیت پرونده‌ها را می‌بیند.</p>
        <CopyBox text={iframe} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>پیش‌نمایش (در محیط عملیاتی که پنل و ویجت هم‌مبدأ هستند نمایش داده می‌شود؛ در محیط توسعه ممکن است به‌دلیل تفاوت پورت مسدود شود):</p>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <iframe src={`${client.base}/embed/inquiry?tenant=${slug}`} width="100%" height={520} style={{ border: 0 }} title="preview" />
        </div>
      </div>
    </div>
  );
}

interface Key { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string }

function KeysTab() {
  const [rows, setRows] = useState<Key[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const load = () => client.get<Key[]>('/api-keys', 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); client.get<string[]>('/api-keys/scopes', 'org').then((s) => { setScopes(s); setChosen(s); }).catch(() => {}); }, []);

  const create = async () => {
    setMsg(null); setFresh(null);
    try {
      const r = await client.post<{ key: string }>('/api-keys', { name, scopes: chosen }, 'org');
      setFresh(r.key); setName(''); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const revoke = async (id: string) => { try { await client.post(`/api-keys/${id}/revoke`, {}, 'org'); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };

  const example = (key: string) => `curl -H "x-api-key: ${key}" \\\n  "${client.base}/partner/claim-status?claimNumber=CLM-XXXX&nationalCode=0000000000"`;

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">ساخت کلید API</h3>
        {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
        <Field label="نام (برای یادآوری کاربرد)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="وب‌سایت دامون" /></Field>
        <div>
          <label className="block text-sm mb-1" style={{ color: 'var(--muted)' }}>دسترسی‌ها</label>
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm py-1">
              <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} />
              <span>{SCOPE_LABELS[s] || s}</span>
            </label>
          ))}
        </div>
        <button onClick={create} disabled={!name || chosen.length === 0} className="btn btn-primary btn-sm w-full">ساخت کلید</button>
      </div>
      <div className="space-y-4">
        {fresh && (
          <div className="card p-4 space-y-2" style={{ borderColor: 'var(--brand)' }}>
            <h3 className="font-bold text-sm" style={{ color: 'var(--brand)' }}>کلید ساخته شد — فقط همین یک‌بار نمایش داده می‌شود</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>این کلید را اکنون کپی و در جای امن ذخیره کنید؛ پس از بستن قابل بازیابی نیست.</p>
            <CopyBox text={fresh} />
            <p className="text-xs" style={{ color: 'var(--muted)' }}>نمونه فراخوانی از سرور وب‌سایت شما:</p>
            <CopyBox text={example(fresh)} />
            <button onClick={() => setFresh(null)} className="btn btn-ghost btn-sm">بستن</button>
          </div>
        )}
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{['نام', 'شناسه کلید', 'دسترسی‌ها', 'آخرین استفاده', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>کلیدی ساخته نشده</td></tr> :
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.name}</td>
                    <td style={{ direction: 'ltr', fontFamily: 'monospace', fontSize: 12 }}>{r.prefix}…</td>
                    <td className="text-xs">{r.scopes.join('، ')}</td>
                    <td className="text-xs">{r.lastUsedAt || '—'}</td>
                    <td><span className={`badge ${r.revokedAt ? 'badge-neutral' : 'badge-success'}`}>{r.revokedAt ? 'باطل‌شده' : 'فعال'}</span></td>
                    <td>{!r.revokedAt && <button onClick={() => revoke(r.id)} className="text-xs" style={{ color: 'var(--danger)' }}>باطل کردن</button>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
