import type { Metadata } from 'next';
import './globals.css';
import { ThemeToggle } from './theme-toggle';

export const metadata: Metadata = {
  title: 'سامانه بیمس — دامون',
  description: 'سامانه مدیریت و استعلام پرونده‌های بیمه',
  // Developer credit (per spec)
  authors: [{ name: 'Milad Amroodi (میلاد امرودی)' }],
  other: { developer: 'Developed by Milad Amroodi (میلاد امرودی)' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body>
        <header
          className="flex items-center justify-between px-4 py-3 border-b gap-3 flex-wrap"
          style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
        >
          <a href="/" className="font-bold text-lg">سامانه بیمس</a>
          <nav className="flex gap-3 text-sm mr-auto">
            <a href="/customer/login">مشتری</a>
            <a href="/org/login">سازمان</a>
            <a href="/admin/login">مدیر سکو</a>
          </nav>
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-3xl p-4">{children}</main>
        <footer className="mx-auto max-w-3xl p-4 text-center text-xs" style={{ color: 'var(--muted)' }}>
          توسعه توسط میلاد امرودی (Developed by Milad Amroodi) — آتیه اندیشان دامون
        </footer>
      </body>
    </html>
  );
}
