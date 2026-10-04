import type { Metadata } from 'next';
import { Sora, Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { DataProvider } from '@/components/data-context';
import { Nav, Footer } from '@/components/nav';
import { AuroraBackground } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Skipwise — read the room before you bunk it',
  description:
    'Unofficial KL University attendance companion. Link your ERP, watch your bunk balance, and play the what-if lab before you skip.',
};

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} ${inter.variable} ${fraunces.variable} flex min-h-screen flex-col`}>
        <AuroraBackground />
        <DataProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </DataProvider>
      </body>
    </html>
  );
}
