'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { client, getToken, hasPerm } from '../../../lib/client';
import { Shell, Icon } from '../../components/Shell';
import { ORG_NAV } from '../nav';
import { ClaimTypeBadge, CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, NoticeModal, Overlay, STATUS_MAP, StatusBadge } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { RangeSlider } from '../../components/RangeSlider';
import { toGregorian } from 'jalaali-js';
import { caseTitle } from '../../../lib/caseTitle';

interface Tile { key: string; label: string; count: number; actionable: boolean; href?: string }
interface WorkDesk { userName: string | null; role: string; roleLabel: string; tiles: Tile[]; summary: { pendingActions: number; queues: number } }
interface QueueRow { id: string; claimNumber: string; policyNumber?: string | null; deceasedNationalCode?: string | null; status: string; claimType: string; deceasedName: string | null; claimedAmount: string; payableAmount?: string; finalizedAmount?: string | null; insurerTenantId?: string }

const fa = (n: number) => n.toLocaleString('fa-IR');
const EMPTY = {
  policyNumber: '', deceasedNationalCode: '', deceasedName: '', claimType: '', insurerTenantId: '',
  eventFrom: '', eventTo: '', status: '', channel: '', createdFrom: '', createdTo: '', estMin: '', estMax: '', finMin: '', finMax: '', docCode: '', beneficiaryType: '',
};
const STATUS_OPTIONS: [string, string][] = [
  ['SUBMITTED', 'ثبت‌شده'], ['UNDER_REVIEW', 'در حال بررسی'], ['RETURNED_INCOMPLETE', 'نقص مدارک'],
  ['APPROVED', 'تاییدشده (آماده پرداخت)'], ['PAID', 'پرداخت‌شده'], ['REJECTED', 'ردشده'],
];
const BENEFICIARY_TYPES = ['وراث قانونی', 'ذینفع قانونی', 'همسر', 'فرزند', 'پدر', 'مادر', 'سایر'];
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
function jToIso(input: string): string {
  const p = toAscii(input || '').split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return '';
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  const d = new Date(Date.UTC(gy, gm - 1, gd));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// useSearchParams needs a Suspense boundary in the app router.
export default function WorkDeskPage() {
  return <Suspense fallback={null}><WorkDesk /></Suspense>;
}

function WorkDesk() {
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [rows, pageSize]);
  const [notice, setNotice] = useState('');
  const [docTypes, setDocTypes] = useState<{ code: string; label: string }[]>([]);
  // «پرونده جدید» needs claim:file — resolved after mount to avoid an SSR/client hydration mismatch.
  const [canFile, setCanFile] = useState(false);
  useEffect(() => { setCanFile(hasPerm('org', 'claim:file')); }, []);

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

  // Row selection + «خروجی اکسل» of the open list (the selected rows, or all of them when none is picked).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setPicked(new Set()); }, [rows]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const exportExcel = async () => {
    if (!active) return;
    const list = picked.size ? rows.filter((r) => picked.has(r.id)) : rows;
    setExporting(true);
    try {
      await client.downloadPost('/exports/table.xlsx', {
        title: `میز کار — ${active.label}`,
        headers: ['ردیف', 'شماره پرونده', 'شماره بیمه‌نامه', 'کد ملی متوفی', 'نوع', 'بیمه‌گر', 'بیمه‌شده (متوفی)', 'مبلغ (ریال)', 'وضعیت'],
        rows: list.map((r, i) => [String(i + 1), r.claimNumber, r.policyNumber ?? '', r.deceasedNationalCode ?? '', CLAIM_TYPE_LABELS[r.claimType] ?? r.claimType,
          (r.insurerTenantId && insurerMap[r.insurerTenantId]) || '', r.deceasedName ?? '', String(Number(r.payableAmount || r.claimedAmount || 0)), STATUS_MAP[r.status]?.label ?? r.status]),
      }, 'org', 'work-desk.xlsx');
    } catch (e: any) { setError(e.message); } finally { setExporting(false); }
  };

  // ── Personalization: which tiles to show and in what order (per operator, stored locally) ──
  const [prefs, setPrefs] = useState<{ hidden: string[]; order: string[] }>({ hidden: [], order: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { try { const p = localStorage.getItem('wdTilePrefs'); if (p) setPrefs(JSON.parse(p)); } catch { /* ignore */ } }, []);
  // «شخصی‌سازی میز کار» in the sidebar links here with ?customize=1.
  const customize = useSearchParams().get('customize') === '1';
  useEffect(() => { if (data && customize) setSettingsOpen(true); }, [data, customize]);
  const closeSettings = () => { setSettingsOpen(false); if (customize) router.replace('/org/work-desk'); };
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
    set('policyNumber', toAscii(f.policyNumber).trim());
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
    set('beneficiaryType', f.beneficiaryType);
    setError(''); setActive({ key: 'search', label: 'نتایج جستجو', count: 0, actionable: false }); setRows([]); setQLoading(true);
    client.get<QueueRow[]>(`/claims/search?${p.toString()}`, 'org')
      .then((r) => { setRows(r); setActive((a) => (a ? { ...a, count: r.length } : a)); })
      .catch((e) => setError(e.message)).finally(() => setQLoading(false));
  };
  const tilesJoined = !loading && !!data && arrangedTiles.length > 0;
  const clear = () => { setF({ ...EMPTY }); setActive(null); };
  const upd = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Shell title="میز کار" sectionLabel="میز کار" nav={ORG_NAV} realm="org"
      action={
        <span className="flex items-center gap-2">
          {data?.roleLabel && <span className="badge badge-neutral whitespace-nowrap">نقش: {data.roleLabel}</span>}
          {canFile && (
            <Link href="/org/claims/new" className="btn btn-solid btn-sm" title="ثبت پرونده خسارت جدید">
              <Icon path="M12 5v14M5 12h14" />
              <span className="hidden sm:inline">پرونده جدید</span>
            </Link>
          )}
        </span>
      }>
      <ErrorBox message={error} />

      {/* ── Search panel ── (queue tiles attach flush underneath) */}
      <div className={`pcard p-5 pform mb-5 ${tilesJoined ? 'wd-search-joined' : ''}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input className="input" placeholder="شماره بیمه‌نامه" value={f.policyNumber} onChange={upd('policyNumber')} style={{ direction: 'ltr', textAlign: 'right' }} />
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
            <select className="input" value={f.beneficiaryType} onChange={(e) => setF({ ...f, beneficiaryType: e.target.value })}>
              <option value="">— نوع ذینفع —</option>
              {BENEFICIARY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="input" value={f.docCode} onChange={(e) => setF({ ...f, docCode: e.target.value })} title="جستجو بر اساس نوع مدرک (همهٔ انواع پرونده)">
              <option value="">— نوع مدرک —</option>
              {docTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
            <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <RangeSlider label="مبلغ خسارت برآوردی" min={f.estMin} max={f.estMax} onChange={(a, b) => setF((s) => ({ ...s, estMin: a, estMax: b }))} />
              <RangeSlider label="مبلغ خسارت قطعی" min={f.finMin} max={f.finMax} onChange={(a, b) => setF((s) => ({ ...s, finMin: a, finMax: b }))} />
            </div>
          </div>
        )}

        {/* Phones: wrap and centre; from sm up: advanced toggle on the side, buttons centred. */}
        <div className="flex flex-wrap justify-center sm:grid items-center gap-2 mt-4" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <span>
            <button onClick={() => setAdv((a) => !a)} className="btn btn-ghost btn-sm">
              <Icon path={adv ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /> جستجوی پیشرفته
            </button>
          </span>
          <div className="flex items-center gap-2">
            <button onClick={runSearch} className="btn btn-solid btn-sm px-6">جستجو</button>
            <button onClick={clear} className="btn btn-ghost btn-sm">پاک کردن</button>
          </div>
          <span />
        </div>
      </div>

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
            <div className="pcard p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>همهٔ برگه‌ها پنهان شده‌اند. از «شخصی‌سازی میز کار» در منو می‌توانید دوباره نمایش دهید.</div>
          ) : (
          <div className="wd-tiles wd-tiles-joined">
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
              <div className="flex items-center justify-between gap-2 p-4 border-b flex-wrap" style={{ borderColor: 'var(--border)' }}>
                <h3 className="font-extrabold">{active.label} <span style={{ color: 'var(--muted)' }}>({fa(active.count)})</span></h3>
                <span className="flex items-center gap-2">
                  {picked.size > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>{fa(picked.size)} انتخاب‌شده</span>}
                  <button onClick={exportExcel} disabled={!rows.length || exporting} className="wd-xls" title={picked.size ? 'خروجی اکسل ردیف‌های انتخاب‌شده' : 'خروجی اکسل همهٔ ردیف‌های این برگه'} aria-label="خروجی اکسل">
                    <svg viewBox="0 0 24 24" aria-hidden><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8.5 12.5l4 5M12.5 12.5l-4 5" /></svg>
                    <span>{exporting ? '…' : 'اکسل'}</span>
                  </button>
                  <button onClick={() => setActive(null)} className="btn btn-ghost btn-sm">بستن</button>
                </span>
              </div>
              {qLoading ? (
                <div className="p-12 flex justify-center"><FancyLoader label="در حال دریافت صف…" /></div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>موردی یافت نشد.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr>
                      <th style={{ width: 44 }}>
                        <input type="checkbox" aria-label="انتخاب همهٔ ردیف‌های این صفحه" checked={pageRows.length > 0 && pageRows.every((r) => picked.has(r.id))}
                          onChange={(e) => setPicked((cur) => { const n = new Set(cur); pageRows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} />
                      </th>
                      {['#', 'کد ملی متوفی', 'نوع', 'بیمه‌گر', 'بیمه‌شده (متوفی)', 'مبلغ (ریال)', 'وضعیت', 'عملیات'].map((h) => <th key={h}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {/* Rows don't open on click (too many mis-clicks) — only the «مشاهده» / «ارزیابی» buttons do. */}
                      {pageRows.map((r, i) => (
                        <tr key={r.id} className={picked.has(r.id) ? 'is-picked' : undefined}>
                          <td><input type="checkbox" aria-label={`انتخاب ردیف ${fa((page - 1) * pageSize + i + 1)}`} checked={picked.has(r.id)}
                            onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                          <td>{fa((page - 1) * pageSize + i + 1)}</td>
                          <td className="font-semibold" style={{ direction: 'ltr', textAlign: 'right' }} title={caseTitle(r)}>{r.deceasedNationalCode || '—'}</td>
                          <td><ClaimTypeBadge type={r.claimType} /></td>
                          <td>{(r.insurerTenantId && insurerMap[r.insurerTenantId]) || '—'}</td>
                          <td>{r.deceasedName || '—'}</td>
                          <td style={{ direction: 'ltr', textAlign: 'right' }}>
                            {Number(r.payableAmount || r.claimedAmount || 0).toLocaleString('fa-IR')}
                            {r.finalizedAmount ? <span className="badge badge-success mr-1" style={{ fontSize: '0.6rem' }}>قطعی</span> : null}
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                          <td>
                            <span className="flex items-center gap-1.5">
                              <button onClick={() => router.push(`/org/claims/${r.id}`)} className="btn btn-ghost btn-sm">مشاهده</button>
                              <button onClick={() => router.push(`/org/claims/${r.id}/assess`)} className="btn btn-solid btn-sm">ارزیابی</button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Pagination */}
              {!qLoading && rows.length > 0 && (
                <div className="wd-pager">
                  <span className="flex items-center gap-2">
                    <span>نمایش در هر صفحه:</span>
                    <select className="input" style={{ width: 'auto', padding: '4px 10px' }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                      {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{fa(n)}</option>)}
                    </select>
                    <span>مجموع: {fa(rows.length)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-ghost btn-sm">قبلی</button>
                    <span>صفحه {fa(page)} از {fa(Math.max(1, Math.ceil(rows.length / pageSize)))}</span>
                    <button onClick={() => setPage((p) => Math.min(Math.ceil(rows.length / pageSize), p + 1))} disabled={page >= Math.ceil(rows.length / pageSize)} className="btn btn-ghost btn-sm">بعدی</button>
                  </span>
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
        <Overlay onClose={closeSettings}>
          <div className="pmodal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">شخصی‌سازی برگه‌های میز کار</span>
              <button className="pmodal-x" onClick={closeSettings} aria-label="بستن">×</button>
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
              <button onClick={closeSettings} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>تمام</button>
            </div>
          </div>
        </Overlay>
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
