'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { client, getToken } from '../../../../lib/client';
import { Design, DesignApi, ThemeDesigner } from '../../../components/ThemeDesigner';
import { ErrorBox, Field } from '../../../components/ui';

/**
 * «طراحی و تنظیمات سازمان» (super admin): design a new or existing organization — the theme, colours and
 * logo of the organization and of each of its panels (one shared logo, or a different logo per panel) —
 * and set up its admin settings.
 */
export default function OrgDesign() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  useEffect(() => { if (!getToken('super')) router.push('/admin/login'); /* eslint-disable-next-line */ }, []);

  const api: DesignApi = {
    load: async () => { const d = await client.get<Design>(`/tenants/${id}/design`, 'super'); setName(d.name); return d; },
    save: (body) => client.put<Design>(`/tenants/${id}/design`, body, 'super'),
    uploadLogo: (file, panel, onP) => { const fd = new FormData(); fd.append('file', file); return client.upload<Design>(`/tenants/${id}/design/logo${panel ? `?panel=${panel}` : ''}`, fd, 'super', onP); },
    clearLogo: (panel) => client.del<Design>(`/tenants/${id}/design/logo?panel=${panel}`, 'super'),
    logoSrc: async (panel) => {
      try { return (await client.blobUrl(`/tenants/${id}/design/logo${panel ? `?panel=${panel}` : ''}`, 'super')).url; } catch { return null; }
    },
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">طراحی و تنظیمات سازمان{name ? ` — ${name}` : ''}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>رنگ‌ها، قالب و لوگوی سازمان و هر یک از پنل‌هایش، و تنظیمات مدیر سازمان</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>
      <section className="card p-5 space-y-3">
        <h2 className="font-bold">طراحی ظاهر پنل‌ها</h2>
        <ThemeDesigner api={api} />
      </section>
      <section className="card p-5">
        <h2 className="font-bold mb-3">تنظیمات مدیر سازمان</h2>
        <OrgSettings id={id} />
      </section>
    </div>
  );
}

/** The settings the organization's own admin has in «تنظیمات سازمان», set up here by the super admin. */
function OrgSettings({ id }: { id: string }) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get<any>(`/tenants/${id}/settings`, 'super').then(setS).catch((e) => setMsg({ t: 'err', m: e.message })); }, [id]);
  if (!s) return msg ? <ErrorBox message={msg.m} /> : null;
  const save = async () => {
    setMsg(null); setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: s.name, contactHeader: s.contactHeader ?? '', noticeDays: Number(s.noticeDays), lateNoticeWarning: s.lateNoticeWarning !== false,
        requireMfa: !!s.requireMfa, reminderSms: !!s.reminderSms,
        rejectReasons: String(s.rejectReasonsText ?? (s.rejectReasons ?? []).join('\n')).split('\n').map((x: string) => x.trim()).filter(Boolean),
      };
      if (s.kind === 'INSURER') body.hqCeiling = String(s.hqCeiling ?? '').replace(/[^\d]/g, '') || null;
      setS(await client.patch<any>(`/tenants/${id}/settings`, body, 'super'));
      setMsg({ t: 'ok', m: 'تنظیمات سازمان ذخیره شد' });
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
      {msg && <div className={`md:col-span-2 ${msg.t === 'ok' ? 'alert-success' : 'alert-error'}`}>{msg.m}</div>}
      <Field label="نام سازمان"><input className="input" value={s.name || ''} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
      <Field label="سربرگ تماس (در خروجی‌ها)"><input className="input" value={s.contactHeader || ''} onChange={(e) => setS({ ...s, contactHeader: e.target.value })} /></Field>
      <Field label="مهلت اعلام خسارت (روز)"><input className="input" type="number" value={s.noticeDays ?? 30} onChange={(e) => setS({ ...s, noticeDays: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      {s.kind === 'INSURER' && (
        <Field label="سقف اختیار پرداخت مدیریت ستاد (ریال) — خالی = نامحدود">
          <input className="input" inputMode="numeric" value={s.hqCeiling ?? ''} onChange={(e) => setS({ ...s, hqCeiling: e.target.value.replace(/[^\d]/g, '') })} style={{ direction: 'ltr', textAlign: 'right' }} />
        </Field>
      )}
      <div className="md:col-span-2 space-y-2 text-sm">
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={s.lateNoticeWarning !== false} onChange={(e) => setS({ ...s, lateNoticeWarning: e.target.checked })} /> نمایش هشدار «خارج از مهلت مقرر» روی پرونده‌ها</label>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!s.requireMfa} onChange={(e) => setS({ ...s, requireMfa: e.target.checked })} /> ورود دومرحله‌ای برای همهٔ کاربران سازمان الزامی باشد</label>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!s.reminderSms} onChange={(e) => setS({ ...s, reminderSms: e.target.checked })} /> ارسال پیامک یادآور به کاربران</label>
      </div>
      <div className="md:col-span-2">
        <Field label="دلایل رد مدارک — هر دلیل در یک خط">
          <textarea className="input" rows={5} value={s.rejectReasonsText ?? (s.rejectReasons ?? []).join('\n')} onChange={(e) => setS({ ...s, rejectReasonsText: e.target.value })} />
        </Field>
      </div>
      <div><button onClick={save} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'ذخیرهٔ تنظیمات سازمان'}</button></div>
    </div>
  );
}
