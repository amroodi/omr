'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../lib/client';
import { ErrorBox, Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';

interface Row {
  id: string; tenantId: string | null; tenantName: string | null; actorType: string; actorId: string | null; actorName: string | null;
  action: string; targetType: string | null; targetId: string | null; ip: string | null; metadata: any; jalaliTimestamp: string;
}

const ACTION_FA: Record<string, string> = {
  VIEW: 'مشاهده', EXPORT: 'خروجی', EDIT: 'ویرایش', CREATE: 'ایجاد', UPLOAD: 'بارگذاری', DELETE: 'حذف', LOGIN: 'ورود', LOGIN_FAILED: 'ورود ناموفق',
  OTP_ISSUE: 'ارسال کد تایید', OTP_VERIFY: 'تایید کد', TENANT_PROVISION: 'ساخت سازمان', SHARE_GRANT: 'اشتراک‌گذاری', SHARE_REVOKE: 'لغو اشتراک',
  PAYMENT_PROPOSE: 'پیشنهاد پرداخت', PAYMENT_APPROVE: 'تایید پرداخت', PAYMENT_REJECT: 'رد پرداخت', CLAIM_SUBMIT: 'ثبت/ارسال پرونده',
  CLAIM_FORWARD: 'ارسال پرونده', CLAIM_ESCALATE: 'ارجاع به سطح بالاتر', CLAIM_APPROVE: 'تایید پرونده', CLAIM_RETURN_INCOMPLETE: 'عودت برای رفع نقص',
  CLAIM_RECTIFY: 'رفع نقص', CLAIM_REJECT: 'رد پرونده', CLAIM_PAY: 'پرداخت پرونده',
};
const ACTOR_FA: Record<string, string> = { ORG_USER: 'کاربر سازمان', SUPER_ADMIN: 'مدیر سامانه', CUSTOMER: 'بیمه‌گزار', INSURED: 'استعلام‌کننده', SYSTEM: 'سامانه', API: 'اتصال API' };
const TARGET_FA: Record<string, string> = {
  OrgUser: 'کاربر', Role: 'نقش', Claim: 'پرونده', ClaimDocument: 'مدرک', ClaimDocumentReview: 'تایید/رد مدرک', ClaimField: 'فیلد پرونده', Request: 'درخواست',
  Tenant: 'سازمان', ClaimReport: 'گزارش', PolicyholderCompany: 'شرکت بیمه‌گزار', CustomerAccount: 'حساب بیمه‌گزار', ClaimLetter: 'نامه',
};
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const jToIso = (v: string, endOfDay = false) => {
  const p = toAscii(v).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => !n)) return '';
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  return new Date(Date.UTC(gy, gm - 1, gd, endOfDay ? 23 : 0, endOfDay ? 59 : 0)).toISOString();
};

/** Short human description of an audit row's details (route, changed fields, before → after…). */
function details(m: any): string {
  if (!m || typeof m !== 'object') return m ? String(m) : '';
  const parts: string[] = [];
  if (m.route) parts.push(`${m.route}${m.refused ? ' — رد دسترسی' : ''}`);
  if (m.username) parts.push(`کاربر: ${m.username}`);
  if (m.name) parts.push(`نام: ${m.name}`);
  if (m.before && m.after) parts.push(`قبل: ${JSON.stringify(m.before)} ← بعد: ${JSON.stringify(m.after)}`);
  if (m.passwordReset) parts.push('بازنشانی رمز عبور');
  if (Array.isArray(m.fields) && m.fields.length) parts.push(`فیلدها: ${m.fields.join('، ')}`);
  const rest = Object.fromEntries(Object.entries(m).filter(([k]) => !['route', 'refused', 'username', 'name', 'before', 'after', 'passwordReset', 'fields', 'status'].includes(k)));
  if (Object.keys(rest).length) parts.push(JSON.stringify(rest));
  return parts.join(' | ');
}

/**
 * «رویدادهای سامانه» — the Super Admin's view of everything that happened on the platform: every
 * change, action, login and refused attempt in every organization, newest first, with who did it.
 */
export default function AdminAudit() {
  const router = useRouter();
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ tenantId: '', action: '', actorType: '', targetType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: Row[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const PAGE = 50;

  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    client.get<{ id: string; name: string }[]>('/tenants', 'super').then(setTenants).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = (p = page) => {
    const q = new URLSearchParams({ page: String(p), pageSize: String(PAGE) });
    if (f.tenantId) q.set('tenantId', f.tenantId);
    if (f.action) q.set('action', f.action);
    if (f.actorType) q.set('actorType', f.actorType);
    if (f.targetType) q.set('targetType', f.targetType);
    if (f.from && jToIso(f.from)) q.set('from', jToIso(f.from));
    if (f.to && jToIso(f.to, true)) q.set('to', jToIso(f.to, true));
    setLoading(true); setError('');
    client.get<{ total: number; items: Row[] }>(`/audit-logs/global?${q}`, 'super').then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(page); /* eslint-disable-next-line */ }, [page]);
  const search = () => { setPage(1); load(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">رویدادهای سامانه</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>همهٔ تغییرات و اقدامات در همهٔ سازمان‌ها — چه کسی، چه زمانی، چه کاری</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>

      <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <select className="input" value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })}>
          <option value="">— همهٔ سازمان‌ها —</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">— همهٔ اقدام‌ها —</option>
          {Object.entries(ACTION_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={f.actorType} onChange={(e) => setF({ ...f, actorType: e.target.value })}>
          <option value="">— همهٔ انجام‌دهندگان —</option>
          {Object.entries(ACTOR_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={f.targetType} onChange={(e) => setF({ ...f, targetType: e.target.value })}>
          <option value="">— همهٔ موضوع‌ها —</option>
          {Object.entries(TARGET_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <JalaliDatePicker value={f.from} onChange={(v) => setF({ ...f, from: v })} placeholder="از تاریخ" />
          <JalaliDatePicker value={f.to} onChange={(v) => setF({ ...f, to: v })} placeholder="تا تاریخ" />
        </div>
        <button className="btn btn-primary" onClick={search} disabled={loading}>{loading ? '…' : 'نمایش'}</button>
      </div>

      <ErrorBox message={error} />
      <div className="card overflow-x-auto">
        {!data ? <div className="p-10 flex justify-center"><Spinner /></div> : (
          <table className="table">
            <thead><tr>{['زمان', 'سازمان', 'انجام‌دهنده', 'اقدام', 'موضوع', 'جزئیات', 'IP'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.items.length === 0 ? <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>رویدادی یافت نشد</td></tr> : data.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.jalaliTimestamp}</td>
                  <td>{r.tenantName || '—'}</td>
                  <td>{r.actorName || ACTOR_FA[r.actorType] || r.actorType}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{ACTION_FA[r.action] || r.action}{r.metadata?.refused ? <span className="badge badge-danger mr-1">رد شد</span> : null}</td>
                  <td>{(r.targetType && TARGET_FA[r.targetType]) || r.targetType || '—'}</td>
                  <td style={{ maxWidth: 420, wordBreak: 'break-word', fontSize: '.78rem' }}>{details(r.metadata)}</td>
                  <td className="latin-digits" style={{ direction: 'ltr', fontSize: '.74rem' }}>{r.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && data.total > PAGE && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
          <span>صفحه {page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')} — {data.total.toLocaleString('fa-IR')} رویداد</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
        </div>
      )}
    </div>
  );
}
