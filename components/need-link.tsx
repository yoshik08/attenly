'use client';

import Link from 'next/link';
import { Container, GlassPanel } from '@/components/ui';

/** Shown on data pages when the visitor hasn't linked their ERP yet. */
export function NeedLink({ what }: { what: string }) {
  return (
    <Container className="py-10">
      <GlassPanel className="mx-auto max-w-md p-8 text-center">
        <p className="font-display text-xl font-bold text-[#F5F4F0]">No {what} yet</p>
        <p className="mt-2 text-sm text-[#A1A1A8]">
          Link your ERP on the home page and your {what} will show up here.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-[#E9A13B] px-5 py-2.5 text-sm font-bold text-[#0A0A0B] transition hover:brightness-110"
        >
          Link my ERP →
        </Link>
      </GlassPanel>
    </Container>
  );
}
