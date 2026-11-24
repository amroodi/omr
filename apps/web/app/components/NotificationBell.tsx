'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, Realm } from '../../lib/client';

interface Note { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string; kind?: 'ACTION' | 'INFO' | 'ACTIVITY' }

/**
 * Bell with the count of unread things to do, and the list: «اعلان‌ها» (to do) and — for admins — «فعالیت
 * همکاران» (colleagues' acts). Each operator has their own read state; opening one opens its case.
 */
/** «اعلان‌ها» holds the to-do notices and the news of cases; «فعالیت همکاران» the rest. */
const tabOf = (i: Note): 'ACTION' | 'ACTIVITY' => (i.kind === 'ACTIVITY' ? 'ACTIVITY' : 'ACTION');

export function NotificationBell({ realm }: { realm: Realm }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Note[] | null>(null);
  const [tab, setTab] = useState<'ACTION' | 'ACTIVITY'>('ACTION');
  const ref = useRef<HTMLDivElement>(null);

  const loadCount = () => client.get<{ count: number }>('/notifications/unread-count', realm).then((d) => setCount(d.count)).catch(() => {});
  const loadList = () => client.get<Note[]>('/notifications', realm).then(setItems).catch(() => setItems([]));

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000); // light poll
    const onFocus = () => loadCount(); // back on the tab: up to date at once
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('mousedown', onClick);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('mousedown', onClick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => { const n = !open; setOpen(n); if (n) { setItems(null); loadList(); loadCount(); } };
  const markRead = (it: Note) => {
    if (it.readAt) return;
    setItems((x) => x?.map((i) => (i.id === it.id ? { ...i, readAt: 'now' } : i)) ?? x);
    if ((it.kind ?? 'ACTION') === 'ACTION') setCount((c) => Math.max(0, c - 1)); // news (INFO) is not counted
    client.post(`/notifications/${it.id}/read`, {}, realm).then(loadCount).catch(() => {});
  };
  // Opened right in the click (a tab opened after waiting for the server is blocked as a pop-up).
  const openItem = (it: Note) => {
    markRead(it);
    setOpen(false);
    if (!it.link) return;
    if (/\/claims\//.test(it.link)) window.open(it.link, '_blank', 'noopener');
    else router.push(it.link);
  };
  const markAll = async () => {
    try {
      await client.post(`/notifications/read-all?kind=${tab}`, {}, realm);
      setItems((x) => x?.map((i) => (tabOf(i) === tab ? { ...i, readAt: i.readAt ?? 'now' } : i)) ?? x);
      loadCount();
    } catch { /* ignore */ }
  };
  const activity = (items ?? []).filter((i) => i.kind === 'ACTIVITY');
  const shown = (items ?? []).filter((i) => tabOf(i) === tab);
  const unreadActivity = activity.filter((i) => !i.readAt).length;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={toggle} className="relative flex items-center justify-center rounded-lg" style={{ width: 38, height: 38, background: 'var(--surface-2)', border: '1px solid var(--border)' }} title="اعلان‌ها" aria-label="اعلان‌ها">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>
        {count > 0 && (
          <span style={{ position: 'absolute', top: -6, insetInlineStart: -6, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: 'var(--danger)', color: '#fff', fontSize: 11, lineHeight: '18px', textAlign: 'center' }}>
            {count > 99 ? '۹۹+' : count.toLocaleString('fa-IR')}
          </span>
        )}
      </button>
      {open && (
        <div className="card nb-pop" style={{ position: 'absolute', insetInlineEnd: 0, top: 46, width: 340, maxHeight: 460, overflowY: 'auto', zIndex: 40, padding: 0 }}>
          <div className="flex justify-between items-center p-3 gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            {activity.length > 0 ? (
              <span className="nb-tabs">
                <button className={tab === 'ACTION' ? 'is-on' : ''} onClick={() => setTab('ACTION')}>اعلان‌ها</button>
                <button className={tab === 'ACTIVITY' ? 'is-on' : ''} onClick={() => setTab('ACTIVITY')}>فعالیت همکاران{unreadActivity ? ` (${unreadActivity.toLocaleString('fa-IR')})` : ''}</button>
              </span>
            ) : <span className="font-bold text-sm">اعلان‌ها</span>}
            <button onClick={markAll} className="text-xs whitespace-nowrap" style={{ color: 'var(--brand)' }}>خواندن همه</button>
          </div>
          {items === null ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>در حال دریافت…</div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>اعلانی نیست</div>
          ) : shown.map((it) => (
            <button key={it.id} onClick={() => openItem(it)} className="block w-full text-right p-3" style={{ borderBottom: '1px solid var(--border)', background: it.readAt ? 'transparent' : 'var(--brand-soft)', cursor: 'pointer' }}>
              <div className="flex items-center gap-2">
                {!it.readAt && <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--brand)', flexShrink: 0 }} />}
                <span className="font-semibold text-sm">{it.title}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{it.body}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>{it.createdAt}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
