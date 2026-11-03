'use client';
import { useEffect, useState } from 'react';
import { Shell } from '../../components/Shell';
import { CompaniesPanel } from '../../components/operators/CompaniesPanel';
import { RepresentativesPanel } from '../../components/operators/RepresentativesPanel';
import { ORG_NAV } from '../nav';

const tabStyle = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });

/**
 * «بیمه‌گزاران» (a brokerage's admin, panel 2): the people who use panel 1 «ورود برای بارگذاری مدارک ›
 * بیمه‌گزار / نماینده» — each بیمه‌گزار company's own login (کد بیمه‌گزار + password, with its بیمه‌نامه‌ها)
 * and the company's نمایندگان (کد ملی + password). The brokerage's own staff are in «کاربران و نقش‌ها».
 * Inquiry questions live in «پاسخگوی آنلاین».
 */
export default function Policyholders() {
  const [tab, setTab] = useState<'companies' | 'reps'>('companies');
  useEffect(() => { if (new URLSearchParams(window.location.search).get('tab') === 'reps') setTab('reps'); }, []);
  return (
    <Shell title="بیمه‌گزاران" subtitle="کاربران پنل ۱: ورود شرکت‌های بیمه‌گزار و نمایندگان آن‌ها" nav={ORG_NAV} realm="org">
      <div className="flex gap-2 mb-4">
        <button className="btn btn-sm" style={tabStyle(tab === 'companies')} onClick={() => setTab('companies')}>شرکت‌های بیمه‌گزار</button>
        <button className="btn btn-sm" style={tabStyle(tab === 'reps')} onClick={() => setTab('reps')}>نمایندگان</button>
      </div>
      {tab === 'companies' ? <CompaniesPanel /> : <RepresentativesPanel realm="org" base="" />}
    </Shell>
  );
}
