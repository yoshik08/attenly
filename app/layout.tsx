import type { Metadata } from 'next';
import './globals.css';
import { DataProvider } from '@/components/data-context';
import { Nav, Footer } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Skipwise — Know what a class is worth before you skip it',
  description:
    'Unofficial KL University attendance planner. Sync your timetable and attendance from the ERP and see what every class is worth.',
};

const THEME_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('skipwise:v1')||'{}');var t=(s.settings||{}).theme||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <DataProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </DataProvider>
      </body>
    </html>
  );
}
