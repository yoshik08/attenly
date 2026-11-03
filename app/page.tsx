'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { SignIn, FirstLink } from '@/components/gate';
import { CourseRow, BAND_INK } from '@/components/course';
import { Figure, claimIntro, pencilSweep } from '@/components/motion';
import { Sheet } from '@/components/overlay';
import { LinkForm } from '@/components/link-form';
import { BootScreen, LoadError } from '@/components/states';
import { cn } from '@/components/cn';
import { bandLabel, courseTcbr, overallPct, policyBand } from '@/lib/math';
import { deltaOf, nextClassOf, plateFor, summarize } from '@/lib/insights';
import { useNow } from '@/lib/time';
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
  const plate = useMemo(() => plateFor(summaries, settings.thresholds), [summaries, settings.thresholds]);
  const overall = useMemo(
    () => overallPct(subjects, settings.weights, (code) => courseTcbr(code, settings.tcbr)),
    [subjects, settings.weights, settings.tcbr],
  );
  const overallBand = policyBand(overall, settings.thresholds);
  const onSeen = useCallback((code: string) => markSeen(code), [markSeen]);

  useEffect(() => {
    if (intro) pencilSweep(list.current);
  }, [intro]);

  // Arriving from the plate or the timetable: bring the course into view and mark it.
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

        {plate && (
          <a href={plate.code ? `#course-${plate.code}` : undefined} className="plate press mt-5 block p-4 lg:p-5">
            <p className="text-[17px] font-semibold leading-snug balance">{plate.sentence}</p>
          </a>
        )}

        {overall != null && (
          <div className="mt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-dropout-text">Overall, weighted</p>
                <p className={cn('mt-0.5 text-[13px] font-semibold', BAND_INK[overallBand])}>{bandLabel(overallBand)}</p>
              </div>
              <Figure value={overall} countUp={intro} className="figure text-[48px]" />
            </div>
            <Scale pct={overall} floor={settings.thresholds.condonationFrom} cruise={settings.thresholds.safeAt} />
          </div>
        )}

        <div className="mt-6 hidden lg:block">
          <Legend />
        </div>
      </aside>

      <section aria-label="Courses" className="mt-6 lg:mt-6">
        <div className="seam-b pb-4 lg:hidden">
          <Legend />
        </div>
        {summaries.length === 0 ? (
          <div className="py-10">
            <p className="text-[15px] font-semibold">The ERP shows no attendance for {termLabel || 'this term'}.</p>
            <p className="mt-1 text-[13px] text-dropout-text">
              Courses appear here once classes are marked.{' '}
              <Link href="/settings#semester" className="underline decoration-seam-strong hover:text-mark">
                Look at another semester
              </Link>
            </p>
          </div>
        ) : (
          <div ref={list}>
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
        <p className="mt-6 text-[12px] text-dropout-quiet pretty">
          Figures follow the ERP’s weighted formula (lecture and tutorial 100, practical 50, skilling 25), rounded up.
          Each bubble row on its own: skipping one class type assumes you attend the rest. Double-check the ERP before
          making the call.
        </p>
      </section>
      <RepairSheet open={repairing} onClose={() => setRepairing(false)} universityId={activeAccount?.universityId} onLinked={onLinked} />
    </div>
  );
}

function Scale({ pct, floor, cruise }: { pct: number | null; floor: number; cruise: number }) {
  const v = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const ink = pct == null ? 'bg-dropout' : pct >= cruise ? 'bg-cruise' : pct >= floor ? 'bg-thin' : 'bg-red';
  return (
    <div className="mt-3" aria-hidden>
      <div className="relative h-1.5 rounded-full bg-seam">
        <div className={cn('absolute inset-y-0 left-0 rounded-full', ink)} style={{ width: `${v}%` }} />
        <span className="absolute -top-1 h-3.5 w-px bg-dropout-text" style={{ left: `${floor}%` }} />
        <span className="absolute -top-1 h-3.5 w-px bg-mark" style={{ left: `${cruise}%` }} />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-dropout-quiet tnum">
        <span className="absolute -translate-x-1/2" style={{ left: `${floor}%` }}>
          {floor}
        </span>
        <span className="absolute -translate-x-1/2 text-dropout-text" style={{ left: `${cruise}%` }}>
          {cruise}
        </span>
      </div>
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
