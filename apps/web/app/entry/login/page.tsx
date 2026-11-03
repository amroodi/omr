'use client';
import { useEffect, useState } from 'react';
import { CustomerLoginPage } from '../../components/CustomerLoginPage';
import { OrgLoginPage } from '../../components/OrgLoginPage';

/**
 * Panel 1 «ورود برای بارگذاری مدارک» of one organization (?org=slug, chosen on the home page): the
 * بیمه‌گزار and نماینده sign in here, and so do the organization's own staff (own account and
 * two-step login) to file cases, import Excel files and use «میز کار مستقل». Assessment is panel 2.
 */
export default function EntryLogin() {
  const [slug, setSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<'customer' | 'staff'>('customer');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSlug((q.get('org') || '').trim().toLowerCase());
    if (q.get('as') === 'staff') setTab('staff');
  }, []);
  if (slug === null) return null;

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
