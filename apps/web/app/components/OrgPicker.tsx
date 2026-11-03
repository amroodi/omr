'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client } from '../../lib/client';
import { entryLogin } from '../../lib/panel';

interface Org { slug: string; name: string; kind?: string; hasLogo?: boolean }

let cache: Org[] | null = null;

/**
 * The home page's company picker: «ورود برای بارگذاری مدارک» (ENTRY, panel 1) and «ورود برای ارزیابی
 * پرونده‌ها» (PROCESS, panel 2) open it; picking a logo goes to that company's own login page and look.
 * Panel 1 lists brokerages only for now: an insurer's data entry comes with its own step.
 */
export function OrgPicker({ purpose, onClose }: { purpose: 'ENTRY' | 'PROCESS' | null; onClose: () => void }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(cache);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!purpose || cache) return;
    fetch(`${client.base}/customer/orgs`).then((r) => (r.ok ? r.json() : Promise.reject())).then((l: Org[]) => { cache = Array.isArray(l) ? l : []; setOrgs(cache); }).catch(() => setError(true));
  }, [purpose]);
  useEffect(() => {
    if (!purpose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [purpose, onClose]);
  if (!purpose) return null;

  const list = (orgs ?? []).filter((o) => (purpose === 'ENTRY' ? o.kind === 'BROKER' : o.kind === 'BROKER' || o.kind === 'INSURER'));
  const go = (o: Org) => router.push(purpose === 'ENTRY' ? entryLogin(o.slug) : `${o.kind === 'INSURER' ? '/insurer/login' : '/org/login'}?org=${encodeURIComponent(o.slug)}`);
  const groups = purpose === 'ENTRY' ? [{ title: '', items: list }] : [
    { title: 'کارگزاری‌ها', items: list.filter((o) => o.kind === 'BROKER') },
    { title: 'بیمه‌گرها', items: list.filter((o) => o.kind === 'INSURER') },
  ].filter((g) => g.items.length);

  return (
    <div className="op-back" onClick={onClose} role="presentation">
      <div className="op-sheet" role="dialog" aria-modal="true" aria-label="انتخاب سازمان" onClick={(e) => e.stopPropagation()}>
        <div className="op-head">
          <div>
            <div className="op-title">{purpose === 'ENTRY' ? 'ورود برای بارگذاری مدارک' : 'ورود برای ارزیابی پرونده‌ها'}</div>
            <div className="op-sub">سازمان خود را انتخاب کنید</div>
          </div>
          <button type="button" className="op-x" onClick={onClose} aria-label="بستن">✕</button>
        </div>
        {error ? <div className="op-empty">فهرست سازمان‌ها در دسترس نیست؛ دوباره تلاش کنید.</div>
          : !orgs ? <div className="op-empty">…</div>
          : !list.length ? <div className="op-empty">سازمانی برای این ورود ثبت نشده است.</div>
          : groups.map((g) => (
            <div key={g.title || 'all'}>
              {g.title && <div className="op-group">{g.title}</div>}
              <div className="op-grid">
                {g.items.map((o, i) => (
                  <button key={o.slug} type="button" className="op-tile" style={{ animationDelay: `${60 + i * 45}ms` }} onClick={() => go(o)} title={o.name}>
                    <span className="op-logo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {o.hasLogo ? <img src={`${client.base}/tenant/assets/logo?tenant=${encodeURIComponent(o.slug)}`} alt="" /> : <span className="op-initial">{o.name.trim().charAt(0)}</span>}
                    </span>
                    <span className="op-name">{o.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
