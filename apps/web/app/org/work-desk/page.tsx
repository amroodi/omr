'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { assistInfo, client, getToken, hasPerm, orgMode } from '../../../lib/client';
import { useKinds } from '../../../lib/line';
import { Shell, Icon } from '../../components/Shell';
import { ORG_NAV } from '../nav';
import { CLAIM_TYPE_LABELS, claimTypeLabel, ErrorBox, FancyLoader, NoticeModal, Overlay, STATUS_MAP, StatusBadge } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { RangeSlider } from '../../components/RangeSlider';
import { toGregorian } from 'jalaali-js';
import { caseTitle } from '../../../lib/caseTitle';
import { INSURED_RELATIONS } from '../../components/claim-wording';

interface Tile { key: string; label: string; count: number; actionable: boolean; href?: string }
interface WorkDesk { userName: string | null; role: string; roleLabel: string; tiles: Tile[]; sinad?: boolean; summary: { pendingActions: number; queues: number } }
interface QueueRow { id: string; claimNumber: string; policyNumber?: string | null; deceasedNationalCode?: string | null; status: string; claimType: string; deceasedName: string | null; claimedAmount: string; payableAmount?: string; finalizedAmount?: string | null; insurerTenantId?: string; claimTypeLabel?: string | null; lineLabel?: string | null; insuredRelation?: string | null; mainInsuredName?: string | null; mainInsuredNationalCode?: string | null; companyName?: string | null; policyStart?: string | null; policyEnd?: string | null; needsAction?: boolean; evaluatorName?: string | null; doctorNote?: string | null }

