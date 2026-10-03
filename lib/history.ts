/**
 * History derivations: per-day status, streaks, and weekly buckets,
 * computed from the timetable + the locally tracked attendance log.
 */
import type { TimetableDay } from './erp/parsers';
import { classKey, type AttendanceLog } from './sample-data';

export type DayStatus = 'all' | 'some' | 'none' | 'unscheduled' | 'future' | 'unmarked';

export interface DaySummary {
  date: string; // YYYY-MM-DD
  scheduled: number;
  present: number;
  absent: number;
  status: DayStatus;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function scheduledFor(dateISO: string, timetable: TimetableDay[]): TimetableDay['periods'] {
  const d = new Date(`${dateISO}T12:00:00`);
  const name = DAY_NAMES[d.getDay()];
  return timetable.find((t) => t.day === name)?.periods ?? [];
}

export function daySummary(dateISO: string, timetable: TimetableDay[], log: AttendanceLog): DaySummary {
  const today = isoOf(new Date());
  const periods = scheduledFor(dateISO, timetable);
  if (periods.length === 0) return { date: dateISO, scheduled: 0, present: 0, absent: 0, status: 'unscheduled' };
  if (dateISO > today) return { date: dateISO, scheduled: periods.length, present: 0, absent: 0, status: 'future' };
  const entries = log[dateISO];
  if (!entries || Object.keys(entries).length === 0) {
    return { date: dateISO, scheduled: periods.length, present: 0, absent: 0, status: dateISO === today ? 'unmarked' : 'unmarked' };
  }
  let present = 0;
  let absent = 0;
  for (const p of periods) {
    const key = classKey(dayNameOf(dateISO, timetable), p.period, p.subjectCode);
    const v = entries[key];
    if (v === true) present++;
    else if (v === false) absent++;
  }
  const marked = present + absent;
  const status: DayStatus =
    marked === 0 ? 'unmarked' : absent === 0 ? 'all' : present === 0 ? 'none' : 'some';
  return { date: dateISO, scheduled: periods.length, present, absent, status };
}

function dayNameOf(dateISO: string, timetable: TimetableDay[]): string {
  const d = new Date(`${dateISO}T12:00:00`);
  const js = DAY_NAMES[d.getDay()];
  return timetable.find((t) => t.day === js)?.day ?? js;
}

/** Consecutive "went to all" days ending today/yesterday (current) and best run ever. */
export function computeStreaks(timetable: TimetableDay[], log: AttendanceLog): { current: number; best: number } {
  let current = 0;
  let best = 0;
  let run = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Walk back up to 400 days.
  const countedBack: boolean[] = [];
  for (let back = 0; back < 400; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const iso = isoOf(d);
    const s = daySummary(iso, timetable, log);
    if (s.status === 'unscheduled' || s.status === 'future' || s.status === 'unmarked') {
      countedBack.push(false);
      continue;
    }
    const perfect = s.status === 'all';
    countedBack.push(perfect);
  }
  // Current streak: leading run of true (allow today to be unmarked/unfinished).
  let i = 0;
  if (!countedBack[0]) i = 1;
  while (i < countedBack.length && countedBack[i]) {
    current++;
    i++;
  }
  // Best streak anywhere.
  for (const v of countedBack) {
    if (v) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return { current, best };
}

export interface WeekBucket {
  weekStart: string; // Monday ISO
  scheduled: number;
  went: number;
  missed: number;
  pct: number | null;
  perSubject: Record<string, { went: number; missed: number; pct: number | null }>;
}

/** Last N Monday-anchored weeks of tracked attendance. */
export function weekBuckets(
  timetable: TimetableDay[],
  log: AttendanceLog,
  weeks = 8,
): WeekBucket[] {
  const out: WeekBucket[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // days since Monday
  const thisMonday = new Date(today);
  thisMonday.setDate(thisMonday.getDate() - dow);

  for (let w = weeks - 1; w >= 0; w--) {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - w * 7);
    const weekStart = isoOf(monday);
    let scheduled = 0;
    let went = 0;
    const perSubject: WeekBucket['perSubject'] = {};
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(date.getDate() + d);
      const iso = isoOf(date);
      if (iso > isoOf(today)) continue;
      const periods = scheduledFor(iso, timetable);
      const entries = log[iso] ?? {};
      const dayName = dayNameOf(iso, timetable);
      for (const p of periods) {
        scheduled++;
        const v = entries[classKey(dayName, p.period, p.subjectCode)];
        const rec = (perSubject[p.subjectCode] ??= { went: 0, missed: 0, pct: null });
        if (v === true) {
          went++;
          rec.went++;
        } else if (v === false) {
          rec.missed++;
        }
      }
    }
    const missed = scheduled - went;
    for (const rec of Object.values(perSubject)) {
      const tot = rec.went + rec.missed;
      rec.pct = tot > 0 ? (rec.went / tot) * 100 : null;
    }
    out.push({
      weekStart,
      scheduled,
      went,
      missed,
      pct: scheduled > 0 ? (went / scheduled) * 100 : null,
      perSubject,
    });
  }
  return out;
}

/** Weekly % trend per subject from the tracked log (last N weeks). */
export function trendsFromLog(
  timetable: TimetableDay[],
  log: AttendanceLog,
  codes: string[],
  weeks = 8,
): Record<string, number[]> {
  const buckets = weekBuckets(timetable, log, weeks);
  const out: Record<string, number[]> = {};
  for (const code of codes) {
    out[code] = buckets
      .map((b) => b.perSubject[code]?.pct)
      .filter((v): v is number => v != null);
  }
  return out;
}

/** Subject with the most missed classes (from ERP totals). */
export function missedMost(
  subjects: Array<{ code: string; title: string; components: Record<string, { conducted: number; attended: number }> }>,
): { code: string; title: string; missed: number } | null {
  let best: { code: string; title: string; missed: number } | null = null;
  for (const s of subjects) {
    let conducted = 0;
    let attended = 0;
    for (const c of Object.values(s.components)) {
      conducted += c.conducted;
      attended += c.attended;
    }
    const missed = conducted - attended;
    if (!best || missed > best.missed) best = { code: s.code, title: s.title, missed };
  }
  return best && best.missed > 0 ? best : null;
}
