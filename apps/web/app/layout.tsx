import type { Metadata } from 'next';
import './globals.css';
import { ThemeToggle } from './theme-toggle';
import { BrandMark } from './components/brand';

export const metadata: Metadata = {
  title: 'بیمس | سامانه هوشمند مدیریت بیمه',
  description: 'سامانه چندسازمانی مدیریت و استعلام امن پرونده‌های بیمه',
  authors: [{ name: 'Milad Amroodi (میلاد امرودی)' }],
  other: { developer: 'Developed by Milad Amroodi (میلاد امرودی)' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body>
        <header
          className="sticky top-0 z-40 backdrop-blur-md"
          style={{ background: 'color-mix(in srgb, var(--surface) 82%, transparent)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4">
            <a href="/" className="flex items-center gap-2.5">
              <BrandMark />
              <span className="font-extrabold text-lg">بیمس</span>
            </a>
            <nav className="hidden sm:flex gap-1 text-sm mr-auto">
              <a href="/customer/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">پورتال مشتری</a>
              <a href="/org/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">پورتال سازمان</a>
              <a href="/admin/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">مدیر سکو</a>
            </nav>
            <div className="sm:mr-0 mr-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
          توسعه توسط میلاد امرودی — Developed by Milad Amroodi · کارگزاری آتیه اندیشان دامون
        </footer>
      </body>
    </html>
  );
}
