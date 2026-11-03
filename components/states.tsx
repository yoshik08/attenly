'use client';

import type { ReactNode } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useStore } from './store';
import { FirstLink, SignIn } from './gate';

export function BootScreen() {
  return (
    <div className="py-8" aria-busy="true" aria-label="Loading">
      <div className="skel h-8 w-44" />
      <div className="skel mt-3 h-4 w-32" />
      <div className="skel mt-6 h-20 w-full rounded-2xl" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="seam-b py-5">
          <div className="flex justify-between gap-4">
            <div className="skel h-5 w-2/3" />
            <div className="skel h-8 w-16" />
          </div>
          <div className="mt-4 flex flex-wrap gap-1">
            {Array.from({ length: 24 }, (_, j) => (
              <span key={j} className="skel h-2.5 w-2.5 rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string | null; onRetry: () => Promise<void> | void }) {
  return (
    <section className="mx-auto max-w-[460px] py-16">
      <h1 className="title-l">Can’t load your data</h1>
      <p className="mt-3 text-[15px] text-dropout-text">{message ?? 'Attenly can’t reach its server right now.'}</p>
      <button type="button" className="btn btn-mark press mt-6" onClick={() => void onRetry()}>
        Try again
      </button>
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
      <section className="page-in mx-auto max-w-[520px] py-12">
        <h1 className="title-l">{title}</h1>
        <p className="mt-3 text-[15px] text-dropout-text">
          {sync.running
            ? 'Signing into the ERP and pulling your data. This takes about 20 seconds.'
            : activeAccount?.needsPassword
              ? 'Syncing is paused until you enter your ERP password again on the Attendance tab.'
              : 'Nothing synced for this account yet.'}
        </p>
        {!sync.running && !activeAccount?.needsPassword && (
          <button type="button" className="btn btn-mark press mt-6" onClick={() => void forceSync()}>
            <ArrowsClockwise size={18} aria-hidden /> Sync now
          </button>
        )}
      </section>
    );
  }
  return <>{children}</>;
}
