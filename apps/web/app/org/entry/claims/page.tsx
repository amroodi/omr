'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { hasPerm } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { claimTypeLabel, ErrorBox, FancyLoader, STATUS_MAP } from '../../../components/ui';
import { CaseTable, MyClaim } from '../../../customer/case-table';
import { ORG_NAV } from '../../nav';
import { entryCaseHref, entryCases } from '../cases';

type GroupBy = 'status' | 'type' | 'stage' | 'month';
const GROUPS: [GroupBy, string][] = [
  ['status', 'پرونده‌ها به تفکیک وضعیت'],
  ['type', 'پرونده‌ها به تفکیک نوع خسارت'],
  ['stage', 'پرونده‌ها به تفکیک مرحلهٔ رسیدگی'],
  ['month', 'پرونده‌ها به تفکیک ماه ثبت'],
];
const STATUS_ORDER = ['RETURNED_INCOMPLETE', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED'];
const faN = (n: number) => n.toLocaleString('fa-IR');
/** «همه / نیازمند اقدام» and the home cards' lists: در جریان, تاییدشده, پرداخت‌شده. */
type Tab = 'all' | 'action' | 'open' | 'approved' | 'paid';
const TAB_KEYS: Tab[] = ['all', 'action', 'open', 'approved', 'paid'];
const inTab = (t: Tab, c: MyClaim) => t === 'open' ? !['PAID', 'REJECTED'].includes(c.status) : t === 'approved' ? ['APPROVED', 'PAID'].includes(c.status) : t === 'paid' ? c.status === 'PAID' : true;
const amount = (c: MyClaim) => Number(c.payableAmount || c.claimedAmount || 0);

/** Panel 1 «پیگیری خسارت»: the organization's cases grouped like the بیمه‌گزار panel's page. */
export default function EntryTrack() {
  const [claims, setClaims] = useState<MyClaim[] | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [tab, setTab] = useState<Tab>('all');
  const [newHref, setNewHref] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TAB_KEYS.includes(t)) setTab(t);
    setNewHref(hasPerm('org', 'claim:file-on-behalf') ? '/org/claims/on-behalf' : hasPerm('org', 'claim:file') ? '/org/claims/new' : null);
    entryCases().then(setClaims).catch((e) => setError(e.message));
  }, []);

  const all = claims ?? [];
  const action = all.filter((c) => c.needsAction);
  const shown = tab === 'action' ? action : all.filter((c) => inTab(tab, c));
  const groups = useMemo(() => {
    const key = (c: MyClaim): [string, string] => {
      if (groupBy === 'type') return [c.claimType, claimTypeLabel(c)];
      if (groupBy === 'stage') return [c.currentStageLabel ?? 'بسته‌شده', c.currentStageLabel ? `نزد ${c.currentStageLabel}` : 'پرونده‌های بسته‌شده'];
      if (groupBy === 'month') { const m = (c.createdAt ?? '').slice(0, 7); return [m || '—', m ? `ثبت‌شده در ${m}` : 'بدون تاریخ']; }
      return [c.status, `پرونده‌های ${STATUS_MAP[c.status]?.label ?? c.status}`];
    };
    const map = new Map<string, { label: string; rows: MyClaim[] }>();
    for (const c of shown) { const [k, l] = key(c); if (!map.has(k)) map.set(k, { label: l, rows: [] }); map.get(k)!.rows.push(c); }
    const list = [...map.entries()];
    if (groupBy === 'status') list.sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]));
    if (groupBy === 'month') list.sort((a, b) => b[0].localeCompare(a[0]));
    return list.map(([k, v]) => ({ key: k, ...v }));
  }, [shown, groupBy]);

  return (
    <Shell title="پیگیری خسارت" breadcrumb="پیگیری خسارت" nav={ORG_NAV} realm="org"
      action={newHref ? <Link href={newHref} className="cu-intro-btn">+ ثبت پرونده خسارت</Link> : undefined}>
      <ErrorBox message={error} />
      <div className="pcard cu-track">
        <div className="cu-track-head">
          <div className="cu-radios" role="radiogroup" aria-label="نحوهٔ دسته‌بندی">
            {GROUPS.map(([k, l]) => (
              <label key={k}><input type="radio" name="groupBy" checked={groupBy === k} onChange={() => setGroupBy(k)} /> {l}</label>
            ))}
          </div>
        </div>

        <div className="cu-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>همهٔ پرونده‌ها - ({faN(all.length)}) عدد</button>
          <button type="button" role="tab" aria-selected={tab === 'action'} className={tab === 'action' ? 'is-on' : ''} onClick={() => setTab('action')}>نیازمند اقدام - ({faN(action.length)}) عدد</button>
          {([['open', 'در جریان'], ['approved', 'تاییدشده'], ['paid', 'پرداخت‌شده']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l} - ({faN(all.filter((c) => inTab(k, c)).length)}) عدد</button>
          ))}
        </div>

        {!claims ? <div className="p-10 flex justify-center"><FancyLoader label="در حال دریافت پرونده‌ها" /></div>
          : groups.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{tab === 'action' ? 'پرونده‌ای منتظر رفع نقص نیست.' : tab === 'all' ? 'پرونده‌ای ثبت نشده است.' : 'پرونده‌ای در این دسته نیست.'}</div>
          : groups.map((g) => (
            <div key={g.key} className="cu-group">
              <div className="cu-group-h"><span>{g.label} - ({faN(g.rows.length)}) عدد :</span><span>جمع: {faN(g.rows.reduce((t, c) => t + amount(c), 0))} ریال</span></div>
              <CaseTable rows={g.rows} href={entryCaseHref} />
            </div>
          ))}
      </div>
    </Shell>
  );
}
