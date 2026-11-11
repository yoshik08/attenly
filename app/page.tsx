'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { SignIn, FirstLink } from '@/components/gate';
import { CourseRow } from '@/components/course';
import { claimIntro, pencilSweep } from '@/components/motion';
import { Sheet } from '@/components/overlay';
import { LinkForm } from '@/components/link-form';
import { BootScreen, LoadError } from '@/components/states';
import { deltaOf, nextClassOf, summarize } from '@/lib/insights';
import { ago, useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

export default function AttendancePage() {
  const store = useStore();
  if (store.phase === 'boot') return <BootScreen />;
  if (store.phase === 'signed-out') return <SignIn />;
  if (store.phase === 'error' && !store.snapshot) return <LoadError message={store.loadError} onRetry={store.refresh} />;
  if (store.accounts.length === 0) return <FirstLink />;
  return <Attendance />;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-2 text-[12px] text-dropout-text" aria-label="How to read the bubbles">
      <li className="flex items-center gap-1.5">
        <span className="bub [--b:10px]" data-s="on" aria-hidden /> attended
      </li>
      <li className="flex items-center gap-1.5">
        <span className="bub [--b:10px]" data-s="off" aria-hidden /> missed
      </li>
      <li className="flex items-center gap-1.5">
        <span className="bub [--b:10px]" data-s="spare" aria-hidden /> can skip
      </li>
      <li className="flex items-center gap-1.5">
        <span className="bub [--b:10px]" data-s="need-thin" aria-hidden /> must attend
      </li>
    </ul>
  );
}

function Attendance() {
  const { snapshot, settings, seen, markSeen, activeAccount, accounts, sync, forceSync, onLinked } = useStore();
  const now = useNow(60_000);
  const list = useRef<HTMLDivElement>(null);
  const [intro] = useState(() => claimIntro());
  const [repairing, setRepairing] = useState(false);

  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const summaries = useMemo(() => subjects.map((s) => summarize(s, settings)), [subjects, settings]);
  const onSeen = useCallback((code: string) => markSeen(code), [markSeen]);

  useEffect(() => {
    if (intro) pencilSweep(list.current);
  }, [intro]);

  // Arriving from the timetable: bring the course into view and mark it.
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id.startsWith('course-')) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [summaries.length]);

  const termLabel = termText(snapshot?.term);
  const label = activeAccount?.label ?? (accounts.length > 1 ? activeAccount?.universityId : null);

  if (!snapshot) {
    return (
      <section className="page-in mx-auto max-w-[520px] py-12">
        <h1 className="title-l">Attendance</h1>
        {activeAccount?.needsPassword ? (
          <RepairNotice message={activeAccount.lastError?.message} onRepair={() => setRepairing(true)} />
        ) : (
          <div className="mt-6 rounded-2xl p-5 ring-seam">
            <p className="text-[15px] font-semibold">
              {sync.running ? (
                <span className="t-shimmer" data-text="Signing into the ERP and pulling your data">
                  Signing into the ERP and pulling your data
                </span>
              ) : (
                'Nothing synced for this account yet.'
              )}
            </p>
            <p className="mt-1 text-[13px] text-dropout-text">
              {sync.running ? 'The first sync takes about 20 seconds.' : (sync.message ?? 'Sync now to pull it from the ERP.')}
            </p>
            {!sync.running && (
              <button type="button" className="btn btn-mark press mt-4" onClick={() => void forceSync()}>
                <ArrowsClockwise size={18} aria-hidden /> Sync now
              </button>
            )}
          </div>
        )}
        <RepairSheet open={repairing} onClose={() => setRepairing(false)} universityId={activeAccount?.universityId} onLinked={onLinked} />
      </section>
    );
  }

  return (
    <div className="page-in lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-14">
      <aside className="pt-6 lg:sticky lg:top-[calc(var(--bar-h)+var(--safe-t))] lg:self-start lg:pt-10">
        <h1 className="title-l">Attendance</h1>
        <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">
          {termLabel}{' '}
          <Link href="/settings#semester" className="ml-1 rounded font-medium text-dropout-text underline decoration-seam-strong hover:text-mark">
            Change
          </Link>
          {label && <span className="block">Showing {label}</span>}
        </p>

        {activeAccount?.needsPassword && <RepairNotice message={activeAccount.lastError?.message} onRepair={() => setRepairing(true)} />}

        {summaries.length > 0 && (
          <div className="mt-6 hidden lg:block">
            <Legend />
          </div>
        )}
      </aside>

      <section aria-label="Courses" className="mt-6 lg:mt-6">
        {summaries.length > 0 && (
          <div className="seam-b pb-4 lg:hidden">
            <Legend />
          </div>
        )}
        {snapshot.issues?.attendance && (
          <RegisterDown
            message={snapshot.issues.attendance}
            asOf={summaries.length > 0 ? snapshot.attendanceSyncedAt : null}
            now={now}
          />
        )}
        {summaries.length === 0 ? (
          !snapshot.issues?.attendance && (
            <div className="py-10">
              <p className="text-[15px] font-semibold">The ERP shows no attendance for {termLabel || 'this term'}.</p>
              <p className="mt-1 text-[13px] text-dropout-text">
                Courses appear here once classes are marked.{' '}
                <Link href="/settings#semester" className="underline decoration-seam-strong hover:text-mark">
                  Look at another semester
                </Link>
              </p>
            </div>
          )
        ) : (
          <div ref={list} className="grid items-start gap-3 sm:grid-cols-2">
            {subjects.map((s, i) => (
              <CourseRow
                key={s.code}
                subject={s}
                summary={summaries[i]}
                settings={settings}
                delta={deltaOf(s, seen)}
                next={nextClassOf(s.code, snapshot.timetable, new Date(now))}
                onSeen={onSeen}
                countUp={intro}
              />
            ))}
          </div>
        )}
        {summaries.length > 0 && (
          <p className="mt-6 text-[12px] text-dropout-quiet pretty">
            Figures follow the ERP’s weighted formula (lecture and tutorial 100, practical 50, skilling 25), rounded up.
            Each bubble row on its own: skipping one class type assumes you attend the rest. Double-check the ERP before
            making the call.
          </p>
        )}
      </section>
      <RepairSheet open={repairing} onClose={() => setRepairing(false)} universityId={activeAccount?.universityId} onLinked={onLinked} />
    </div>
  );
}

