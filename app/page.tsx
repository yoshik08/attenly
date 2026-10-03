'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePlanner } from '@/components/data-context';
import { Badge, Button, Card, Container, EmptyState, ProgressBar, SectionTitle, bandTone } from '@/components/ui';
import { cn } from '@/components/cn';
import {
  bandLabel,
  classImpact,
  fmtDelta,
  fmtPct,
  policyBand,
  skipGuidance,
  weightedParts,
  weightedPct,
  type ComponentKey,
  type SubjectAttendance,
} from '@/lib/math';
import { SUBJECT_COLORS } from '@/lib/sample-data';
import type { TimetableDay } from '@/lib/erp/parsers';

function colorFor(code: string): string {
  if (SUBJECT_COLORS[code]) return SUBJECT_COLORS[code];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 55%)`;
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function allPeriods(timetable: TimetableDay[]): string[] {
  const set = new Map<string, { order: number; start: string }>();
  for (const d of timetable) {
    for (const p of d.periods) {
      if (!set.has(p.period)) {
        const n = parseInt(p.period.replace(/\D/g, ''), 10);
        set.set(p.period, { order: Number.isNaN(n) ? 999 : n, start: p.start });
      }
    }
  }
  return [...set.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].start.localeCompare(b[1].start))
    .map(([k]) => k);
}

/** Projected % if the student attends every remaining class this week. */
function projectedPct(
  subj: SubjectAttendance,
  timetable: TimetableDay[],
  weights: Record<ComponentKey, number>,
): number | null {
  const { attW, condW } = weightedParts(subj, weights);
  if (condW <= 0) return null;
  const jsDay = new Date().getDay(); // 0=Sun..6=Sat
  const todayIdx = jsDay === 0 ? 7 : jsDay; // Mon=1..Sat=6, Sun=7 (nothing left)
  let remW = 0;
  for (const d of timetable) {
    const idx = DAY_ORDER.indexOf(d.day) + 1;
    if (idx < todayIdx) continue;
    for (const p of d.periods) {
      if (p.subjectCode === subj.code) remW += weights[p.type ?? 'L'] ?? 0;
    }
  }
  return ((attW + remW) / (condW + remW)) * 100;
}

export default function PlanPage() {
  const { ready, hasData, subjects, timetable, settings, term, syncedAt, loadSample } = usePlanner();
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const periods = useMemo(() => allPeriods(timetable), [timetable]);
  const days = useMemo(
    () => DAY_ORDER.map((d) => timetable.find((t) => t.day === d)).filter(Boolean) as TimetableDay[],
    [timetable],
  );
  const selSubj = useMemo(
    () => subjects.find((s) => s.code === selected) ?? subjects[0] ?? null,
    [subjects, selected],
  );

  if (!ready) return <Container className="py-10"><p className="text-sm text-neutral-500">Loading…</p></Container>;

  if (!hasData) {
    return (
      <Container className="py-10">
        <EmptyState
          title="No attendance data yet"
          hint="Sync with the KL University ERP to pull your timetable and attendance, or explore with sample data first."
          action={
            <div className="flex gap-2">
              <Link href="/sync"><Button>Sync with the ERP</Button></Link>
              <Button variant="secondary" onClick={loadSample}>Try with sample data</Button>
            </div>
          }
        />
      </Container>
    );
  }

  const { thresholds, weights } = settings;
  const pct = selSubj ? weightedPct(selSubj, weights) : null;
  const proj = selSubj ? projectedPct(selSubj, timetable, weights) : null;
  const band = policyBand(pct, thresholds);
  const guide = selSubj ? skipGuidance(selSubj, weights, thresholds) : null;

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Attendance planner</p>
          <h1 className="text-3xl font-bold">Plan this week</h1>
          {term && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {term.academicyear} · {term.semester}
              {syncedAt && <> · synced {new Date(syncedAt).toLocaleString()}</>}
            </p>
          )}
        </div>
        {selSubj && (
          <Card className="w-full max-w-md p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selSubj.code} · {selSubj.title}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Now <span className="font-bold text-neutral-900 dark:text-neutral-100">{fmtPct(pct)}</span>
                  {proj != null && (
                    <> → <span className="font-bold text-indigo-600 dark:text-indigo-400">{fmtPct(proj)}</span> if you attend everything left this week</>
                  )}
                </p>
              </div>
              <Badge tone={bandTone(band)}>{bandLabel(band, thresholds)}</Badge>
            </div>
            <ProgressBar pct={pct} thresholds={thresholds} className="mt-2" />
            {guide && (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Can skip <span className="font-bold text-neutral-900 dark:text-neutral-100">{guide.keepSafe}</span> more and stay safe ·{' '}
                <span className="font-bold text-neutral-900 dark:text-neutral-100">{guide.stayAboveCondonation}</span> before condonation risk
              </p>
            )}
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Timetable grid */}
        <Card className="animate-rise overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-16 border-b border-neutral-200 p-2 text-left text-xs font-semibold text-neutral-500 dark:border-neutral-800" />
                  {days.map((d) => (
                    <th key={d.day} className="border-b border-neutral-200 p-2 text-left text-xs font-semibold text-neutral-500 dark:border-neutral-800">
                      {d.day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((per) => (
                  <tr key={per}>
                    <td className="border-b border-neutral-100 p-2 align-top text-xs font-semibold text-neutral-400 dark:border-neutral-800/60">
                      {per}
                    </td>
                    {days.map((d) => {
                      const p = d.periods.find((x) => x.period === per);
                      if (!p) return <td key={d.day} className="border-b border-neutral-100 p-1 dark:border-neutral-800/60" />;
                      const subj = subjects.find((s) => s.code === p.subjectCode);
                      const impact = subj ? classImpact(subj, weights, p.type ?? 'L') : null;
                      const isSel = selSubj?.code === p.subjectCode;
                      return (
                        <td key={d.day} className="border-b border-neutral-100 p-1 align-top dark:border-neutral-800/60">
                          <button
                            onClick={() => setSelected(p.subjectCode)}
                            title={`${p.subjectTitle}${p.room ? ` · ${p.room}` : ''}${p.start ? ` · ${p.start}–${p.end}` : ''}`}
                            className={cn(
                              'w-full rounded-lg border p-2 text-left transition hover:shadow-sm',
                              isSel
                                ? 'border-indigo-500 ring-1 ring-indigo-500 dark:border-indigo-400'
                                : 'border-neutral-200 dark:border-neutral-800',
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(p.subjectCode) }} />
                              <span className="truncate text-xs font-bold">{p.subjectCode}</span>
                            </div>
                            {p.room && <p className="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">{p.room}</p>}
                            {impact && impact.gain > 0.05 && (
                              <span
                                className="mt-1 inline-block rounded-full bg-emerald-500/10 px-1.5 py-px text-[11px] font-bold text-emerald-700 dark:text-emerald-400"
                                title={`Attending adds ${fmtDelta(impact.gain)} · missing costs ${fmtDelta(-impact.loss)}`}
                              >
                                {fmtDelta(impact.gain)}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Badge = how much this class is worth if you attend it. Click a class to inspect its subject.
          </p>
        </Card>

        {/* Subjects panel */}
        <div>
          <SectionTitle eyebrow="Subjects" title="Your courses" />
          <div className="flex flex-col gap-3">
            {subjects.map((s) => {
              const sp = weightedPct(s, weights);
              const b = policyBand(sp, thresholds);
              const g = skipGuidance(s, weights, thresholds);
              const isOpen = expanded === s.code;
              return (
                <Card key={s.code} className={cn('p-3', (selected === s.code || (!selected && selSubj?.code === s.code)) ? 'ring-1 ring-indigo-500' : '')}>
                  <button className="w-full text-left" onClick={() => { setSelected(s.code); setExpanded(isOpen ? null : s.code); }}>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(s.code) }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{s.code}</p>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{s.title}</p>
                      </div>
                      <span className="text-sm font-bold">{fmtPct(sp)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge tone={bandTone(b)} className="text-[11px]">{bandLabel(b, thresholds)}</Badge>
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        Can skip <b className="text-neutral-900 dark:text-neutral-100">{g.keepSafe}</b>
                      </span>
                    </div>
                    <ProgressBar pct={sp} thresholds={thresholds} className="mt-2" />
                  </button>
                  {isOpen && (
                    <div className="mt-3 border-t border-neutral-200 pt-2 text-xs dark:border-neutral-800">
                      {(['L', 'T', 'P', 'S'] as ComponentKey[]).map((k) => {
                        const c = s.components[k];
                        if (!c || c.conducted === 0) return null;
                        const p = (c.attended / c.conducted) * 100;
                        return (
                          <div key={k} className="flex items-center justify-between py-0.5">
                            <span className="text-neutral-500 dark:text-neutral-400">
                              {k === 'L' ? 'Lecture' : k === 'T' ? 'Tutorial' : k === 'P' ? 'Practical' : 'Skilling'}
                            </span>
                            <span className="font-semibold">{c.attended}/{c.conducted} · {p.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                      {sp == null && <p className="text-neutral-500">No classes conducted yet.</p>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </Container>
  );
}
