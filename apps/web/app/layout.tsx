import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from './components/AppHeader';

export const metadata: Metadata = {
  title: 'دامون | سامانه هوشمند مدیریت بیمه',
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
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
          توسعه توسط میلاد امرودی — Developed by Milad Amroodi · کارگزاری آتیه اندیشان دامون
        </footer>
      </body>
    </html>
  );
}
