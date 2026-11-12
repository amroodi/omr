'use client';
import { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken } from '../../lib/client';

/** The doctor panel's own frame: title bar with «کارتابل» and «خروج» — nothing of panels 1 and 2. */
export function DoctorShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="doc-shell">
      <header className="doc-bar">
        <b>پنل پزشک معتمد</b>
        <span className="doc-bar-t">{title}</span>
        <span className="sk-grow" />
        <Link href="/doctor" className="doc-bar-btn">کارتابل</Link>
        <button className="doc-bar-btn" onClick={() => { clearToken('org'); router.push('/doctor/login'); }}>خروج</button>
      </header>
      <main className="doc-main">{children}</main>
    </div>
  );
}
