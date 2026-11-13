'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, Books } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { SignIn, FirstLink } from '@/components/gate';
import { CourseRow } from '@/components/course';
import { UpNext } from '@/components/up-next';
import { claimIntro } from '@/components/motion';
import { Sheet } from '@/components/overlay';
import { LinkForm } from '@/components/link-form';
import { BootScreen, LoadError } from '@/components/states';
import { Empty, Footnote, Notice, PageHeader, TermLine } from '@/components/page';
import { deltaOf, nextClassOf, summarize, type CourseSummary } from '@/lib/insights';
import { ago, useNow } from '@/lib/time';
import { termText } from '@/lib/terms';
import type { ClientSnapshot } from '@/lib/db/snapshots';

export default function AttendancePage() {
  const store = useStore();
  if (store.phase === 'boot') return <BootScreen />;
  if (store.phase === 'signed-out') return <SignIn />;
  if (store.phase === 'error' && !store.snapshot) return <LoadError message={store.loadError} onRetry={store.refresh} />;
  if (store.accounts.length === 0) return <FirstLink />;
  return <Attendance />;
}

function Attendance() {
  const { snapshot, settings, seen, markSeen, activeAccount, accounts, sync, forceSync, onLinked } = useStore();
  const now = useNow(60_000);
  const [intro] = useState(() => claimIntro());
  const [repairing, setRepairing] = useState(false);

  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const summaries = useMemo(() => subjects.map((s) => summarize(s, settings)), [subjects, settings]);
  const byCode = useMemo(() => new Map<string, CourseSummary>(summaries.map((s) => [s.code, s])), [summaries]);
  const onSeen = useCallback((code: string) => markSeen(code), [markSeen]);

  // Arriving from the timetable or Up next: bring the course into view and mark it.
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
  const sub = (
    <TermLine term={termLabel}>
      {label && <span className="text-fg-3">Showing {label}</span>}
    </TermLine>
  );

  if (!snapshot) {
    return (
      <div className="page-in mx-auto max-w-[620px]">
        <PageHeader title="Attendance" />
        {activeAccount?.needsPassword ? (
          <RepairNotice message={activeAccount.lastError?.message} onRepair={() => setRepairing(true)} />
        ) : (
          <Empty
            icon={ArrowsClockwise}
            title={
              sync.running ? (
                <span className="t-shimmer" data-text="Signing into the ERP and pulling your data">
                  Signing into the ERP and pulling your data
                </span>
              ) : (
                'Nothing synced for this account yet.'
              )
            }
            action={
              !sync.running && (
                <button type="button" className="btn btn-primary press lg lg-btn" onClick={() => void forceSync()}>
                  <ArrowsClockwise size={18} aria-hidden /> Sync now
                </button>
              )
            }
          >
            {sync.running ? 'The first sync takes about 20 seconds.' : (sync.message ?? 'Sync now to pull it from the ERP.')}
          </Empty>
        )}
        <RepairSheet open={repairing} onClose={() => setRepairing(false)} universityId={activeAccount?.universityId} onLinked={onLinked} />
      </div>
    );
  }

  return (
    <div className="page-in">
      <PageHeader title="Attendance" sub={sub} />

      {(activeAccount?.needsPassword || snapshot.issues?.attendance) && (
        <div className="mt-6 flex flex-col gap-3">
          {activeAccount?.needsPassword && <RepairNotice message={activeAccount.lastError?.message} onRepair={() => setRepairing(true)} />}
          {snapshot.issues?.attendance && (
            <RegisterDown message={snapshot.issues.attendance} asOf={summaries.length > 0 ? snapshot.attendanceSyncedAt : null} now={now} />
          )}
        </div>
      )}

      {summaries.length > 0 && (
        <UpNext timetable={snapshot.timetable} subjects={subjects} summaries={byCode} settings={settings} now={now} />
      )}

      <section aria-label="Courses" className="mt-10 lg:mt-12">
        {summaries.length === 0 ? (
          !snapshot.issues?.attendance && (
            <Empty
              icon={Books}
              title={`The ERP shows no attendance for ${termLabel || 'this term'}.`}
              action={
                <Link href="/settings#semester" className="btn btn-secondary btn-sm press lg lg-btn">
                  Look at another semester
                </Link>
              }
            >
              Courses appear here once classes are marked.
            </Empty>
          )
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="h2">
                Courses <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3 tnum">{summaries.length}</span>
              </h2>
              <p className="text-[13px] text-fg-2">
                Budgets aim at <span className="font-semibold text-fg tnum">{settings.target}%</span>{' '}
                <Link href="/settings#target" className="link ml-1">
                  Change
                </Link>
              </p>
            </div>
            <div className="grid items-start gap-3 md:grid-cols-2 lg:gap-4">
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
                  index={i}
                />
              ))}
            </div>
            <Footnote>
              Figures follow the ERP’s weighted formula (lecture and tutorial 100, practical 50, skilling 25), rounded up. Each
              class type is counted on its own: skipping one type assumes you attend the rest. Double-check the ERP before
              making the call.
            </Footnote>
          </>
        )}
      </section>
      <RepairSheet open={repairing} onClose={() => setRepairing(false)} universityId={activeAccount?.universityId} onLinked={onLinked} />
    </div>
  );
}

/** The ERP's attendance register itself is failing (on KL's side); say so instead of showing an empty term. */
function RegisterDown({ message, asOf, now }: { message: string; asOf: string | null; now: number }) {
  return (
    <Notice role="status" title="KL ERP’s attendance register is down">
      {message}{' '}
      {asOf
        ? `These numbers are from ${ago(asOf, now)}. Attenly refreshes them once the register works again.`
        : 'Attenly checks again on every sync and fills this in once the register works again.'}
    </Notice>
  );
}

function RepairNotice({ message, onRepair }: { message?: string | null; onRepair: () => void }) {
  return (
    <Notice
      title={message ?? 'Syncing is paused until you enter your ERP password again.'}
      action={
        <button type="button" onClick={onRepair} className="btn btn-primary btn-sm press lg lg-btn">
          Enter password
        </button>
      }
      className="mt-6 first:mt-0"
    />
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
  onLinked: (id: string, snap: ClientSnapshot) => Promise<void>;
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
