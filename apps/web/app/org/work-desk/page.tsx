'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken, hasPerm } from '../../../lib/client';
import { Shell, Icon } from '../../components/Shell';
import { ORG_NAV } from '../nav';
import { ClaimTypeBadge, CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, NoticeModal, StatusBadge } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { toGregorian } from 'jalaali-js';

interface Tile { key: string; label: string; count: number; actionable: boolean; href?: string }
interface WorkDesk { userName: string | null; role: string; roleLabel: string; tiles: Tile[]; summary: { pendingActions: number; queues: number } }
interface QueueRow { id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null; claimedAmount: string; payableAmount?: string; finalizedAmount?: string | null; insurerTenantId?: string }

const fa = (n: number) => n.toLocaleString('fa-IR');
const EMPTY = {
  claimNumber: '', deceasedNationalCode: '', deceasedName: '', claimType: '', insurerTenantId: '',
  eventFrom: '', eventTo: '', status: '', channel: '', createdFrom: '', createdTo: '', estMin: '', estMax: '', finMin: '', finMax: '', docCode: '',
};
const STATUS_OPTIONS: [string, string][] = [
  ['SUBMITTED', 'ثبت‌شده'], ['UNDER_REVIEW', 'در حال بررسی'], ['RETURNED_INCOMPLETE', 'نقص مدارک'],
  ['APPROVED', 'تاییدشده (آماده پرداخت)'], ['PAID', 'پرداخت‌شده'], ['REJECTED', 'ردشده'],
];
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
function jToIso(input: string): string {
  const p = toAscii(input || '').split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return '';
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export default function WorkDeskPage() {
  const router = useRouter();
  const [data, setData] = useState<WorkDesk | null>(null);
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adv, setAdv] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const [tip, setTip] = useState(false);
  const [active, setActive] = useState<Tile | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]); // tile counts stay hidden until the operator clicks the tile
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [qLoading, setQLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [docTypes, setDocTypes] = useState<{ code: string; label: string }[]>([]);
  // Admin-only «پیگیری» shortcut — resolved after mount to avoid an SSR/client hydration mismatch.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { setIsAdmin(hasPerm('org', 'tenant:settings')); }, []);

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<{ code: string; label: string }[]>('/claims/doc-types', 'org').then(setDocTypes).catch(() => {});
    client.get<WorkDesk>('/claims/work-desk', 'org')
      .then((d) => {
        setData(d);
        // Post-login summary tip — once per browser session, only if something awaits action.
        try {
          if (d.summary.pendingActions > 0 && !sessionStorage.getItem('wdTipSeen')) {
            setTip(true); sessionStorage.setItem('wdTipSeen', '1');
          }
        } catch { /* private mode */ }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then((a) => setInsurers(a)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insurerMap = useMemo(() => Object.fromEntries(insurers.map((i) => [i.id, i.name])), [insurers]);

  // ── Personalization: which tiles to show and in what order (per operator, stored locally) ──
  const [prefs, setPrefs] = useState<{ hidden: string[]; order: string[] }>({ hidden: [], order: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { try { const p = localStorage.getItem('wdTilePrefs'); if (p) setPrefs(JSON.parse(p)); } catch { /* ignore */ } }, []);
  const savePrefs = (p: { hidden: string[]; order: string[] }) => { setPrefs(p); try { localStorage.setItem('wdTilePrefs', JSON.stringify(p)); } catch { /* ignore */ } };

  // Tiles in the operator's chosen order (unlisted keys keep their default order), hidden ones removed.
  const orderedAll = useMemo(() => {
    if (!data) return [] as Tile[];
    const byKey = Object.fromEntries(data.tiles.map((t) => [t.key, t]));
    const ordered = prefs.order.filter((k) => byKey[k]).map((k) => byKey[k]);
    const rest = data.tiles.filter((t) => !prefs.order.includes(t.key));
    return [...ordered, ...rest];
  }, [data, prefs.order]);
  const arrangedTiles = useMemo(() => orderedAll.filter((t) => !prefs.hidden.includes(t.key)), [orderedAll, prefs.hidden]);

  const toggleHidden = (key: string) => {
    const hidden = prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key];
    savePrefs({ ...prefs, hidden });
  };
  const moveTile = (key: string, dir: -1 | 1) => {
    const order = orderedAll.map((t) => t.key);
    const i = order.indexOf(key); const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    savePrefs({ ...prefs, order });
  };
  const hideNonActionable = () => savePrefs({ ...prefs, hidden: orderedAll.filter((t) => !t.actionable && !['all'].includes(t.key)).map((t) => t.key) });

  const openQueue = (t: Tile) => {
    setRevealed((r) => (r.includes(t.key) ? r : [...r, t.key])); // reveal this tile's count
    if (t.count === 0) { setNotice('موردی برای این صف وجود ندارد.'); return; }
    setActive(t); setRows([]); setQLoading(true);
    client.get<QueueRow[]>(`/claims/work-desk/queue?key=${encodeURIComponent(t.key)}`, 'org')
      .then(setRows).catch((e) => setError(e.message)).finally(() => setQLoading(false));
  };

  const runSearch = () => {
    const p = new URLSearchParams();
    const set = (k: string, v: string) => { if (v) p.set(k, v); };
    set('claimNumber', f.claimNumber.trim());
    set('deceasedNationalCode', toAscii(f.deceasedNationalCode).replace(/\D/g, ''));
    set('deceasedName', f.deceasedName.trim());
    set('claimType', f.claimType);
    set('insurerTenantId', f.insurerTenantId);
    set('status', f.status);
    set('channel', f.channel);
    set('eventFrom', jToIso(f.eventFrom)); set('eventTo', jToIso(f.eventTo));
    set('createdFrom', jToIso(f.createdFrom)); set('createdTo', jToIso(f.createdTo));
    set('estMin', toAscii(f.estMin).replace(/\D/g, '')); set('estMax', toAscii(f.estMax).replace(/\D/g, ''));
    set('finMin', toAscii(f.finMin).replace(/\D/g, '')); set('finMax', toAscii(f.finMax).replace(/\D/g, ''));
    set('docCode', f.docCode);
    setError(''); setActive({ key: 'search', label: 'نتایج جستجو', count: 0, actionable: false }); setRows([]); setQLoading(true);
    client.get<QueueRow[]>(`/claims/search?${p.toString()}`, 'org')
      .then((r) => { setRows(r); setActive((a) => (a ? { ...a, count: r.length } : a)); })
      .catch((e) => setError(e.message)).finally(() => setQLoading(false));
  };
  const clear = () => { setF({ ...EMPTY }); setActive(null); };
  const upd = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Shell title="میز کار" sectionLabel="میز کار" nav={ORG_NAV} realm="org"
      action={
        <span className="flex items-center gap-2">
          {data?.roleLabel && <span className="badge badge-neutral whitespace-nowrap">نقش: {data.roleLabel}</span>}
          {data && (
            <button onClick={() => setSettingsOpen(true)} className="btn btn-ghost btn-sm" title="شخصی‌سازی برگه‌ها">
              <Icon path="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              <span className="hidden sm:inline">شخصی‌سازی</span>
            </button>
          )}
          {isAdmin && (
            <Link href="/org/track" className="btn btn-solid btn-sm" title="پیگیری آخرین وضعیت پرونده خسارت">
              <Icon path="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />
              <span className="hidden lg:inline">پیگیری آخرین وضعیت پرونده خسارت</span>
            </Link>
          )}
        </span>
      }>
      {/* ── Search panel ── */}
      <div className="pcard p-5 pform mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input className="input" placeholder="شناسه / شماره پرونده" value={f.claimNumber} onChange={upd('claimNumber')} />
          <input className="input" placeholder="کد ملی بیمه‌شده (متوفی)" value={f.deceasedNationalCode} onChange={upd('deceasedNationalCode')} inputMode="numeric" />
          <input className="input" placeholder="نام بیمه‌شده (متوفی)" value={f.deceasedName} onChange={upd('deceasedName')} />
          <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
            <option value="">— نوع پرونده —</option>
            {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="input" value={f.insurerTenantId} onChange={(e) => setF({ ...f, insurerTenantId: e.target.value })}>
            <option value="">— بیمه‌گر —</option>
            {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <JalaliDatePicker value={f.eventFrom} onChange={(v) => setF({ ...f, eventFrom: v })} placeholder="وقوع از تاریخ" />
            <JalaliDatePicker value={f.eventTo} onChange={(v) => setF({ ...f, eventTo: v })} placeholder="وقوع تا تاریخ" />
          </div>
        </div>

        {/* Advanced fields (جستجوی پیشرفته) */}
        {adv && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">— وضعیت پرونده —</option>
              {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              <option value="">— کانال —</option>
              <option value="BROKER">کارگزاری (معرف)</option>
              <option value="DIRECT">مستقیم (شعبه)</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <JalaliDatePicker value={f.createdFrom} onChange={(v) => setF({ ...f, createdFrom: v })} placeholder="ثبت از تاریخ" />
              <JalaliDatePicker value={f.createdTo} onChange={(v) => setF({ ...f, createdTo: v })} placeholder="ثبت تا تاریخ" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="برآوردی از (ریال)" value={f.estMin} onChange={upd('estMin')} inputMode="numeric" />
              <input className="input" placeholder="برآوردی تا" value={f.estMax} onChange={upd('estMax')} inputMode="numeric" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="قطعی از (ریال)" value={f.finMin} onChange={upd('finMin')} inputMode="numeric" />
              <input className="input" placeholder="قطعی تا" value={f.finMax} onChange={upd('finMax')} inputMode="numeric" />
            </div>
            <select className="input" value={f.docCode} onChange={(e) => setF({ ...f, docCode: e.target.value })} title="جستجو بر اساس نوع مدرک (همهٔ انواع پرونده)">
              <option value="">— نوع مدرک —</option>
              {docTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <button onClick={() => setAdv((a) => !a)} className="btn btn-ghost btn-sm">
            <Icon path={adv ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /> جستجوی پیشرفته
          </button>
          <div className="flex items-center gap-2">
            <button onClick={clear} className="btn btn-ghost btn-sm">پاک کردن</button>
            <button onClick={runSearch} className="btn btn-solid btn-sm px-6">جستجو</button>
          </div>
        </div>
      </div>

      <ErrorBox message={error} />

      {/* ── Work-queue tiles ── */}
      {loading ? (
        <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال آماده‌سازی میز کار…" /></div>
      ) : !data || data.tiles.length === 0 ? (
        <div className="pcard p-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
          برگه‌ای برای نمایش در میز کار شما تعریف نشده است.
        </div>
      ) : (
        <>
          {arrangedTiles.length === 0 ? (
            <div className="pcard p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>همهٔ برگه‌ها پنهان شده‌اند. از «شخصی‌سازی» می‌توانید دوباره نمایش دهید.</div>
          ) : (
          <div className="wd-tiles">
            {arrangedTiles.map((t) => (
              <div
                key={t.key}
                className={`wd-tile ${t.count === 0 ? 'is-zero' : ''}`}
                style={active?.key === t.key ? { background: 'var(--brand-soft)' } : t.actionable ? { boxShadow: 'inset 0 -3px 0 var(--brand)' } : undefined}
                title={t.actionable ? `${t.label} — قابل اقدام شما` : t.label}
                onClick={() => openQueue(t)}
              >
                <div className="wd-tile-label">{t.label}</div>
                {revealed.includes(t.key) ? (
                  <div className="wd-tile-count" style={t.actionable && t.count > 0 ? { color: 'var(--brand)' } : undefined}>{t.count === 0 ? '—' : fa(t.count)}</div>
                ) : (
                  <div className="wd-tile-count" style={{ color: 'var(--muted)', opacity: 0.6 }} title="برای مشاهدهٔ تعداد کلیک کنید">···</div>
                )}
                {t.actionable && <div style={{ fontSize: '0.62rem', color: 'var(--brand)', fontWeight: 700, marginTop: 2 }}>قابل اقدام شما</div>}
              </div>
            ))}
          </div>
          )}

          {/* Queue list for the selected tile */}
          {active && (
            <div className="pcard mt-5 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h3 className="font-extrabold">{active.label} <span style={{ color: 'var(--muted)' }}>({fa(active.count)})</span></h3>
                <button onClick={() => setActive(null)} className="btn btn-ghost btn-sm">بستن</button>
              </div>
              {qLoading ? (
                <div className="p-12 flex justify-center"><FancyLoader label="در حال دریافت صف…" /></div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>موردی یافت نشد.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr>{['#', 'شماره پرونده', 'نوع', 'بیمه‌گر', 'بیمه‌شده (متوفی)', 'مبلغ (ریال)', 'وضعیت', 'عملیات'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/org/claims/${r.id}`)}>
                          <td>{fa(i + 1)}</td>
                          <td className="font-semibold">{r.claimNumber}</td>
                          <td><ClaimTypeBadge type={r.claimType} /></td>
                          <td>{(r.insurerTenantId && insurerMap[r.insurerTenantId]) || '—'}</td>
                          <td>{r.deceasedName || '—'}</td>
                          <td style={{ direction: 'ltr', textAlign: 'right' }}>
                            {Number(r.payableAmount || r.claimedAmount || 0).toLocaleString('fa-IR')}
                            {r.finalizedAmount ? <span className="badge badge-success mr-1" style={{ fontSize: '0.6rem' }}>قطعی</span> : null}
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                          <td><button onClick={(e) => { e.stopPropagation(); router.push(`/org/claims/${r.id}/assess`); }} className="btn btn-solid btn-sm">ارزیابی</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {notice && (
        <NoticeModal variant="info" title="توجه" onClose={() => setNotice('')}>{notice}</NoticeModal>
      )}

      {/* Personalization — show/hide/order the Work Desk tiles (saved per operator, on this device) */}
      {settingsOpen && data && (
        <div className="pmodal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="pmodal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">شخصی‌سازی برگه‌های میز کار</span>
              <button className="pmodal-x" onClick={() => setSettingsOpen(false)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body">
              <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>برگه‌هایی که می‌خواهید در میز کار دیده شوند را انتخاب و ترتیبشان را تعیین کنید.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={hideNonActionable} className="btn btn-ghost btn-sm">فقط برگه‌های قابل اقدام من</button>
                <button onClick={() => savePrefs({ hidden: [], order: [] })} className="btn btn-ghost btn-sm">نمایش همه (پیش‌فرض)</button>
              </div>
              <div className="space-y-1.5">
                {orderedAll.map((t, i) => {
                  const hidden = prefs.hidden.includes(t.key);
                  return (
                    <div key={t.key} className="flex items-center justify-between gap-2 rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                      <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0">
                        <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(t.key)} />
                        <span className={hidden ? '' : 'font-semibold'} style={hidden ? { color: 'var(--muted)' } : undefined}>{t.label}</span>
                        {t.actionable && <span className="badge badge-neutral" style={{ fontSize: '0.6rem' }}>قابل اقدام</span>}
                      </label>
                      <span className="flex items-center gap-1 shrink-0">
                        <button onClick={() => moveTile(t.key, -1)} disabled={i === 0} className="btn btn-ghost btn-sm" title="بالا">▲</button>
                        <button onClick={() => moveTile(t.key, 1)} disabled={i === orderedAll.length - 1} className="btn btn-ghost btn-sm" title="پایین">▼</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setSettingsOpen(false)} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>تمام</button>
            </div>
          </div>
        </div>
      )}

      {/* Post-login summary tip */}
      {tip && data && (
        <NoticeModal variant="info" title="خوش آمدید" onClose={() => setTip(false)} confirmLabel="متوجه شدم">
          <p className="font-bold mb-2">{data.userName ? `${data.userName} عزیز،` : 'کاربر گرامی،'}</p>
          <p>در حال حاضر <b style={{ color: 'var(--brand)' }}>{fa(data.summary.pendingActions)}</b> مورد در میز کار شما در انتظار اقدام است (در <b>{fa(data.summary.queues)}</b> برگه).</p>
          <p className="mt-2" style={{ color: 'var(--muted)' }}>برای مشاهدهٔ هر صف، روی برگهٔ مربوط به آن در میز کار کلیک کنید.</p>
        </NoticeModal>
      )}
    </Shell>
  );
}
