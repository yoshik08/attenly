/**
 * Realistic fixture data so every page works without an ERP login
 * ("Try with sample data"). Seeded relative to today so the History
 * calendar always looks alive.
 */
import type { SubjectAttendance } from './math';
import type { TimetableDay } from './erp/parsers';

export const SAMPLE_SUBJECTS: SubjectAttendance[] = [
  {
    code: 'CS201',
    title: 'Data Structures and Algorithms',
    components: {
      L: { conducted: 28, attended: 22 },
      T: { conducted: 10, attended: 7 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  },
  {
    code: 'CS202',
    title: 'Operating Systems',
    components: {
      L: { conducted: 26, attended: 24 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 12, attended: 12 },
      S: { conducted: 0, attended: 0 },
    },
  },
  {
    code: 'CS203',
    title: 'Machine Learning',
    components: {
      L: { conducted: 24, attended: 17 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 10, attended: 6 },
      S: { conducted: 0, attended: 0 },
    },
  },
  {
    code: 'CS204',
    title: 'Database Management Systems',
    components: {
      L: { conducted: 25, attended: 25 },
      T: { conducted: 8, attended: 8 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  },
  {
    code: 'SKL301',
    title: 'Skilling: Full-Stack Web Development',
    components: {
      L: { conducted: 0, attended: 0 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 16, attended: 13 },
    },
  },
  {
    code: 'MGT201',
    title: 'Professional Ethics',
    components: {
      L: { conducted: 14, attended: 9 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  },
];

export const SUBJECT_COLORS: Record<string, string> = {
  CS201: '#8b5cf6',
  CS202: '#22d3ee',
  CS203: '#a3e635',
  CS204: '#e879f9',
  SKL301: '#38bdf8',
  MGT201: '#fbbf24',
};

const P = (
  period: string,
  start: string,
  end: string,
  subjectCode: string,
  subjectTitle: string,
  room: string,
  faculty: string,
  type: 'L' | 'T' | 'P' | 'S',
) => ({ period, start, end, subjectCode, subjectTitle, room, faculty, type });

export const SAMPLE_TIMETABLE: TimetableDay[] = [
  {
    day: 'Mon',
    periods: [
      P('P1', '09:00', '09:50', 'CS201', 'Data Structures and Algorithms', 'R-304', 'Dr. Rao', 'L'),
      P('P2', '09:50', '10:40', 'CS202', 'Operating Systems', 'R-305', 'Dr. Iyer', 'L'),
      P('P3', '11:00', '11:50', 'CS203', 'Machine Learning', 'Lab-2', 'Dr. Nair', 'P'),
      P('P4', '11:50', '12:40', 'CS203', 'Machine Learning', 'Lab-2', 'Dr. Nair', 'P'),
      P('P6', '14:20', '15:10', 'SKL301', 'Skilling: Full-Stack Web Development', 'Lab-5', 'Mr. Khan', 'S'),
    ],
  },
  {
    day: 'Tue',
    periods: [
      P('P1', '09:00', '09:50', 'CS204', 'Database Management Systems', 'R-304', 'Dr. Rao', 'L'),
      P('P2', '09:50', '10:40', 'CS201', 'Data Structures and Algorithms', 'R-304', 'Dr. Rao', 'T'),
      P('P3', '11:00', '11:50', 'CS202', 'Operating Systems', 'Lab-1', 'Dr. Iyer', 'P'),
      P('P4', '11:50', '12:40', 'CS202', 'Operating Systems', 'Lab-1', 'Dr. Iyer', 'P'),
      P('P5', '13:30', '14:20', 'MGT201', 'Professional Ethics', 'R-201', 'Dr. Sen', 'L'),
    ],
  },
  {
    day: 'Wed',
    periods: [
      P('P1', '09:00', '09:50', 'CS203', 'Machine Learning', 'R-306', 'Dr. Nair', 'L'),
      P('P2', '09:50', '10:40', 'CS201', 'Data Structures and Algorithms', 'R-304', 'Dr. Rao', 'L'),
      P('P4', '11:50', '12:40', 'CS204', 'Database Management Systems', 'R-304', 'Dr. Rao', 'T'),
      P('P6', '14:20', '15:10', 'SKL301', 'Skilling: Full-Stack Web Development', 'Lab-5', 'Mr. Khan', 'S'),
      P('P7', '15:30', '16:20', 'SKL301', 'Skilling: Full-Stack Web Development', 'Lab-5', 'Mr. Khan', 'S'),
    ],
  },
  {
    day: 'Thu',
    periods: [
      P('P1', '09:00', '09:50', 'CS202', 'Operating Systems', 'R-305', 'Dr. Iyer', 'L'),
      P('P2', '09:50', '10:40', 'CS204', 'Database Management Systems', 'R-304', 'Dr. Rao', 'L'),
      P('P3', '11:00', '11:50', 'CS201', 'Data Structures and Algorithms', 'R-304', 'Dr. Rao', 'L'),
      P('P5', '13:30', '14:20', 'CS203', 'Machine Learning', 'R-306', 'Dr. Nair', 'L'),
      P('P6', '14:20', '15:10', 'MGT201', 'Professional Ethics', 'R-201', 'Dr. Sen', 'L'),
    ],
  },
  {
    day: 'Fri',
    periods: [
      P('P1', '09:00', '09:50', 'CS201', 'Data Structures and Algorithms', 'R-304', 'Dr. Rao', 'L'),
      P('P3', '11:00', '11:50', 'CS202', 'Operating Systems', 'R-305', 'Dr. Iyer', 'L'),
      P('P4', '11:50', '12:40', 'CS204', 'Database Management Systems', 'R-304', 'Dr. Rao', 'L'),
      P('P5', '13:30', '14:20', 'CS203', 'Machine Learning', 'R-306', 'Dr. Nair', 'L'),
    ],
  },
  {
    day: 'Sat',
    periods: [
      P('P1', '09:00', '09:50', 'CS202', 'Operating Systems', 'Lab-1', 'Dr. Iyer', 'P'),
      P('P2', '09:50', '10:40', 'CS202', 'Operating Systems', 'Lab-1', 'Dr. Iyer', 'P'),
      P('P3', '11:00', '11:50', 'SKL301', 'Skilling: Full-Stack Web Development', 'Lab-5', 'Mr. Khan', 'S'),
    ],
  },
];

/** Per-day attendance log: dateISO -> classKey -> present? */
export type AttendanceLog = Record<string, Record<string, boolean>>;

export function classKey(day: string, period: string, code: string): string {
  return `${day}|${period}|${code}`;
}

/** Deterministic PRNG so sample data is stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Seed ~6 weeks of plausible per-class present/absent history. */
export function seedSampleLog(): AttendanceLog {
  const rnd = mulberry32(42);
  const log: AttendanceLog = {};
  // Per-subject skip propensity (higher = bunks more).
  const bunk: Record<string, number> = {
    CS201: 0.18, CS202: 0.05, CS203: 0.28, CS204: 0.0, SKL301: 0.15, MGT201: 0.32,
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let d = 42; d >= 1; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    if (date.getDay() === 0) continue; // no Sunday classes
    const jsDay = date.getDay(); // 1=Mon..6=Sat
    const day = SAMPLE_TIMETABLE.find((t) => DAY_INDEX[t.day] === jsDay);
    if (!day) continue;
    const iso = date.toISOString().slice(0, 10);
    const entry: Record<string, boolean> = {};
    // Whole-day moods: occasionally a full bunk day or a perfect day.
    const mood = rnd();
    const fullBunk = mood < 0.04;
    for (const p of day.periods) {
      const key = classKey(day.day, p.period, p.subjectCode);
      if (fullBunk) {
        entry[key] = false;
      } else {
        entry[key] = rnd() > (bunk[p.subjectCode] ?? 0.1);
      }
    }
    log[iso] = entry;
  }
  return log;
}

/** 8-week trend snapshots per subject (for sparklines). */
export const SAMPLE_TRENDS: Record<string, number[]> = {
  CS201: [88, 86, 84, 82, 80, 79, 78, 78.6],
  CS202: [96, 95, 94, 95, 94, 93, 94, 93.3],
  CS203: [82, 80, 78, 76, 74, 73, 72, 71.4],
  CS204: [100, 100, 100, 100, 100, 100, 100, 100],
  SKL301: [90, 88, 86, 84, 83, 82, 81, 81.3],
  MGT201: [78, 75, 73, 71, 69, 67, 65, 64.3],
};

export const SAMPLE_TERM = {
  academicyear: '2026-2027',
  semesterid: '1',
  semester: 'Odd Sem',
};
