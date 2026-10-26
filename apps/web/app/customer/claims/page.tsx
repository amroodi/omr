'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, STATUS_MAP } from '../../components/ui';
import { CUSTOMER_NAV, POLICY_KEY, PolicyRow } from '../nav';

interface MyClaim {
  id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; deceasedName: string | null;
  needsAction: boolean; currentStageLabel?: string | null; eventDate?: string | null; createdAt?: string | null;
  claimedAmount?: string; payableAmount?: string; finalizedAmount?: string | null; policyholderCompanyId?: string | null;
}
type GroupBy = 'status' | 'type' | 'stage' | 'month';
const GROUPS: [GroupBy, string][] = [
  ['status', 'پرونده‌ها به تفکیک وضعیت'],
  ['type', 'پرونده‌ها به تفکیک نوع خسارت'],
  ['stage', 'پرونده‌ها به تفکیک مرحلهٔ رسیدگی'],
  ['month', 'پرونده‌ها به تفکیک ماه ثبت'],
];
// Status groups in the order a case moves through them.
const STATUS_ORDER = ['RETURNED_INCOMPLETE', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED'];
const faN = (n: number) => n.toLocaleString('fa-IR');
const amount = (c: MyClaim) => Number(c.payableAmount || c.claimedAmount || 0);

/**
 * «پیگیری خسارت»: the بیمه‌گزار's cases of one بیمه‌نامه, grouped (by status, claim type, stage or month)
 * with each group's count and total, like the insurer's «پیگیری هزینه های درمانی».
 */
export default function CustomerTrack() {
  const router = useRouter();
  const [claims, setClaims] = useState<MyClaim[] | null>(null);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [broker, setBroker] = useState('');
  const [policyId, setPolicyId] = useState<string>('all');
  const [pick, setPick] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [tab, setTab] = useState<'all' | 'action'>('all');
  const [error, setError] = useState('');
  // «broker» login: ?company=… narrows to one بیمه‌گزار
  const [companyId, setCompanyId] = useState('');

  useEffect(() => {
    if (!getToken('customer')) { router.push('/customer/login'); return; }
    const co = new URLSearchParams(window.location.search).get('company') ?? '';
    setCompanyId(co);
    client.get<MyClaim[]>('/customer/claims', 'customer').then(setClaims).catch((e) => setError(e.message));
    client.get<{ contracts: PolicyRow[]; selectedId: string | null; brokerName: string }>(`/customer/dashboard${co ? `?companyId=${encodeURIComponent(co)}` : ''}`, 'customer').then((d) => {
      setPolicies(d.contracts); setBroker(d.brokerName);
      let want = '';
      try { want = co ? '' : localStorage.getItem(POLICY_KEY) ?? ''; } catch { /* ignore */ }
      setPolicyId(d.contracts.some((c) => c.id === want) ? want : d.selectedId ?? 'all');
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const policy = policies.find((p) => p.id === policyId) ?? null;
  const inPolicy = useMemo(() => (claims ?? []).filter((c) => (!companyId || c.policyholderCompanyId === companyId) && (!policy || c.policyNumber === policy.policyNumber)), [claims, policy, companyId]);
  const action = inPolicy.filter((c) => c.needsAction || c.status === 'RETURNED_INCOMPLETE');
  const shown = tab === 'action' ? action : inPolicy;

  const groups = useMemo(() => {
    const key = (c: MyClaim): [string, string] => {
      if (groupBy === 'type') return [c.claimType, CLAIM_TYPE_LABELS[c.claimType] ?? c.claimType];
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

  const choose = (id: string) => { setPolicyId(id); setPick(false); try { if (id !== 'all') localStorage.setItem(POLICY_KEY, id); } catch { /* ignore */ } };

  return (
    <Shell title="پیگیری خسارت" breadcrumb="پیگیری خسارت" nav={CUSTOMER_NAV} realm="customer"
      action={<Link href={`/customer/claims/new?${new URLSearchParams({ ...(policy ? { policy: policy.id } : {}), ...(companyId ? { company: companyId } : {}) })}`} className="cu-intro-btn">+ ثبت پرونده خسارت</Link>}>
      <ErrorBox message={error} />
      <div className="pcard cu-track">
        <div className="cu-track-head">
          <div className="cu-radios" role="radiogroup" aria-label="نحوهٔ دسته‌بندی">
            {GROUPS.map(([k, l]) => (
              <label key={k}><input type="radio" name="groupBy" checked={groupBy === k} onChange={() => setGroupBy(k)} /> {l}</label>
            ))}
          </div>
          <div className="cu-track-policy">
            <b>{policy ? `پرونده‌های بیمه‌نامهٔ ${policy.lineLabel ?? ''} ${policy.policyNumber ?? ''} — ${policy.startDate ?? '…'} لغایت ${policy.endDate ?? '…'}` : 'پرونده‌های همهٔ بیمه‌نامه‌ها'}</b>
            <button type="button" className="cu-outline" onClick={() => setPick((v) => !v)}>پیگیری خسارت در بیمه‌نامهٔ دیگر</button>
            {pick && (
              <div className="cu-pick">
                <button type="button" onClick={() => choose('all')} className={policyId === 'all' ? 'is-on' : ''}>همهٔ بیمه‌نامه‌ها</button>
                {policies.map((p) => (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} className={policyId === p.id ? 'is-on' : ''}>
                    {p.lineLabel ? `${p.lineLabel} — ` : ''}{p.policyNumber ?? '—'} | {broker} | {p.startDate ?? '…'} - {p.endDate ?? '…'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="cu-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>همهٔ پرونده‌ها - ({faN(inPolicy.length)}) عدد</button>
          <button type="button" role="tab" aria-selected={tab === 'action'} className={tab === 'action' ? 'is-on' : ''} onClick={() => setTab('action')}>نیازمند اقدام شما - ({faN(action.length)}) عدد</button>
        </div>

        {!claims ? <div className="p-10 flex justify-center"><FancyLoader label="در حال دریافت پرونده‌ها" /></div>
          : groups.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>{tab === 'action' ? 'پرونده‌ای منتظر اقدام شما نیست.' : 'در این بیمه‌نامه پرونده‌ای ثبت نشده است.'}</div>
          : groups.map((g) => {
            const sum = g.rows.reduce((t, c) => t + amount(c), 0);
            return (
              <div key={g.key} className="cu-group">
                <div className="cu-group-h"><span>{g.label} - ({faN(g.rows.length)}) عدد :</span><span>جمع: {faN(sum)} ریال</span></div>
                <div className="overflow-x-auto">
                  <table className="table cu-group-t">
                    <thead><tr>{['عملیات', 'شماره پرونده', 'بیمه‌شده (متوفی)', 'نوع خسارت', 'تاریخ وقوع', 'مبلغ برآوردی (ریال)', 'مبلغ قابل پرداخت (ریال)', 'وضعیت پرونده'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {g.rows.map((c) => (
                        <tr key={c.id} className={c.status === 'PAID' ? 'is-paid' : c.status === 'REJECTED' ? 'is-rejected' : undefined}>
                          <td><Link href={`/customer/claims/${c.id}/workflow`} className="cu-more">جزئیات بیشتر</Link></td>
                          <td className="latin-digits" style={{ whiteSpace: 'nowrap' }}>{c.claimNumber}</td>
                          <td>{c.deceasedName ?? '—'}</td>
                          <td>{CLAIM_TYPE_LABELS[c.claimType] ?? c.claimType}</td>
                          <td>{c.eventDate ?? '—'}</td>
                          <td>{faN(Number(c.claimedAmount || 0))}</td>
                          <td>{c.finalizedAmount ? faN(Number(c.finalizedAmount)) : '—'}</td>
                          <td>{STATUS_MAP[c.status]?.label ?? c.status}{c.currentStageLabel ? ` — نزد ${c.currentStageLabel}` : ''}{c.needsAction ? ' (نیازمند اقدام شما)' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
      </div>
    </Shell>
  );
}
