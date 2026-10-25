'use client';
import { usePathname } from 'next/navigation';

/** Pages whose login card already carries the credit line — no second copy under it. */
const CARD_PAGES = new Set(['/customer/login', '/org/login']);

/** Site-wide credit line under the page content. */
export function SiteFooter() {
  const path = usePathname() || '/';
  if (CARD_PAGES.has(path)) return null;
  return (
    <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
      طراحي و توليد توسط کارگزاری آتیه اندیشان دامون
    </footer>
  );
}