const fa = (n: number) => n.toLocaleString('fa-IR');
const EMPTY = {
  policyNumber: '', mainNationalCode: '', subNationalCode: '', deceasedName: '', claimType: '', line: '', insurerTenantId: '',
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
  const [caseTypes, setCaseTypes] = useState<Record<string, string>>(CLAIM_TYPE_LABELS);
  const kinds = useKinds({ all: true }); // نوع بیمه‌نامه filter (panel 2 sees every kind)
  useEffect(() => { client.get<{ code: string; label: string }[]>('/claims/case-types', 'org').then((l) => { if (l.length) setCaseTypes(Object.fromEntries(l.map((t) => [t.code, t.label]))); }).catch(() => {}); }, []);
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
  // «پرونده جدید» needs claim:file and panel 1; panel 1 has no «ارزیابی». Resolved after mount to avoid
  // an SSR/client hydration mismatch.
  const [canFile, setCanFile] = useState(false);
  const [entry, setEntry] = useState(false);
  useEffect(() => { const e = orgMode() === 'ENTRY'; setEntry(e); setCanFile((e || !!assistInfo('org')) && hasPerm('org', 'claim:file')); }, []);

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<{ code: string; label: string }[]>('/claims/doc-types', 'org').then(setDocTypes).catch(() => {});
    client.get<WorkDesk>('/claims/work-desk', 'org')
      .then((d) => {
        setData(d);
        // «روند سیناد» (Alborz): the same میز کار, with Sinad's stage tiles (the kartable) in place of ours.
        if (d.sinad && orgMode() !== 'ENTRY') loadSinadTiles(d);
        // Post-login summary tip — once per login (the token's session id), in any tab, only if something awaits action.
        try {
          const tok = getToken('org') ?? '';
          const sid = (JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sid?: string }).sid || tok.slice(-24);
          if (d.summary.pendingActions > 0 && localStorage.getItem('wdTipSeen') !== sid) {
            setTip(true); localStorage.setItem('wdTipSeen', sid);
          }
        } catch { /* private mode */ }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then((a) => setInsurers(a)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «روند سیناد»: tiles come from the kartable; keys are `sinad:<tab>`.
  const [sinadPaused, setSinadPaused] = useState(false);
  const loadSinadTiles = (base?: WorkDesk) => client.get<{ enabled: boolean; paused?: boolean; tabs?: { key: string; label: string; count: number }[] }>('/claims/sinad/kartable', 'org')
    .then((k) => {
      if (!k.enabled || !k.tabs) return;
      setSinadPaused(!!k.paused);
      const tiles: Tile[] = k.tabs.map((t) => ({ key: `sinad:${t.key}`, label: t.label, count: t.count, actionable: true }));
      setData((cur) => { const d = base ?? cur; return d ? { ...d, tiles } : d; });
      setActive((a) => (a && a.key.startsWith('sinad:') ? { ...a, count: tiles.find((t) => t.key === a.key)?.count ?? a.count } : a));
    }).catch(() => {});
  const sinadTab = active?.key.startsWith('sinad:') ? active.key.slice(6) : null;
  const [busyOp, setBusyOp] = useState(false);
  const [opinion, setOpinion] = useState<{ id: string; name: string } | null>(null);
  const [opinionText, setOpinionText] = useState('');
  const sinadOp = async (id: string, op: string, body: Record<string, string> = {}) => {
    if (!active) return;
    setError(''); setBusyOp(true);
    try { await client.post(`/claims/${id}/sinad/${op}`, body, 'org'); openQueue(active); loadSinadTiles(); }
    catch (e: any) { setError(e.message); } finally { setBusyOp(false); }
  };

  const releaseBatch = async () => {
    if (!active) return;
    setError(''); setBusyOp(true);
    try { await client.post('/claims/sinad/release-batch', {}, 'org'); openQueue(active); }
    catch (e: any) { setError(e.message); } finally { setBusyOp(false); }
  };

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
        headers: ['ردیف', 'شماره پرونده', 'شماره بیمه‌نامه', 'آغاز پوشش', 'پایان پوشش', 'کد ملی', 'نسبت', 'کد ملی بیمه‌شده اصلی', 'نوع', 'بیمه‌گر', 'بیمه‌گزار', 'نام و نام خانوادگی', 'مبلغ (ریال)', 'وضعیت'],
        rows: list.map((r, i) => [String(i + 1), r.claimNumber, r.policyNumber ?? '', r.policyStart ?? '', r.policyEnd ?? '', r.deceasedNationalCode ?? '', INSURED_RELATIONS[r.insuredRelation ?? 'MAIN'], r.mainInsuredNationalCode ?? '', claimTypeLabel(r),
          (r.insurerTenantId && insurerMap[r.insurerTenantId]) || '', r.companyName ?? '', r.deceasedName ?? '', String(Number(r.payableAmount || r.claimedAmount || 0)), STATUS_MAP[r.status]?.label ?? r.status]),
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
    // «در انتظار ارزیابی اولیه» opens even when empty: opening it hands this evaluator the next batch.
    if (t.count === 0 && t.key !== 'sinad:evaluate') { setNotice('موردی برای این صف وجود ندارد.'); return; }
    setActive(t); setRows([]); setQLoading(true);
    const url = t.key.startsWith('sinad:') ? `/claims/sinad/kartable/${t.key.slice(6)}` : `/claims/work-desk/queue?key=${encodeURIComponent(t.key)}`;
    client.get<QueueRow[]>(url, 'org')
      .then((r) => {
        setRows(r);
        if (t.key === 'sinad:evaluate') { loadSinadTiles(); if (!r.length) setNotice(sinadPaused ? 'تخصیص پرونده به شما توسط مدیر متوقف شده است.' : 'پرونده‌ای در کارتابل شما نیست و پرونده‌ای هم در انتظار تخصیص نیست.'); }
      })
      .catch((e) => setError(e.message)).finally(() => setQLoading(false));
  };

  const runSearch = () => {
    const p = new URLSearchParams();
    const set = (k: string, v: string) => { if (v) p.set(k, v); };
    set('policyNumber', toAscii(f.policyNumber).trim());
    set('mainNationalCode', toAscii(f.mainNationalCode).replace(/\D/g, ''));
    set('subNationalCode', toAscii(f.subNationalCode).replace(/\D/g, ''));
    set('deceasedName', f.deceasedName.trim());
    set('claimType', f.claimType);
    set('line', f.line);
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
  const clear = () => { setF({ ...EMPTY }); setActive(null); };
  const upd = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Shell title="میز کار" sectionLabel="میز کار" nav={ORG_NAV} realm="org"
      action={
        <span className="flex items-center gap-2">
          {data?.roleLabel && <span className="badge badge-neutral whitespace-nowrap">نقش: {data.roleLabel}</span>}
          {data?.sinad && hasPerm('org', 'claim:override') && (
            <Link href="/org/allocation" className="btn btn-ghost btn-sm" title="تخصیص پرونده‌های شعبه به ارزیابان">تخصیص پرونده‌ها</Link>
          )}
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
      <div className="pcard p-5 pform sn-search">
        <div className="sn-fields">
          <input className="input" placeholder="شماره بیمه‌نامه" value={f.policyNumber} onChange={upd('policyNumber')} style={{ direction: 'ltr', textAlign: 'right' }} />
          <input className="input" placeholder="کد ملی بیمه‌شده اصلی" value={f.mainNationalCode} onChange={upd('mainNationalCode')} inputMode="numeric" title="پرونده‌های بیمه‌شدهٔ اصلی و زیرمجموعهٔ او" />
          <input className="input" placeholder="کد ملی بیمه‌شده فرعی" value={f.subNationalCode} onChange={upd('subNationalCode')} inputMode="numeric" title="فقط پرونده‌های همین همسر یا فرزند" />
          <input className="input" placeholder="نام بیمه‌شده" value={f.deceasedName} onChange={upd('deceasedName')} />
          <select className="input" value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })}>
            <option value="">— نوع پرونده —</option>
            {Object.entries(caseTypes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {/* نوع بیمه‌نامه: panel 2 sees every kind; this narrows the list to one. */}
          <select className="input" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} aria-label="نوع بیمه‌نامه">
            <option value="">— نوع بیمه‌نامه —</option>
            {kinds?.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
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
          <div className="sn-fields mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
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
            <div className="sn-wide grid grid-cols-1 lg:grid-cols-2 gap-2">
              <RangeSlider label="مبلغ خسارت برآوردی" min={f.estMin} max={f.estMax} onChange={(a, b) => setF((s) => ({ ...s, estMin: a, estMax: b }))} />
              <RangeSlider label="مبلغ خسارت قطعی" min={f.finMin} max={f.finMax} onChange={(a, b) => setF((s) => ({ ...s, finMin: a, finMax: b }))} />
            </div>
          </div>
        )}

        {/* Phones: wrap and centre; from sm up: advanced toggle on the side, buttons centred. */}
        <div className="flex flex-wrap justify-center sm:grid items-center gap-2 mt-2" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
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
          <div className={`wd-tiles sn-tabs${active ? ' has-open' : ''}`}>
            {arrangedTiles.map((t) => (
              <div
                key={t.key}
                className={`wd-tile ${t.count === 0 ? 'is-zero' : ''}${active?.key === t.key ? ' is-on' : ''}${t.actionable ? ' is-action' : ''}`}
                title={t.actionable ? `${t.label} — قابل اقدام شما` : t.label}
                onClick={() => openQueue(t)}
              >
                <div className="wd-tile-label">{t.label}</div>
                {revealed.includes(t.key) ? (
                  <div className="wd-tile-count" style={t.actionable && t.count > 0 ? { color: 'var(--brand)' } : undefined}>{t.count === 0 ? '—' : fa(t.count)}</div>
                ) : (
                  <div className="wd-tile-count" style={{ color: 'var(--muted)', opacity: 0.6 }} title="برای مشاهدهٔ تعداد کلیک کنید">···</div>
                )}
              </div>
            ))}
          </div>
          )}

          {/* Queue list for the selected tile */}
          {active && (
            <div className="sn-panel">
              <div className="sn-bar">
                <h3 className="font-bold">{active.label} <span style={{ color: 'var(--muted)' }}>({fa(active.count)})</span></h3>
                <span className="flex items-center gap-2">
                  {picked.size > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>{fa(picked.size)} انتخاب‌شده</span>}
                  <button onClick={exportExcel} disabled={!rows.length || exporting} className="wd-xls" title={picked.size ? 'خروجی اکسل ردیف‌های انتخاب‌شده' : 'خروجی اکسل همهٔ ردیف‌های این برگه'} aria-label="خروجی اکسل">
                    <svg viewBox="0 0 24 24" aria-hidden><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8.5 12.5l4 5M12.5 12.5l-4 5" /></svg>
                    <span>{exporting ? '…' : 'اکسل'}</span>
                  </button>
                  <button onClick={() => setActive(null)} className="btn btn-ghost btn-sm">بستن</button>
                </span>
              </div>
              {sinadTab === 'evaluate' && !qLoading && rows.some((r) => r.evaluatorName) && (
                <div className="sn-alloc">
                  پرونده‌های موجود در لیست زیر به شما تخصیص داده شده است و برای هیچ ارزیاب دیگری قابل مشاهده نیست؛ تا زمانی که بررسی این لیست به پایان نرسد، پروندهٔ جدید دیگری به شما تخصیص داده نخواهد شد.
                  <br />در صورتی که تمایل دارید پرونده‌های زیر از کارتابل شما خارج شود و پرونده‌های جدید دیگری دریافت کنید <button className="sn-alloc-link" disabled={busyOp} onClick={releaseBatch}>اینجا</button> را کلیک کنید.
                </div>
              )}
              {qLoading ? (
                <div className="p-12 flex justify-center"><FancyLoader label="در حال دریافت صف…" /></div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>موردی یافت نشد.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table sn-table">
                    <thead><tr>
                      <th style={{ width: 28 }}>
                        <input type="checkbox" aria-label="انتخاب همهٔ ردیف‌های این صفحه" checked={pageRows.length > 0 && pageRows.every((r) => picked.has(r.id))}
                          onChange={(e) => setPicked((cur) => { const n = new Set(cur); pageRows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} />
                      </th>
                      {['#', 'عملیات', 'نام و نام خانوادگی', 'کد ملی', 'نسبت', 'بیمه‌گزار', 'شماره بیمه‌نامه', 'نوع بیمه‌نامه', 'نوع پرونده', 'آغاز پوشش', 'پایان پوشش', 'مبلغ (ریال)', 'وضعیت', ...(sinadTab ? ['ارزیاب'] : []), ...(sinadTab === 'doctor' || sinadTab === 'exam' ? ['اظهار نظر پزشک معتمد'] : [])].map((h) => <th key={h}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {/* Rows don't open on click (too many mis-clicks) — only the «مشاهده» / «ارزیابی» buttons do. */}
                      {pageRows.map((r, i) => (
                        <tr key={r.id} className={picked.has(r.id) ? 'is-picked' : sinadTab === 'evaluate' && r.evaluatorName ? 'is-alloc' : undefined}>
                          <td><input type="checkbox" aria-label={`انتخاب ردیف ${fa((page - 1) * pageSize + i + 1)}`} checked={picked.has(r.id)}
                            onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                          <td>{fa((page - 1) * pageSize + i + 1)}</td>
                          <td>
                            <span className="flex items-center gap-1">
                              {sinadTab ? (
                                <>
                                  {r.needsAction && ['evaluate', 'later', 'final', 'returned', 'pay'].includes(sinadTab) && (
                                    <a href={`/org/claims/${r.id}/evaluate`} className="sn-act is-green">{sinadTab === 'final' ? 'ارزیابی نهایی' : sinadTab === 'returned' || sinadTab === 'pay' ? 'اقدام' : 'ارزیابی'}</a>
                                  )}
                                  {(sinadTab === 'doctor' || sinadTab === 'exam') && (
                                    <button className="sn-act" onClick={() => { setOpinionText(''); setOpinion({ id: r.id, name: r.deceasedName || r.claimNumber }); }}>اظهار نظر پزشک معتمد</button>
                                  )}
                                  {(sinadTab === 'evaluate' || sinadTab === 'later') && r.evaluatorName && (
                                    <button className="sn-act is-ghost" disabled={busyOp} onClick={() => sinadOp(r.id, 'release')} title="پرونده به پرونده‌های تخصیص‌نیافتهٔ شعبه برمی‌گردد">خارج کردن از کارتابل</button>
                                  )}
                                </>
                              ) : !entry && <a href={`/org/claims/${r.id}/assess`} target="_blank" rel="noopener" className="sn-act" title="باز شدن در زبانهٔ جدید">ارزیابی</a>}
                              <a href={`/org/claims/${r.id}`} target="_blank" rel="noopener" className="sn-act is-ghost" title="باز شدن در زبانهٔ جدید">مشاهده</a>
                            </span>
                          </td>
                          <td>{r.deceasedName || '—'}</td>
                          <td className="ltr-num" title={caseTitle(r)}>{r.deceasedNationalCode || '—'}</td>
                          <td title={r.mainInsuredName ? `بیمه‌شدهٔ اصلی: ${r.mainInsuredName} — ${r.mainInsuredNationalCode ?? ''}` : undefined}>{INSURED_RELATIONS[r.insuredRelation ?? 'MAIN']}</td>
                          <td>{r.companyName || '—'}</td>
                          <td className="ltr-num">{r.policyNumber || '—'}</td>
                          <td>{r.lineLabel || '—'}</td>
                          <td>{claimTypeLabel(r)}</td>
                          <td className="ltr-num">{r.policyStart || '—'}</td>
                          <td className="ltr-num">{r.policyEnd || '—'}</td>
                          <td className="ltr-num">
                            {Number(r.payableAmount || r.claimedAmount || 0).toLocaleString('fa-IR')}
                            {r.finalizedAmount ? <span className="badge badge-success mr-1" style={{ fontSize: '0.6rem' }}>قطعی</span> : null}
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                          {sinadTab && <td>{r.evaluatorName || '—'}</td>}
                          {(sinadTab === 'doctor' || sinadTab === 'exam') && <td>{r.doctorNote || '—'}</td>}
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

      {opinion && (
        <Overlay onClose={() => setOpinion(null)}>
          <div className="pmodal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">اظهار نظر پزشک معتمد — {opinion.name}</span>
              <button className="pmodal-x" onClick={() => setOpinion(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-2 text-sm">
              <textarea className="input" rows={5} maxLength={1000} value={opinionText} onChange={(e) => setOpinionText(e.target.value)} placeholder="نظر پزشک معتمد دربارهٔ پرونده (مثلاً درصد نقص عضو، ارتباط علت با حادثه)" />
              <div className="text-xs" style={{ color: 'var(--muted)' }}>پس از ثبت، پرونده به «در انتظار ارزیابی اولیه» ارزیاب خود برمی‌گردد.</div>
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setOpinion(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
              <button disabled={busyOp || !opinionText.trim()} onClick={() => { const o = opinion; setOpinion(null); sinadOp(o.id, 'doctor-opinion', { note: opinionText.trim() }); }} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>ثبت اظهار نظر</button>
            </div>
          </div>
        </Overlay>
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
          <p>در حال حاضر <b style={{ color: 'var(--brand)' }}>{fa(data.summary.pendingActions)}</b> مورد در میز کار شما در دست بررسی است (در <b>{fa(data.summary.queues)}</b> برگه).</p>
          <p className="mt-2" style={{ color: 'var(--muted)' }}>برای مشاهدهٔ هر صف، روی برگهٔ مربوط به آن در میز کار کلیک کنید.</p>
        </NoticeModal>
      )}
    </Shell>
  );
}
