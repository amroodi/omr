'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken, hasPerm } from '../../../lib/client';
import { downloadPdf } from '../../../lib/pdf';
import { Shell, Icon } from '../../components/Shell';
import { ErrorBox, FancyLoader } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { ORG_NAV } from '../nav';

type ColType = 'text' | 'number' | 'amount' | 'date';
interface Col { key: string; label: string; group: string; type: ColType }
type Row = Record<string, string | number | null>;
type Agg = 'sum' | 'avg' | 'min' | 'max';
interface Rule { col: string; op: string; value: string; value2?: string }
interface ReportDef {
  name: string; columns: string[]; rules: Rule[]; groupBy: string; groupDate: 'day' | 'month' | 'year';
  measures: { col: string; agg: Agg }[]; sortBy: string; sortDir: 'asc' | 'desc'; search: string;
}

const AGG_FA: Record<Agg, string> = { sum: 'جمع', avg: 'میانگین', min: 'کمینه', max: 'بیشینه' };
const OPS: Record<ColType, [string, string][]> = {
  text: [['has', 'شامل'], ['eq', 'برابر با'], ['neq', 'مخالف'], ['empty', 'خالی باشد'], ['filled', 'پر باشد']],
  number: [['eq', '='], ['gte', '≥'], ['lte', '≤'], ['between', 'بین'], ['empty', 'خالی باشد']],
  amount: [['gte', '≥'], ['lte', '≤'], ['between', 'بین'], ['eq', '='], ['empty', 'خالی باشد']],
  date: [['between', 'بین دو تاریخ'], ['gte', 'از تاریخ'], ['lte', 'تا تاریخ'], ['empty', 'خالی باشد'], ['filled', 'پر باشد']],
};
const BASE_COLS = ['policyNumber', 'deceasedName', 'company', 'insurer', 'status', 'stage', 'createdAt', 'payableAmount'];

/** Ready-made reports; each is just a saved builder setup. */
const PRESETS: ReportDef[] = [
  { name: 'فهرست کامل پرونده‌ها', columns: BASE_COLS, rules: [], groupBy: '', groupDate: 'month', measures: [], sortBy: 'createdAt', sortDir: 'desc', search: '' },
  { name: 'پرونده‌های پرداخت‌شده', columns: ['policyNumber', 'deceasedName', 'company', 'insurer', 'eventDate', 'paidDate', 'daysOpen', 'payableAmount'], rules: [{ col: 'status', op: 'eq', value: 'پرداخت‌شده' }], groupBy: '', groupDate: 'month', measures: [], sortBy: 'paidDate', sortDir: 'desc', search: '' },
  { name: 'پرونده‌های در جریان به تفکیک مرحله', columns: [], rules: [{ col: 'stage', op: 'neq', value: 'بسته‌شده' }], groupBy: 'stage', groupDate: 'month', measures: [{ col: 'estimatedAmount', agg: 'sum' }, { col: 'daysOpen', agg: 'avg' }], sortBy: '__count', sortDir: 'desc', search: '' },
  { name: 'خسارت‌ها به تفکیک بیمه‌گر', columns: [], rules: [], groupBy: 'insurer', groupDate: 'month', measures: [{ col: 'payableAmount', agg: 'sum' }, { col: 'payableAmount', agg: 'avg' }], sortBy: '__count', sortDir: 'desc', search: '' },
  { name: 'خسارت‌ها به تفکیک بیمه‌گزار', columns: [], rules: [], groupBy: 'company', groupDate: 'month', measures: [{ col: 'payableAmount', agg: 'sum' }, { col: 'daysOpen', agg: 'avg' }], sortBy: '__count', sortDir: 'desc', search: '' },
  { name: 'روند ماهانهٔ ثبت پرونده', columns: [], rules: [], groupBy: 'createdAt', groupDate: 'month', measures: [{ col: 'estimatedAmount', agg: 'sum' }], sortBy: '__group', sortDir: 'asc', search: '' },
  { name: 'پرونده‌های دارای مدارک ناقص', columns: ['policyNumber', 'deceasedName', 'company', 'stage', 'docsRequired', 'docsUploaded', 'docsMissing', 'openDeficiencies'], rules: [{ col: 'docsMissing', op: 'gte', value: '1' }], groupBy: '', groupDate: 'month', measures: [], sortBy: 'docsMissing', sortDir: 'desc', search: '' },
  { name: 'اعلام خارج از مهلت', columns: ['policyNumber', 'deceasedName', 'company', 'insurer', 'eventDate', 'createdAt', 'noticeDeadline'], rules: [{ col: 'lateNotice', op: 'eq', value: 'بله' }], groupBy: '', groupDate: 'month', measures: [], sortBy: 'createdAt', sortDir: 'desc', search: '' },
];
const SAVED_KEY = 'omr_reports';

