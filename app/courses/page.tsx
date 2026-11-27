'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Books } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { Segmented } from '@/components/segmented';
import { useRecord } from '@/components/records';
import { RecordLine, RecordProblem, RecordSkeleton, nameCase } from '@/components/record-ui';
import type { CourseClass } from '@/lib/erp/records-parse';

export default function CoursesPage() {
  return (
    <DataGate title="Courses">
      <Courses />
    </DataGate>
  );
}

const TYPE_ORDER = ['L', 'T', 'P', 'S'];
const TYPE_LABEL: Record<string, string> = { L: 'Lecture', T: 'Tutorial', P: 'Practical', S: 'Skilling' };

/** Odd, then Even, then Term 3 / summer / anything else. */
function termRank(semester: string): number {
  if (/odd/i.test(semester)) return 1;
  if (/even/i.test(semester)) return 2;
  return 3;
}

interface CourseGroup {
  code: string;
  title: string;
  classes: CourseClass[];
}

function Courses() {
  const { snapshot } = useStore();
  const rec = useRecord('courses');
  const classes = useMemo(() => rec.data?.classes ?? [], [rec.data]);

  // Study years with their academic year, ascending; each with its terms in Odd → Even → Term 3 order.
  const years = useMemo(() => {
    const by = new Map<string, { academicYear: string; terms: Set<string> }>();
    for (const c of classes) {
      if (!c.studyYear) continue;
      const y = by.get(c.studyYear) ?? { academicYear: c.academicYear, terms: new Set<string>() };
      if (c.semester) y.terms.add(c.semester);
      by.set(c.studyYear, y);
    }
    return [...by.entries()]
      .map(([studyYear, y]) => ({
        studyYear,
        academicYear: y.academicYear,
        terms: [...y.terms].sort((a, b) => termRank(a) - termRank(b) || a.localeCompare(b)),
      }))
      .sort((a, b) => Number(a.studyYear) - Number(b.studyYear) || a.studyYear.localeCompare(b.studyYear));
  }, [classes]);

  // The synced term, when the course data has it.
  const synced = useMemo(() => {
    const t = snapshot?.term;
    const label = t?.yearLabel || snapshot?.termOptions?.years.find((y) => y.id === t?.academicyear)?.label || '';
    if (!t || !label) return null;
    const y = years.find((x) => x.academicYear === label && x.terms.includes(t.semester));
    return y ? { year: y.studyYear, term: t.semester } : null;
  }, [snapshot, years]);

  // The synced term when the data has it, else the newest.
  const fallback = useMemo(() => {
    if (synced) return synced;
    const newest = years[years.length - 1];
    return newest ? { year: newest.studyYear, term: newest.terms[newest.terms.length - 1] ?? '' } : null;
  }, [synced, years]);

  const [picked, setPicked] = useState<{ year: string; term: string } | null>(null);
  const valid = picked && years.some((y) => y.studyYear === picked.year && y.terms.includes(picked.term)) ? picked : null;
  const sel = valid ?? fallback;
  const yearInfo = years.find((y) => y.studyYear === sel?.year) ?? null;

  const groups = useMemo<CourseGroup[]>(() => {
    if (!sel) return [];
    const by = new Map<string, CourseGroup>();
    for (const c of classes) {
      if (c.studyYear !== sel.year || c.semester !== sel.term) continue;
      const g = by.get(c.code) ?? { code: c.code, title: c.title, classes: [] };
      g.classes.push(c);
      by.set(c.code, g);
    }
    for (const g of by.values()) {
      g.classes.sort((a, b) => {
        const ia = TYPE_ORDER.indexOf(a.ltps);
        const ib = TYPE_ORDER.indexOf(b.ltps);
        return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.section.localeCompare(b.section);
      });
    }
    return [...by.values()];
  }, [classes, sel]);

  // Periods a week per course and component, from the timetable — which is only the synced term's.
  const isSynced = Boolean(sel && synced && sel.year === synced.year && sel.term === synced.term);
  const weekly = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    if (!isSynced) return m;
    for (const d of snapshot?.timetable ?? []) {
      for (const p of d.periods) {
        if (!p.subjectCode || !p.type) continue;
        const c = m.get(p.subjectCode) ?? new Map<string, number>();
        c.set(p.type, (c.get(p.type) ?? 0) + 1);
        m.set(p.subjectCode, c);
      }
    }
    return m;
  }, [isSynced, snapshot]);

  // Credits the CGPA grid prints for courses with a result.
  const credits = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of snapshot?.cgpaRows ?? []) if (r.courseCode && r.credits > 0) m.set(r.courseCode.trim(), r.credits);
    return m;
  }, [snapshot]);

  const pickYear = (year: string) => {
    const y = years.find((x) => x.studyYear === year);
    if (!y) return;
    const term = sel && y.terms.includes(sel.term) ? sel.term : (y.terms[y.terms.length - 1] ?? '');
    setPicked({ year, term });
  };

  return (
    <div className="page-in">
      <PageHeader
        title="Courses"
        sub={
          <RecordLine fetchedAt={rec.fetchedAt} loading={rec.loading} onRefresh={rec.refresh}>
            {rec.data && sel && (
              <span className="tnum">
                {groups.length} course{groups.length === 1 ? '' : 's'}
              </span>
            )}
          </RecordLine>
        }
      />
      <RecordProblem error={rec.error} code={rec.code} hasData={Boolean(rec.data)} />

      {years.length > 0 && sel && (
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented
            label="Year"
            value={sel.year}
            onChange={pickYear}
            options={years.map((y) => ({ value: y.studyYear, label: `Year ${y.studyYear}`, hint: y.academicYear }))}
          />
          {yearInfo && yearInfo.terms.length > 0 && (
            <Segmented
              label="Term"
              value={sel.term}
              onChange={(term) => setPicked({ year: sel.year, term })}
              options={yearInfo.terms.map((t) => ({ value: t, label: t }))}
            />
          )}
        </div>
      )}

      {!rec.data && rec.loading ? (
        <RecordSkeleton cards={4} />
      ) : !rec.data ? null : classes.length === 0 ? (
        <Empty icon={Books} title="No courses on the ERP yet.">
          Your courses, with their sections and faculty, show up here once the ERP maps them to you.
        </Empty>
      ) : groups.length === 0 ? (
        <Empty icon={Books} title="No courses on the ERP for this term." />
      ) : (
        <>
          {yearInfo && sel && (
            <p className="mt-7 text-[13px] font-semibold text-fg-2">
              {sel.term} <span className="text-fg-3 tnum">{yearInfo.academicYear}</span>
            </p>
          )}
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-3 md:grid-cols-2 lg:gap-4">
            {groups.map((g, i) => (
              <CourseCard key={g.code} group={g} index={i} weekly={weekly.get(g.code)} credits={credits.get(g.code)} />
            ))}
          </div>
        </>
      )}

      <Footnote>From the Courses tab of your ERP profile, read when you open this screen. L-T-P-S hours come from your synced timetable; credits from your results, or worked out from those hours (≈) until a result is out.</Footnote>
    </div>
  );
}

