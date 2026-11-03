'use client';
import Link from 'next/link';
import { BigIcon } from '../components/ui';

/** The بیمه‌گزار / نماینده panel's dashboard pieces, shared with every organization's panel 1 (/org/entry). */
export const IC = {
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  doc: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  bubble: 'M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.9-.9L3 21l1.9-5.1A8.4 8.4 0 1121 11.5z',
  policy: 'M9 2h6l1 3h3a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h3zM9 12l2 2 4-4',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
  tray: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
  alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  mail: 'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6l-10 7L2 6',
};

/** One tile of the action launcher (link, or a button that opens a section below). */
export function Diamond({ title, sub, icon, href, onClick, active }: { title: string; sub: string; icon: string; href?: string; onClick?: () => void; active?: boolean }) {
  const inner = (
    <>
      <div className="pdiamond"><BigIcon path={icon} size={30} /></div>
      <div><div className="pdiamond-title">{title}</div><div className="pdiamond-sub">{sub}</div></div>
    </>
  );
  if (href) return <Link href={href} className="pdiamond-wrap">{inner}</Link>;
  return <button type="button" onClick={onClick} className={`pdiamond-wrap${active ? ' is-active' : ''}`} aria-pressed={active}>{inner}</button>;
}