const fa = (n: number) => n.toLocaleString('fa-IR');
const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const ascii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const numOf = (v: unknown) => { const n = typeof v === 'number' ? v : Number(ascii(String(v ?? '')).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };

function show(v: string | number | null | undefined, t: ColType): string {
  if (v == null || v === '') return '—';
  if (t === 'amount') { const n = numOf(v); return n == null ? String(v) : `${fa(Math.round(n))} ریال`; }
  if (t === 'number') { const n = numOf(v); return n == null ? String(v) : fa(Math.round(n * 10) / 10); }
  if (t === 'date') return faD(String(v));
  return String(v);
}

function matches(r: Row, rule: Rule, type: ColType): boolean {
  const v = r[rule.col];
  const empty = v == null || v === '';
  if (rule.op === 'empty') return empty;
  if (rule.op === 'filled') return !empty;
  if (empty) return false;
  if (type === 'date') {
    const s = ascii(String(v)); const a = ascii(rule.value || ''); const b = ascii(rule.value2 || '');
    if (rule.op === 'gte') return !a || s >= a;
    if (rule.op === 'lte') return !a || s <= a;
    if (rule.op === 'between') return (!a || s >= a) && (!b || s <= b);
    return true;
  }
  if (type === 'number' || type === 'amount') {
    const n = numOf(v); const a = numOf(rule.value); const b = numOf(rule.value2);
    if (n == null) return false;
    if (rule.op === 'eq') return a == null || n === a;
    if (rule.op === 'gte') return a == null || n >= a;
    if (rule.op === 'lte') return a == null || n <= a;
    if (rule.op === 'between') return (a == null || n >= a) && (b == null || n <= b);
    return true;
  }
  const s = String(v); const q = (rule.value || '').trim();
  if (!q) return true;
  if (rule.op === 'eq') return s === q;
  if (rule.op === 'neq') return s !== q;
  return s.includes(q);
}

/**
 * «گزارش‌گیری» — report builder over every case the organization can see: pick columns, filter with
 * rules, group (dates by day/month/year) with sums/averages, sort, search, chart the groups and export
 * to Excel, CSV or PDF. Ready-made reports are presets; your own setups are saved in this browser.
 */
export default function ReportsPage() {
  const router = useRouter();
  const [cols, setCols] = useState<Col[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [stamp, setStamp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [def, setDef] = useState<ReportDef>(PRESETS[0]);
  const [saved, setSaved] = useState<ReportDef[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [canExport, setCanExport] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true); setError('');
    client.get<{ columns: Col[]; rows: Row[]; generatedAt: string }>('/claims/report-data', 'org')
      .then((d) => { setCols(d.columns); setRows(d.rows); setStamp(d.generatedAt); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    setCanExport(hasPerm('org', 'export:list'));
    try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch { /* ignore */ }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setPage(1); }, [def]);

  const colMap = useMemo(() => Object.fromEntries(cols.map((c) => [c.key, c])), [cols]);
  const typeOf = (k: string): ColType => colMap[k]?.type ?? 'text';
  const groups = useMemo(() => [...new Set(cols.map((c) => c.group))], [cols]);
  const upd = (p: Partial<ReportDef>) => setDef((d) => ({ ...d, ...p }));

  // 1) filter
  const filtered = useMemo(() => {
    const q = def.search.trim();
    const visible = def.columns.length ? def.columns : BASE_COLS;
    return rows.filter((r) => def.rules.every((rule) => !rule.col || matches(r, rule, typeOf(rule.col)))
      && (!q || visible.some((k) => String(r[k] ?? '').includes(q) || faD(String(r[k] ?? '')).includes(q))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, def.rules, def.search, def.columns, colMap]);

  // 2) group (optional)
  const grouped = useMemo(() => {
    if (!def.groupBy) return null;
    const t = typeOf(def.groupBy);
    const keyOf = (r: Row) => {
      const v = r[def.groupBy];
      if (v == null || v === '') return '(خالی)';
      if (t === 'date') { const s = ascii(String(v)); return def.groupDate === 'year' ? s.slice(0, 4) : def.groupDate === 'month' ? s.slice(0, 7) : s; }
      return String(v);
    };
    const m = new Map<string, Row[]>();
    filtered.forEach((r) => { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); });
    const out = [...m].map(([g, list]) => {
      const row: Row = { __group: g, __count: list.length };
      def.measures.forEach((ms, i) => {
        const nums = list.map((r) => numOf(r[ms.col])).filter((n): n is number => n != null);
        row[`__m${i}`] = !nums.length ? null : ms.agg === 'sum' ? nums.reduce((a, b) => a + b, 0) : ms.agg === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : ms.agg === 'min' ? Math.min(...nums) : Math.max(...nums);
      });
      return row;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, def.groupBy, def.groupDate, def.measures, colMap]);

  // 3) sort
  const table = useMemo(() => {
    const list = [...(grouped ?? filtered)];
    const k = def.sortBy;
    if (k) {
      const t = k.startsWith('__') ? (k === '__group' ? typeOf(def.groupBy) : 'number') : typeOf(k);
      list.sort((a, b) => {
        const x = a[k]; const y = b[k];
        if (x == null || x === '') return 1; if (y == null || y === '') return -1;
        const c = t === 'number' || t === 'amount' ? (numOf(x) ?? 0) - (numOf(y) ?? 0) : ascii(String(x)).localeCompare(ascii(String(y)), 'fa');
        return def.sortDir === 'asc' ? c : -c;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, filtered, def.sortBy, def.sortDir, def.groupBy, colMap]);

  // Headings + cell renderers for the current view
  const view: { key: string; label: string; type: ColType }[] = grouped
    ? [
        { key: '__group', label: colMap[def.groupBy]?.label ?? 'گروه', type: typeOf(def.groupBy) === 'date' ? 'date' : 'text' },
        { key: '__count', label: 'تعداد پرونده', type: 'number' },
        ...def.measures.map((m, i) => ({ key: `__m${i}`, label: `${AGG_FA[m.agg]} ${colMap[m.col]?.label ?? m.col}`, type: (typeOf(m.col) === 'amount' ? 'amount' : 'number') as ColType })),
      ]
    : (def.columns.length ? def.columns : BASE_COLS).filter((k) => colMap[k]).map((k) => ({ key: k, label: colMap[k].label, type: colMap[k].type }));

  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(table.length / PAGE));
  const shown = table.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const totals = view.filter((v) => v.type === 'amount' && !grouped).map((v) => ({ label: v.label, sum: filtered.reduce((a, r) => a + (numOf(r[v.key]) ?? 0), 0) }));
  const maxCount = grouped ? Math.max(1, ...grouped.map((g) => Number(g.__count))) : 1;

  const describe = () => {
    const parts = def.rules.filter((r) => r.col).map((r) => `${colMap[r.col]?.label ?? r.col} ${OPS[typeOf(r.col)].find(([o]) => o === r.op)?.[1] ?? r.op} ${r.value ? faD(r.value) : ''}${r.value2 ? ` تا ${faD(r.value2)}` : ''}`.trim());
    if (def.search.trim()) parts.push(`جستجو: ${def.search.trim()}`);
    if (def.groupBy) parts.push(`گروه‌بندی: ${colMap[def.groupBy]?.label ?? def.groupBy}`);
    return parts.join(' — ');
  };
  const cellsOf = (r: Row) => view.map((v) => {
    const x = r[v.key];
    if (v.type === 'amount' || v.type === 'number') return numOf(x) == null ? null : Math.round((numOf(x) as number) * 100) / 100;
    return x == null ? null : String(x);
  });

  const exportXlsx = async () => {
    setBusy('xlsx'); setError('');
    try { await client.downloadPost('/exports/table.xlsx', { title: def.name, subtitle: describe() || undefined, headers: view.map((v) => v.label), rows: table.map(cellsOf) }, 'org', 'report.xlsx'); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const exportCsv = () => {
    const esc = (s: unknown) => { const t = s == null ? '' : String(s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = [view.map((v) => esc(v.label)).join(','), ...table.map((r) => cellsOf(r).map(esc).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'report.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!sheet.current) return;
    setBusy('pdf'); setError('');
    try { await downloadPdf(sheet.current, 'report'); } catch (e: any) { setError(e?.message || 'ساخت PDF ممکن نشد'); } finally { setBusy(''); }
  };

  const saveDef = () => {
    const name = window.prompt('نام این گزارش:', def.name);
    if (!name?.trim()) return;
    const next = [...saved.filter((s) => s.name !== name.trim()), { ...def, name: name.trim() }];
    setSaved(next); upd({ name: name.trim() });
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const removeSaved = (name: string) => {
    const next = saved.filter((s) => s.name !== name); setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggleCol = (k: string) => upd({ columns: (def.columns.length ? def.columns : BASE_COLS).includes(k) ? (def.columns.length ? def.columns : BASE_COLS).filter((x) => x !== k) : [...(def.columns.length ? def.columns : BASE_COLS), k] });
  const moveCol = (k: string, dir: -1 | 1) => {
    const list = [...(def.columns.length ? def.columns : BASE_COLS)]; const i = list.indexOf(k); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; upd({ columns: list });
  };
  const setRule = (i: number, p: Partial<Rule>) => upd({ rules: def.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const numericCols = cols.filter((c) => c.type === 'amount' || c.type === 'number');
  const selected = def.columns.length ? def.columns : BASE_COLS;

  return (
    <Shell title="گزارش‌گیری" sectionLabel="گزارش‌گیری" nav={ORG_NAV} realm="org"
      action={<button onClick={load} className="btn btn-ghost btn-sm" disabled={loading} title="دریافت دوبارهٔ داده‌ها"><Icon path="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /> به‌روزرسانی</button>}>
      <ErrorBox message={error} />
      {loading ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال آماده‌سازی داده‌های گزارش…" /></div> : (
        <div className="rp-wrap">
          {/* Ready-made and saved reports */}
          <div className="pcard p-4">
            <div className="rp-label">گزارش‌های آماده</div>
            <div className="rp-chips">
              {PRESETS.map((p) => <button key={p.name} type="button" className={`rp-chip${def.name === p.name ? ' is-on' : ''}`} onClick={() => setDef(p)}>{p.name}</button>)}
            </div>
            {saved.length > 0 && (
              <>
                <div className="rp-label mt-3">گزارش‌های ذخیره‌شدهٔ من</div>
                <div className="rp-chips">
                  {saved.map((p) => (
                    <span key={p.name} className={`rp-chip is-saved${def.name === p.name ? ' is-on' : ''}`}>
                      <button type="button" onClick={() => setDef(p)}>{p.name}</button>
                      <button type="button" className="rp-x" onClick={() => removeSaved(p.name)} aria-label={`حذف ${p.name}`}>×</button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Builder */}
          <div className="pcard p-4 rp-builder">
            <div className="rp-row">
              <label className="rp-field rp-grow"><span>عنوان گزارش</span><input className="input" value={def.name} onChange={(e) => upd({ name: e.target.value })} /></label>
              <label className="rp-field rp-grow"><span>جستجو در ستون‌های گزارش</span><input className="input" value={def.search} onChange={(e) => upd({ search: e.target.value })} placeholder="مثلاً نام، شماره بیمه‌نامه، شرکت…" /></label>
            </div>

            <div className="rp-section">
              <div className="rp-section-h">
                <span>فیلترها</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd({ rules: [...def.rules, { col: 'createdAt', op: 'between', value: '', value2: '' }] })}>+ افزودن فیلتر</button>
              </div>
              {def.rules.length === 0 && <div className="rp-muted">بدون فیلتر — همهٔ پرونده‌ها در گزارش هستند.</div>}
              {def.rules.map((r, i) => {
                const t = typeOf(r.col);
                const needs = !['empty', 'filled'].includes(r.op);
                const options = [...new Set(rows.map((x) => x[r.col]).filter((v) => v != null && v !== '').map(String))].slice(0, 60);
                return (
                  <div key={i} className="rp-rule">
                    <select className="input" value={r.col} onChange={(e) => setRule(i, { col: e.target.value, op: OPS[typeOf(e.target.value)][0][0], value: '', value2: '' })}>
                      {groups.map((g) => <optgroup key={g} label={g}>{cols.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
                    </select>
                    <select className="input rp-op" value={r.op} onChange={(e) => setRule(i, { op: e.target.value })}>
                      {OPS[t].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {needs && (t === 'date' ? (
                      <>
                        <JalaliDatePicker value={r.value} onChange={(v) => setRule(i, { value: ascii(v) })} placeholder={r.op === 'lte' ? 'تا تاریخ' : 'از تاریخ'} />
                        {r.op === 'between' && <JalaliDatePicker value={r.value2 || ''} onChange={(v) => setRule(i, { value2: ascii(v) })} placeholder="تا تاریخ" />}
                      </>
                    ) : t === 'text' ? (
                      <>
                        <input className="input" list={`rp-opt-${i}`} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} placeholder="مقدار" />
                        <datalist id={`rp-opt-${i}`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
                      </>
                    ) : (
                      <>
                        <input className="input" inputMode="numeric" value={r.value} onChange={(e) => setRule(i, { value: ascii(e.target.value) })} placeholder={r.op === 'between' ? 'از' : 'مقدار'} />
                        {r.op === 'between' && <input className="input" inputMode="numeric" value={r.value2 || ''} onChange={(e) => setRule(i, { value2: ascii(e.target.value) })} placeholder="تا" />}
                      </>
                    ))}
                    <button type="button" className="rp-x" onClick={() => upd({ rules: def.rules.filter((_, j) => j !== i) })} aria-label="حذف فیلتر">×</button>
                  </div>
                );
              })}
            </div>

            <div className="rp-section">
              <div className="rp-section-h"><span>گروه‌بندی و محاسبه</span></div>
              <div className="rp-row">
                <label className="rp-field"><span>گروه‌بندی بر اساس</span>
                  <select className="input" value={def.groupBy} onChange={(e) => upd({ groupBy: e.target.value, sortBy: e.target.value ? '__count' : 'createdAt', sortDir: 'desc' })}>
                    <option value="">— بدون گروه‌بندی (فهرست پرونده‌ها) —</option>
                    {groups.map((g) => <optgroup key={g} label={g}>{cols.filter((c) => c.group === g && c.type !== 'amount').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
                  </select>
                </label>
                {def.groupBy && typeOf(def.groupBy) === 'date' && (
                  <label className="rp-field"><span>بازهٔ زمانی</span>
                    <select className="input" value={def.groupDate} onChange={(e) => upd({ groupDate: e.target.value as ReportDef['groupDate'] })}>
                      <option value="day">روزانه</option><option value="month">ماهانه</option><option value="year">سالانه</option>
                    </select>
                  </label>
                )}
              </div>
              {def.groupBy && (
                <div className="mt-2 space-y-2">
                  {def.measures.map((m, i) => (
                    <div key={i} className="rp-rule">
                      <select className="input rp-op" value={m.agg} onChange={(e) => upd({ measures: def.measures.map((x, j) => (j === i ? { ...x, agg: e.target.value as Agg } : x)) })}>
                        {(Object.keys(AGG_FA) as Agg[]).map((a) => <option key={a} value={a}>{AGG_FA[a]}</option>)}
                      </select>
                      <select className="input" value={m.col} onChange={(e) => upd({ measures: def.measures.map((x, j) => (j === i ? { ...x, col: e.target.value } : x)) })}>
                        {numericCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                      <button type="button" className="rp-x" onClick={() => upd({ measures: def.measures.filter((_, j) => j !== i) })} aria-label="حذف محاسبه">×</button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd({ measures: [...def.measures, { col: 'payableAmount', agg: 'sum' }] })}>+ افزودن محاسبه (جمع، میانگین…)</button>
                </div>
              )}
            </div>

            {!def.groupBy && (
              <div className="rp-section">
                <div className="rp-section-h">
                  <span>ستون‌های گزارش ({fa(selected.length)})</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCols((s) => !s)}>{showCols ? 'بستن' : 'انتخاب ستون‌ها'}</button>
                </div>
                <div className="rp-chips">
                  {selected.filter((k) => colMap[k]).map((k) => (
                    <span key={k} className="rp-chip is-col">
                      <button type="button" onClick={() => moveCol(k, -1)} aria-label="جابه‌جایی به راست">›</button>
                      {colMap[k].label}
                      <button type="button" onClick={() => moveCol(k, 1)} aria-label="جابه‌جایی به چپ">‹</button>
                      <button type="button" className="rp-x" onClick={() => toggleCol(k)} aria-label={`حذف ستون ${colMap[k].label}`}>×</button>
                    </span>
                  ))}
                </div>
                {showCols && (
                  <div className="rp-colpick">
                    {groups.map((g) => (
                      <div key={g}>
                        <div className="rp-label">{g}</div>
                        {cols.filter((c) => c.group === g).map((c) => (
                          <label key={c.key} className="rp-check"><input type="checkbox" checked={selected.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}</label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rp-row rp-end">
              <label className="rp-field"><span>مرتب‌سازی</span>
                <select className="input" value={def.sortBy} onChange={(e) => upd({ sortBy: e.target.value })}>
                  {view.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
              </label>
              <label className="rp-field"><span>ترتیب</span>
                <select className="input" value={def.sortDir} onChange={(e) => upd({ sortDir: e.target.value as 'asc' | 'desc' })}>
                  <option value="desc">نزولی</option><option value="asc">صعودی</option>
                </select>
              </label>
              <span className="rp-grow" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={saveDef}><Icon path="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8" /> ذخیرهٔ این گزارش</button>
            </div>
          </div>

          {/* Result */}
          <div ref={sheet} className="pcard p-4 rp-result">
            <div className="rp-result-h">
              <div>
                <div className="font-extrabold text-lg">{def.name}</div>
                <div className="rp-muted">{describe() || 'همهٔ پرونده‌ها'} — تهیه‌شده: {stamp}</div>
              </div>
              <div className="rp-actions no-pdf">
                {canExport && <button type="button" className="btn btn-solid btn-sm" onClick={exportXlsx} disabled={!!busy || !table.length}><Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /> {busy === 'xlsx' ? '…' : 'اکسل'}</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!table.length}>CSV</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={exportPdf} disabled={!!busy || !table.length}>{busy === 'pdf' ? '…' : 'PDF'}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>چاپ</button>
              </div>
            </div>

            <div className="rp-stats">
              <span className="rp-stat"><b>{fa(filtered.length)}</b> پرونده</span>
              {grouped && <span className="rp-stat"><b>{fa(grouped.length)}</b> گروه</span>}
              {totals.map((t) => <span key={t.label} className="rp-stat">جمع {t.label}: <b>{fa(Math.round(t.sum))}</b> ریال</span>)}
            </div>

            {grouped && grouped.length > 0 && (
              <div className="rp-chart" aria-label="نمودار تعداد پرونده در هر گروه">
                {table.slice(0, 24).map((g) => (
                  <div key={String(g.__group)} className="rp-bar-row">
                    <span className="rp-bar-l" title={String(g.__group)}>{show(g.__group, view[0].type)}</span>
                    <span className="rp-bar"><span style={{ width: `${(Number(g.__count) / maxCount) * 100}%` }} /></span>
                    <span className="rp-bar-v">{fa(Number(g.__count))}</span>
                  </div>
                ))}
              </div>
            )}

            {table.length === 0 ? <div className="rp-muted text-center py-10">پرونده‌ای با این شرایط پیدا نشد.</div> : (
              <div className="overflow-x-auto">
                <table className="table rp-table">
                  <thead><tr><th>#</th>{view.map((v) => (
                    <th key={v.key} onClick={() => upd({ sortBy: v.key, sortDir: def.sortBy === v.key && def.sortDir === 'desc' ? 'asc' : 'desc' })} style={{ cursor: 'pointer' }} title="مرتب‌سازی">
                      {v.label}{def.sortBy === v.key ? (def.sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}</tr></thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i}>
                        <td>{fa((Math.min(page, pages) - 1) * PAGE + i + 1)}</td>
                        {view.map((v) => <td key={v.key} className={v.type === 'amount' || v.type === 'number' || v.type === 'date' ? 'rp-num' : ''}>{show(r[v.key], v.type)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-3 no-pdf">
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
                <span className="rp-muted">صفحه {fa(Math.min(page, pages))} از {fa(pages)} — خروجی‌ها همهٔ ردیف‌ها را دارند</span>
                <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
