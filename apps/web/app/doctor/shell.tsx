'use client';
import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, clearToken } from '../../lib/client';

/** The doctor panel's own frame: the doctor's name, «کارتابل», «تغییر رمز عبور» and «خروج» — nothing of panels 1 and 2. */
export function DoctorShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<{ fullName: string; insurers: string[] } | null>(null);
  const [pw, setPw] = useState<{ current: string; next: string; msg: string; ok: boolean } | null>(null);
  useEffect(() => { client.get<{ fullName: string; insurers: string[] }>('/doctor/me', 'doctor').then(setMe).catch(() => {}); }, []);
  const save = async () => {
    if (!pw) return;
    try { await client.post('/doctor/password', { current: pw.current, next: pw.next }, 'doctor'); setPw({ current: '', next: '', msg: 'رمز عبور تغییر کرد', ok: true }); }
    catch (e: any) { setPw({ ...pw, msg: e.message, ok: false }); }
  };
  return (
    <div className="doc-shell">
      <header className="doc-bar">
        <b>پنل پزشک معتمد</b>
        <span className="doc-bar-t">{title}</span>
        <span className="sk-grow" />
        {me && <span className="doc-bar-t" title={me.insurers.join('، ')}>دکتر {me.fullName}</span>}
        <Link href="/doctor" className="doc-bar-btn">کارتابل</Link>
        <button className="doc-bar-btn" onClick={() => setPw(pw ? null : { current: '', next: '', msg: '', ok: false })}>تغییر رمز عبور</button>
        <button className="doc-bar-btn" onClick={() => { clearToken('doctor'); router.push('/doctor/login'); }}>خروج</button>
      </header>
      {pw && (
        <div className="doc-card doc-pw">
          {pw.msg && <div className={pw.ok ? 'alert-success text-sm' : 'alert-error text-sm'}>{pw.msg}</div>}
          <input className="input" type="password" dir="ltr" placeholder="رمز عبور فعلی" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input className="input" type="password" dir="ltr" placeholder="رمز عبور جدید (دست‌کم ۸ نویسه)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <button className="btn btn-solid btn-sm" disabled={!pw.current || pw.next.length < 8} onClick={save}>ذخیره</button>
        </div>
      )}
      <main className="doc-main">{children}</main>
    </div>
  );
}