/** Credits from the weekly hours, KL style: a credit per lecture or tutorial hour, per 2 practical hours, per 4 skilling hours. */
function creditsFrom(weekly: Map<string, number>): number {
  const h = (t: string) => weekly.get(t) ?? 0;
  return h('L') + h('T') + h('P') / 2 + h('S') / 4;
}

const fmtCredits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));

function CourseCard({
  group,
  index,
  weekly,
  credits,
}: {
  group: CourseGroup;
  index: number;
  weekly?: Map<string, number>;
  /** From the CGPA grid, once the course has a result. */
  credits?: number;
}) {
  const title = nameCase(group.title);
  const hours = weekly ? TYPE_ORDER.map((t) => weekly.get(t) ?? 0) : null;
  const total = hours ? hours.reduce((a, n) => a + n, 0) : 0;
  const worked = weekly && total > 0 ? creditsFrom(weekly) : null;
  const shownCredits = credits ?? worked;
  return (
    <article className="card rise min-w-0 p-5" style={{ '--i': index } as CSSProperties} aria-label={title}>
      <p className="mono text-[12px] text-fg-3">{group.code}</p>
      <h3 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] pretty">{title}</h3>
      {(total > 0 || shownCredits != null) && (
        <dl className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
          {hours && total > 0 && (
            <div
              className="flex items-baseline gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1"
              title={TYPE_ORDER.map((t, i) => `${TYPE_LABEL[t]} ${hours[i]}`).join(' · ') + ' periods a week'}
            >
              <dt className="text-fg-3">L-T-P-S</dt>
              <dd className="mono tnum font-semibold text-fg">{hours.join('-')}</dd>
            </div>
          )}
          {total > 0 && (
            <div className="flex items-baseline gap-1 rounded-full bg-white/[0.06] px-2.5 py-1">
              <dd className="tnum font-semibold text-fg">{total}</dd>
              <dt className="text-fg-3">a week</dt>
            </div>
          )}
          {shownCredits != null && (
            <div
              className="flex items-baseline gap-1 rounded-full bg-white/[0.06] px-2.5 py-1"
              title={credits != null ? 'From your results' : 'Worked out from the weekly hours: L + T + P/2 + S/4'}
            >
              <dd className="tnum font-semibold text-fg">
                {credits == null && '≈'}
                {fmtCredits(shownCredits)}
              </dd>
              <dt className="text-fg-3">credit{shownCredits === 1 ? '' : 's'}</dt>
            </div>
          )}
        </dl>
      )}
      <ul className="mt-4 flex flex-col gap-1" aria-label={`${title}: classes`}>
        {group.classes.map((c, i) => (
          <li
            key={`${c.ltps}-${c.section}-${i}`}
            className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 rounded-[12px] bg-white/[0.035] px-3 py-2 text-[13px]"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-semibold text-fg">{TYPE_LABEL[c.ltps] ?? c.ltps}</span>
              {c.section && <span className="mono truncate text-[12px] text-fg-3">{c.section}</span>}
            </span>
            <span className="min-w-0 truncate text-right text-fg-2" title={c.faculty || undefined}>
              {c.faculty ? nameCase(c.faculty) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
