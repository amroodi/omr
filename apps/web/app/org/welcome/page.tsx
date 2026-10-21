'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, clearToken, getToken } from '../../../lib/client';
import { BrandMark } from '../../components/brand';
import { Icon } from '../../components/Shell';

/** Post-login entry page: operators reach میز کار first, then everything else from its sidebar. */
export default function OrgWelcome() {
  const router = useRouter();
  const [info, setInfo] = useState<{ userName: string | null; pending: number } | null>(null);
  const [tenant, setTenant] = useState('دامون');

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<any>('/claims/work-desk', 'org')
      .then((d) => setInfo({ userName: d.userName ?? null, pending: d.summary?.pendingActions ?? 0 }))
      .catch(() => setInfo({ userName: null, pending: 0 }));
    client.get<any>('/tenant/branding', 'org').then((b) => b?.name && setTenant(b.name)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const logout = () => { clearToken('org'); router.push('/org/login'); };

  return (
    <div className="welcome-bg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="welcome-top">
        <span className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="font-extrabold">{tenant}</span>
        </span>
        <span style={{ flex: 1 }} />
        {info?.userName && <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>کاربر: <b style={{ color: '#fff' }}>{info.userName}</b></span>}
        <button onClick={logout} className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: 999 }}>
          <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج از سیستم
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="welcome-card">
          <div className="flex justify-center mb-4"><BrandMark size={66} /></div>
          <h1 className="font-extrabold text-xl" style={{ color: 'var(--brand)' }}>سامانهٔ کنترل و ارزیابی عمر و حادثه</h1>
          <p className="text-sm mt-2 mb-6" style={{ color: 'var(--muted)' }}>
            {info?.userName ? `${info.userName} عزیز، ` : ''}برای شروع وارد میز کار خود شوید.
          </p>
          <Link href="/org/work-desk" className="btn btn-solid btn-solid-lg w-full" style={{ justifyContent: 'center' }}>
            <Icon path="M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10" />
            ورود به میز کار
            {info && info.pending > 0 && (
              <span className="badge" style={{ background: '#fff', color: 'var(--brand)', marginInlineStart: 6 }}>{info.pending.toLocaleString('fa-IR')} مورد در انتظار</span>
            )}
          </Link>
        </div>
      </div>

      <div className="text-xs text-center pb-4" style={{ color: 'var(--muted)' }}>طراحی و تولید توسط کارگزاری آتیه اندیشان دامون</div>
    </div>
  );
}
