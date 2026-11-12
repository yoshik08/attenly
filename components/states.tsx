'use client';

import type { ReactNode } from 'react';
import { ArrowsClockwise, CloudSlash } from '@phosphor-icons/react';
import { useStore } from './store';
import { FirstLink, SignIn } from './gate';
import { Empty, PageHeader } from './page';

export function BootScreen() {
  return (
    <div className="pt-5 lg:pt-12" aria-busy="true" aria-label="Loading">
      <div className="skel h-10 w-56" />
      <div className="skel mt-3 h-4 w-40" />
      <div className="skel mt-8 h-[220px] w-full rounded-[24px]" />
      <div className="mt-10 grid gap-3 md:grid-cols-2 lg:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="flex justify-between gap-4">
              <div className="flex-1">
                <div className="skel h-3 w-24" />
                <div className="skel mt-3 h-5 w-3/4" />
                <div className="skel mt-2 h-4 w-1/2" />
              </div>
              <div className="skel h-[92px] w-[92px] rounded-full" />
            </div>
            <div className="skel mt-5 h-8 w-full rounded-[12px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string | null; onRetry: () => Promise<void> | void }) {
  return (
    <section className="page-in mx-auto max-w-[560px]">
      <PageHeader title="Can’t load your data" />
      <Empty
        icon={CloudSlash}
        title={message ?? 'Attenly can’t reach its server right now.'}
        action={
          <button type="button" className="btn btn-primary press" onClick={() => void onRetry()}>
            Try again
          </button>
        }
      />
    </section>
  );
}

/**
 * Shared front door for data pages: sign-in, first link, or "nothing synced
 * yet", and only then the page itself.
 */
export function DataGate({ title, children }: { title: string; children: ReactNode }) {
  const { phase, accounts, snapshot, loadError, refresh, sync, forceSync, activeAccount } = useStore();
  if (phase === 'boot') return <BootScreen />;
  if (phase === 'signed-out') return <SignIn />;
  if (phase === 'error' && !snapshot) return <LoadError message={loadError} onRetry={refresh} />;
  if (accounts.length === 0) return <FirstLink />;
  if (!snapshot) {
    return (
      <section className="page-in mx-auto max-w-[620px]">
        <PageHeader title={title} />
        <Empty
          icon={ArrowsClockwise}
          title={
            sync.running
              ? 'Signing into the ERP and pulling your data.'
              : activeAccount?.needsPassword
                ? 'Syncing is paused.'
                : 'Nothing synced for this account yet.'
          }
          action={
            !sync.running &&
            !activeAccount?.needsPassword && (
              <button type="button" className="btn btn-primary press" onClick={() => void forceSync()}>
                <ArrowsClockwise size={18} aria-hidden /> Sync now
              </button>
            )
          }
        >
          {sync.running
            ? 'This takes about 20 seconds.'
            : activeAccount?.needsPassword
              ? 'Enter your ERP password again on the Attendance tab to resume.'
              : 'Sync once to pull it from the ERP.'}
        </Empty>
      </section>
    );
  }
  return <>{children}</>;
}
