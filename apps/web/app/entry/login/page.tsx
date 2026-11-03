'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { CustomerLoginPage } from '../../components/CustomerLoginPage';
import { OrgLoginPage } from '../../components/OrgLoginPage';

/**
 * Panel 1 «ورود برای بارگذاری مدارک» of one organization (?org=slug, chosen on the home page): the
 * بیمه‌گزار and نماینده sign in here, and so do the organization's own staff (own account and
 * two-step login) to file cases, import Excel files and use «میز کار مستقل». An insurer's panel 1 is its
 * staff only (they file for its کارگزاران; بیمه‌گزاران belong to a brokerage). Assessment is panel 2.
 */
export default function EntryLogin() {
  const [slug, setSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<'customer' | 'staff'>('customer');
  const [kind, setKind] = useState<'BROKER' | 'INSURER' | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = (q.get('org') || '').trim().toLowerCase();
    setSlug(s);
    if (q.get('as') === 'staff') setTab('staff');
    fetch(`${client.base}/customer/orgs`).then((r) => (r.ok ? r.json() : [])).then((l: { slug: string; kind?: string }[]) => {
      setKind((Array.isArray(l) ? l : []).find((o) => o.slug === s)?.kind === 'INSURER' ? 'INSURER' : 'BROKER');
    }).catch(() => setKind('BROKER'));
  }, []);
  if (slug === null || kind === null) return null;
  if (kind === 'INSURER') return <OrgLoginPage kind="INSURER" mode="ENTRY" />;

  const switcher = (
    <div className="entry-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'customer'} className={tab === 'customer' ? 'is-on' : ''} onClick={() => setTab('customer')}>بیمه‌گزار / نماینده</button>
      <button type="button" role="tab" aria-selected={tab === 'staff'} className={tab === 'staff' ? 'is-on' : ''} onClick={() => setTab('staff')}>کارکنان سازمان</button>
    </div>
  );
  return tab === 'staff'
    ? <OrgLoginPage kind="BROKER" mode="ENTRY" switcher={switcher} />
    : <CustomerLoginPage slug={slug || undefined} switcher={switcher} />;
}