/** The ERP's attendance register itself is failing (on KL's side); say so instead of showing an empty term. */
function RegisterDown({ message, asOf, now }: { message: string; asOf: string | null; now: number }) {
  return (
    <div role="status" className="my-4 rounded-2xl bg-[#1a1306] p-4 ring-1 ring-[#3d2c0a]">
      <p className="flex gap-2 text-[#ffd8a0]">
        <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <span className="block text-[15px] font-semibold">KL ERP’s attendance register is down</span>
          <span className="mt-1 block text-[13px] leading-relaxed pretty">
            {message}{' '}
            {asOf
              ? `These numbers are from ${ago(asOf, now)}. Attenly refreshes them once the register works again.`
              : 'Attenly checks again on every sync and fills this in once the register works again.'}
          </span>
        </span>
      </p>
    </div>
  );
}

function RepairNotice({ message, onRepair }: { message?: string | null; onRepair: () => void }) {
  return (
    <div className="mt-5 rounded-2xl bg-[#1a1306] p-4 ring-1 ring-[#3d2c0a]">
      <p className="flex gap-2 text-[14px] text-[#ffd8a0]">
        <WarningCircle size={18} className="mt-px shrink-0" aria-hidden />
        <span>{message ?? 'Syncing is paused until you enter your ERP password again.'}</span>
      </p>
      <button type="button" onClick={onRepair} className="btn btn-mark btn-sm press mt-3">
        Enter password
      </button>
    </div>
  );
}

function RepairSheet({
  open,
  onClose,
  universityId,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  universityId?: string;
  onLinked: (id: string, snap: import('@/lib/db/snapshots').ClientSnapshot) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Enter your ERP password">
      {open && universityId && (
        <LinkForm
          mode="repair"
          universityId={universityId}
          onLinked={(id, snap) => {
            onClose();
            void onLinked(id, snap);
          }}
        />
      )}
    </Sheet>
  );
}
