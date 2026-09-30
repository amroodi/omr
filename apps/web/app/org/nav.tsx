'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken } from '../../lib/client';

const links = [
  { href: '/org', label: 'پرونده‌ها' },
  { href: '/org/assessor', label: 'ارزیابی مدارک' },
  { href: '/org/import', label: 'ورود دسته‌ای' },
  { href: '/org/users', label: 'کاربران و نقش‌ها' },
  { href: '/org/sharing', label: 'اشتراک‌گذاری' },
];

export function OrgNav() {
  const router = useRouter();
  return (
    <nav className="flex flex-wrap gap-2 items-center border-b pb-2 mb-4" style={{ borderColor: 'var(--border)' }}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: 'var(--border)' }}>
          {l.label}
        </Link>
      ))}
      <button
        onClick={() => {
          clearToken('org');
          router.push('/org/login');
        }}
        className="rounded-lg border px-3 py-1 text-sm mr-auto"
        style={{ borderColor: 'var(--border)' }}
      >
        خروج
      </button>
    </nav>
  );
}
