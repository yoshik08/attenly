import type { Metadata } from 'next';
import { Sora, Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { DataProvider } from '@/components/data-context';
import { Nav, Footer } from '@/components/nav';
import { AuroraBackground } from '@/components/ui';
import { AuthProvider } from '@/components/auth-provider';
import { SnapshotLoader } from '@/components/snapshot-loader';

export const metadata: Metadata = {
  title: 'Attenly — the KLU ERP, rebuilt for students',
  description:
    'A student-built front for the KL University ERP. Live attendance intelligence, timetable, and smart bunk planning in one clean interface.',
};

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} ${inter.variable} ${fraunces.variable} flex min-h-screen flex-col`}>
        <AuroraBackground />
        <AuthProvider>
          <DataProvider>
            <SnapshotLoader />
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </DataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
