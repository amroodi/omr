'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { client } from '../../lib/client';
import { Shell } from '../components/Shell';
import { ErrorBox, Spinner } from '../components/ui';
import { CUSTOMER_NAV } from './nav';

interface BrokerCompany { id: string; name: string; code: string | null; claims: number; policies: { line: string | null; policyNumber: string | null }[] }
const faN = (n: number) => n.toLocaleString('fa-IR');

/**
 * The brokerage's «broker» login on the بیمه‌گزار panel: every بیمه‌گزار of the brokerage, searchable,
 * with «ثبت پرونده» (file a claim for that company) and «پرونده‌ها» (its claims, documents, روند).
 */
export function BrokerHome() {
  const [rows, setRows] = useState<BrokerCompany[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = (term = q) =>
    client.get<BrokerCompany[]>(`/customer/broker/companies${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`, 'customer')
      .then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // Search as you type (short pause), so the list narrows without pressing a button.
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q]);

  return (
    <Shell title="پنل کارگزاری — بیمه‌گزاران" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />
      <div className="pcard cu-track">
        <div className="cu-tips">
          همهٔ بیمه‌گزاران کارگزاری در این فهرست هستند. برای هر بیمه‌گزار می‌توانید پرونده ثبت کنید، مدارک را بارگذاری کنید و روند پرونده‌هایش را ببینید.
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input cu-pill" style={{ maxWidth: 380, textAlign: 'start' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: نام بیمه‌گزار، کد بیمه‌گزار یا شماره بیمه‌نامه" />
          {rows && <span className="text-sm" style={{ color: 'var(--muted)' }}>{faN(rows.length)} بیمه‌گزار</span>}
        </div>
        {!rows ? <div className="p-10 flex justify-center"><Spinner /></div> : rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>بیمه‌گزاری با این مشخصات پیدا نشد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table cu-group-t">
              <thead><tr>{['کد بیمه‌گزار', 'نام بیمه‌گزار', 'بیمه‌نامه‌های جاری', 'پرونده‌ها', 'عملیات'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="latin-digits">{c.code ?? '—'}</td>
                    <td style={{ textAlign: 'start' }} className="font-semibold">{c.name}</td>
                    <td className="text-xs">{c.policies.length ? c.policies.map((p) => `${p.line ?? ''} ${p.policyNumber ?? ''}`).join(' — ') : '—'}</td>
                    <td>{faN(c.claims)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link href={`/customer/claims/new?company=${c.id}`} target="_blank" rel="noopener" className="cu-more">ثبت پرونده</Link>{' '}
                      <Link href={`/customer/claims?company=${c.id}`} target="_blank" rel="noopener" className="cu-more" style={{ background: 'var(--cu-ink)' }}>پرونده‌ها</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
