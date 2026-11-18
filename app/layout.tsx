import type { Metadata, Viewport } from 'next';
import { Archivo, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { StoreProvider } from '@/components/store';
import { AppShell } from '@/components/shell';
import { BASE_PATH } from '@/lib/api';

/**
 * Starts the app's data request while the HTML is still parsing, so it runs alongside the
 * JavaScript download instead of after hydration. The store picks the response up
 * (components/store.tsx, takeEarlyData); the cached copy still paints first.
 */
const EARLY_DATA = `(function(){try{var a=localStorage.getItem('attenly-active-account');if(!a||!/^[A-Za-z0-9]+$/.test(a))a=null;window.__attenlyEarly={account:a,at:Date.now(),res:fetch('${BASE_PATH}/api/data'+(a?'?account='+encodeURIComponent(a):''),{cache:'no-store'}).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})};window.__attenlyEarly.res.catch(function(){})}catch(e){}})();`;

const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Attenly — KL attendance, synced for you',
  description:
    'Attenly signs into the KL University ERP for you, keeps attendance, timetable and CGPA synced, and shows how many classes you can still skip.',
  applicationName: 'Attenly',
  appleWebApp: { capable: true, title: 'Attenly', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_DATA }} />
      </head>
      <body>
        <AuthProvider>
          <StoreProvider>
            <AppShell>{children}</AppShell>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
