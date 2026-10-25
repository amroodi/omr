import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from './components/AppHeader';
import { SiteFooter } from './components/SiteFooter';
import { ThemeApplier } from './components/ThemeApplier';
import { THEME_BOOT_SCRIPT } from '../lib/theme';
import { SCALE_BOOT_SCRIPT } from '../lib/scale';
import { WALL_BOOT_SCRIPT } from '../lib/wallpaper';

/**
 * Production only: silence the browser console and switch off the React DevTools hook, so the page
 * doesn't print internals and its component tree/state can't be browsed with the DevTools extension.
 */
const QUIET_BOOT_SCRIPT = `(function(){try{var n=function(){};['log','info','warn','error','debug','trace','table','dir','group','groupCollapsed','groupEnd'].forEach(function(k){try{console[k]=n}catch(e){}});var h=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;if(h&&typeof h==='object'){for(var k in h){try{h[k]=typeof h[k]==='function'?n:null}catch(e){}}}else{try{Object.defineProperty(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__',{value:{isDisabled:true,supportsFiber:true,inject:n,onCommitFiberRoot:n,onCommitFiberUnmount:n,checkDCE:n},configurable:false})}catch(e){}}}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'دامون | سامانه هوشمند مدیریت بیمه',
  description: 'سامانه چندسازمانی مدیریت و استعلام امن پرونده‌های بیمه',
  authors: [{ name: 'Milad Amroodi (میلاد امرودی)' }],
  other: { developer: 'Developed by Milad Amroodi (میلاد امرودی)' },
  // Browser-tab / home-screen icon: the brokerage's emblem (app/favicon.ico is picked up automatically).
  icons: { icon: [{ url: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/brand/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'production' && <script dangerouslySetInnerHTML={{ __html: QUIET_BOOT_SCRIPT }} />}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SCALE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: WALL_BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeApplier />
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
