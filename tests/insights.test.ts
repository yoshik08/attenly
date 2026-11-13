/** Per-course summaries, the plate, next class, and change badges. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaOf, clockOf, countsOf, courseTitle, deltaOf, endOf, minutesOf, nextClassOf, PERIOD_TIMES, skipCall, startOf, summarize, whenLabel } from '../lib/insights';
import { DEFAULT_TARGET, DEFAULT_TCBR, DEFAULT_WEIGHTS, type ComponentKey, type SubjectAttendance } from '../lib/math';
import type { TimetableDay } from '../lib/erp/parsers';
import { compareTerms, termCandidates, termFromIds, termText, yearStart, yearsNewestFirst } from '../lib/terms';

const settings = { target: DEFAULT_TARGET, weights: DEFAULT_WEIGHTS, tcbr: DEFAULT_TCBR };
const course = (code: string, title: string, c: Partial<Record<ComponentKey, [number, number]>>): SubjectAttendance => ({
  code,
  title,
  components: {
    L: { attended: c.L?.[0] ?? 0, conducted: c.L?.[1] ?? 0 },
    T: { attended: c.T?.[0] ?? 0, conducted: c.T?.[1] ?? 0 },
    P: { attended: c.P?.[0] ?? 0, conducted: c.P?.[1] ?? 0 },
    S: { attended: c.S?.[0] ?? 0, conducted: c.S?.[1] ?? 0 },
  },
});

test('verdicts name the class type and count against the one target', () => {
  const ok = summarize(course('A', 'Databases', { L: [36, 38], P: [20, 22] }), settings);
  assert.equal(ok.status, 'safe');
  assert.match(ok.verdict, /^\d+ (lectures|practicals) to spare\.$/);

  const thin = summarize(course('B', 'Operating Systems', { L: [29, 38], T: [9, 11] }), settings);
  assert.equal(thin.status, 'condonation');
  assert.match(thin.verdict, /^Attend the next \d+ (lectures|tutorials) to reach 85%\.$/);

  const red = summarize(course('C', 'Networks', { L: [25, 36], P: [12, 18] }), settings);
  assert.equal(red.status, 'medical');
  assert.match(red.verdict, /^Attend the next \d+ (lectures|practicals) to climb back above 75%\.$/);

  const line = summarize(course('D', 'Algorithms', { L: [34, 40], T: [10, 12], P: [18, 22] }), settings);
  assert.equal(line.pct, 85);
  assert.equal(line.verdict, 'Right on the 85% line. Skipping any class drops you below it.');
});

test('switching the one target changes the verdict, never the band', () => {
  const subject = course('B', 'Operating Systems', { L: [29, 38], T: [9, 11] });
  const at85 = summarize(subject, { ...settings, target: 85 });
  const at75 = summarize(subject, { ...settings, target: 75 });
  assert.equal(at85.status, 'condonation');
  assert.equal(at75.status, 'condonation', '78% sits in the same college band either way');
  assert.match(at85.verdict, /to reach 85%\.$/);
  assert.match(at75.verdict, /to spare\.$/);
});

test('titles: pipe-separated ERP titles are trimmed, empty ones fall back to the code', () => {
  assert.equal(summarize(course('E', 'Compilers | Theory', { L: [1, 1] }), settings).title, 'Compilers');
  assert.equal(summarize(course('F', '', { L: [1, 1] }), settings).title, 'F');
});

test('afternoon periods printed on a 12-hour clock sort after the morning', () => {
  assert.equal(minutesOf('09:50'), 590);
  assert.equal(minutesOf('1:40'), 13 * 60 + 40);
  assert.equal(minutesOf('12:40'), 12 * 60 + 40);
  assert.equal(minutesOf(''), null);
});

test('next class: later today, otherwise the next day it meets', () => {
  const tt: TimetableDay[] = [
    { day: 'Tue', periods: [{ period: 'P1', start: '09:00', end: '09:50', subjectCode: 'A', subjectTitle: '', room: 'C-301', faculty: '', type: 'L' }, { period: 'P5', start: '1:40', end: '2:30', subjectCode: 'A', subjectTitle: '', room: 'Lab-4', faculty: '', type: 'P' }] },
    { day: 'Thu', periods: [{ period: 'P2', start: '09:50', end: '10:40', subjectCode: 'A', subjectTitle: '', room: 'C-214', faculty: '', type: 'T' }] },
  ];
  const tueMorning = new Date(2026, 10, 3, 10, 0); // Tue 3 Nov 2026, 10:00
  const n1 = nextClassOf('A', tt, tueMorning)!;
  assert.equal(n1.inDays, 0);
  assert.equal(n1.period.room, 'Lab-4');
  assert.equal(whenLabel(n1), 'today at 1:40 pm');
  const tueEvening = new Date(2026, 10, 3, 18, 0);
  const n2 = nextClassOf('A', tt, tueEvening)!;
  assert.equal(n2.day, 'Thu');
  assert.equal(whenLabel(n2), 'on Thu at 9:50 am');
  assert.equal(nextClassOf('Z', tt, tueMorning), null);
});

test('changes since the last look', () => {
  const before = [course('A', 'Databases', { L: [30, 34], P: [10, 12] })];
  const seen = countsOf(before);
  const after = course('A', 'Databases', { L: [31, 36], P: [10, 12] });
  assert.deepEqual(deltaOf(after, seen), [{ k: 'L', attended: 1, missed: 1 }]);
  assert.deepEqual(deltaOf(before[0], seen), []);
  assert.deepEqual(deltaOf(after, null), []);
});

test('terms read and sort naturally', () => {
  assert.equal(termText({ academicyear: '2026-2027', semester: 'Odd Sem' }), 'Odd Sem 2026-2027');
  const list = [
    { academicYear: '2025-2026', semester: 'Even Sem' },
    { academicYear: '2025-2026', semester: 'Odd Sem' },
    { academicYear: '2024-2025', semester: 'Even Sem' },
  ].sort(compareTerms);
  assert.deepEqual(list.map((t) => `${t.semester} ${t.academicYear}`), ['Even Sem 2024-2025', 'Odd Sem 2025-2026', 'Even Sem 2025-2026']);
});

test('automatic term: newest year first (ERP ids, any order), even before odd', () => {
  const options = {
    years: [
      { id: '29', label: '2025-2026' },
      { id: '30', label: '2026-2027' },
    ],
    semesters: [
      { id: '1', label: 'Odd Sem' },
      { id: '2', label: 'Even Sem' },
    ],
  };
  assert.deepEqual(
    termCandidates(options).map((c) => termText(c)),
    ['Even Sem 2026-2027', 'Odd Sem 2026-2027', 'Even Sem 2025-2026', 'Odd Sem 2025-2026'],
  );
  assert.deepEqual(termCandidates(options)[0], { academicyear: '30', semesterid: '2', semester: 'Even Sem', yearLabel: '2026-2027' });
  assert.equal(yearStart('2026-27'), 2026);
  assert.equal(yearStart('30'), null);
  // Without readable labels, higher ids are newer.
  assert.deepEqual(yearsNewestFirst([{ id: '7', label: 'A' }, { id: '12', label: 'B' }]).map((y) => y.id), ['12', '7']);
  assert.deepEqual(termFromIds({ academicyear: '29', semesterid: '1' }, options), { academicyear: '29', semesterid: '1', semester: 'Odd Sem', yearLabel: '2025-2026' });
  assert.equal(termText({ academicyear: '30', semester: 'Odd Sem' }), 'Odd Sem 30');
  assert.equal(termText({ academicyear: '30', semester: 'Even Sem', yearLabel: '2026-2027' }), 'Even Sem 2026-2027');
});

test('clock: KLU afternoons read as pm, mornings as am', () => {
  assert.equal(clockOf('09:00'), '9:00 am');
  assert.equal(clockOf('12:40'), '12:40 pm');
  assert.equal(clockOf('1:40'), '1:40 pm');
  assert.equal(clockOf(''), '');
  assert.equal(clockOf('later'), 'later');
});

test('up next: the rest of today, else the next day with classes', () => {
  const tt: TimetableDay[] = [
    { day: 'Tue', periods: [{ period: 'P1', start: '09:00', end: '09:50', subjectCode: 'A', subjectTitle: '', room: '', faculty: '', type: 'L' }, { period: 'P5', start: '1:40', end: '2:30', subjectCode: 'B', subjectTitle: '', room: '', faculty: '', type: 'P' }] },
    { day: 'Thu', periods: [{ period: 'P2', start: '09:50', end: '10:40', subjectCode: 'A', subjectTitle: '', room: '', faculty: '', type: 'T' }] },
  ];
  const tueMorning = agendaOf(tt, new Date(2026, 10, 3, 10, 0))!;
  assert.equal(tueMorning.inDays, 0);
  assert.deepEqual(tueMorning.periods.map((p) => p.subjectCode), ['B']);
  const tueEvening = agendaOf(tt, new Date(2026, 10, 3, 18, 0))!;
  assert.equal(tueEvening.day, 'Thu');
  assert.equal(tueEvening.inDays, 2);
  assert.equal(tueEvening.date.getDate(), 5);
  assert.equal(agendaOf([], new Date()), null);
});

test('skip call: one missed class against the target, same rounding as the cards', () => {
  // 36/38 lectures, 20/22 practicals: well above 85, a lecture can go.
  const safe = skipCall(course('A', 'Databases', { L: [36, 38], P: [20, 22] }), settings, 'L');
  assert.equal(safe.skippable, true);
  assert.ok(safe.after! >= 85 && safe.after! <= safe.now!);
  // 34/40: exactly on the line, so any skip drops below it.
  const edge = skipCall(course('B', 'Algorithms', { L: [34, 40] }), settings, 'L');
  assert.equal(edge.now, 85);
  assert.equal(edge.skippable, false);
  assert.equal(edge.needed, null);
  // Under the target: never skippable, and says how many in a row reach it.
  const under = skipCall(course('C', 'Systems', { L: [29, 38], T: [9, 11] }), settings, 'L');
  assert.equal(under.skippable, false);
  assert.ok(Number.isFinite(under.needed!) && under.needed! > 0);
});

test('course titles: shouted ERP names are calmed, acronyms and mixed case kept', () => {
  assert.equal(courseTitle('GENERATIVE AI AND AI PLATFORMS', 'X'), 'Generative AI and AI Platforms');
  assert.equal(courseTitle('ADVANCED OBJECT ORIENTED PROGRAMMING', 'X'), 'Advanced Object Oriented Programming');
  assert.equal(courseTitle('INSIGHTS TO SUSTAINABLE DEVELOPMENT-II', 'X'), 'Insights to Sustainable Development-II');
  assert.equal(courseTitle('INTERNET OF THINGS (IOT)', 'X'), 'Internet of Things (IoT)');
  assert.equal(courseTitle('Operating Systems', 'X'), 'Operating Systems');
  assert.equal(courseTitle('DBMS', 'X'), 'DBMS');
  assert.equal(courseTitle('', '24CS2201'), '24CS2201');
  assert.equal(courseTitle('CLOUD INFRASTRUCTURE | 24CS3101', 'X'), 'Cloud Infrastructure');
});

test('up next without clock times: today counts until late afternoon', () => {
  const tt: TimetableDay[] = [
    { day: 'Thu', periods: [{ period: 'P1', start: '', end: '', subjectCode: 'A', subjectTitle: '', room: '', faculty: '', type: 'L' }] },
    { day: 'Fri', periods: [{ period: 'P1', start: '', end: '', subjectCode: 'B', subjectTitle: '', room: '', faculty: '', type: 'L' }] },
  ];
  assert.equal(agendaOf(tt, new Date(2026, 10, 12, 3, 6))!.day, 'Thu');
  assert.equal(agendaOf(tt, new Date(2026, 10, 12, 18, 0))!.day, 'Fri');
});

/* Untimed ERP periods fall back to KLH's bell schedule. */
const untimed = (n: number, code: string): TimetableDay['periods'][number] => ({
  period: `P${n}`, start: '', end: '', subjectCode: code, subjectTitle: '', room: '', faculty: '', type: 'L',
});
// P6 has no class on either day: that is this section's lunch, found from the timetable, never assumed.
const bellWeek: TimetableDay[] = [
  { day: 'Thu', periods: [1, 2, 3, 4, 5, 7, 8, 9].map((n) => untimed(n, `T${n}`)) },
  { day: 'Fri', periods: [1, 2, 3, 4, 5, 7, 8, 9].map((n) => untimed(n, `F${n}`)) },
];
const thu = (h: number, m: number) => new Date(2026, 10, 12, h, m); // Thu 12 Nov 2026

test('bell schedule: stored like the ERP prints it, read back on the right clock', () => {
  assert.equal(minutesOf(PERIOD_TIMES[1].start), 8 * 60 + 10);
  assert.equal(minutesOf(PERIOD_TIMES[5].end), 12 * 60 + 40);
  assert.equal(minutesOf(PERIOD_TIMES[6].start), 12 * 60 + 40);
  assert.equal(minutesOf(PERIOD_TIMES[7].start), 13 * 60 + 20);
  assert.equal(minutesOf(PERIOD_TIMES[9].end), 15 * 60 + 50);
  for (let n = 1; n < 9; n++) {
    assert.ok(minutesOf(PERIOD_TIMES[n].start)! < minutesOf(PERIOD_TIMES[n].end)!, `P${n} ends after it starts`);
    assert.ok(minutesOf(PERIOD_TIMES[n].end)! <= minutesOf(PERIOD_TIMES[n + 1].start)!, `P${n + 1} starts after P${n} ends`);
  }
  assert.equal(startOf(untimed(7, 'A')), '1:20');
  assert.equal(endOf(untimed(7, 'A')), '2:10');
  assert.equal(startOf({ ...untimed(7, 'A'), period: 'Lab' }), '', 'no number, no bell time');
});

test('up next, untimed: at 12:20 the 1:20 class leads (P5 started, P6 is lunch)', () => {
  const now = thu(12, 20);
  const a = agendaOf(bellWeek, now)!;
  assert.equal(a.inDays, 0);
  assert.deepEqual(a.periods.map((p) => p.period), ['P7', 'P8', 'P9']);
  assert.equal(clockOf(startOf(a.periods[0])), '1:20 pm');
  assert.equal(minutesOf(startOf(a.periods[0]))! - (now.getHours() * 60 + now.getMinutes()), 60, 'header reads "Starts in 1 h"');
});

test('up next, untimed: before the bell the day starts at P1; after the last one it moves on', () => {
  assert.deepEqual(agendaOf(bellWeek, thu(7, 0))!.periods.map((p) => p.period), ['P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'P8', 'P9']);
  const late = agendaOf(bellWeek, thu(16, 0))!;
  assert.equal(late.day, 'Fri');
  assert.equal(late.inDays, 1);
  assert.equal(late.periods[0].period, 'P1');
});

test('up next: times the ERP prints win over the bell schedule', () => {
  const tt: TimetableDay[] = [{ day: 'Thu', periods: [{ ...untimed(1, 'A'), start: '9:30', end: '10:20' }, untimed(2, 'B')] }];
  const p1 = tt[0].periods[0];
  assert.equal(startOf(p1), '9:30');
  assert.equal(endOf(p1), '10:20');
  // At 9:10 the bell's P1 (8:10) and P2 (9:00) have started, but the ERP says P1 is at 9:30.
  assert.deepEqual(agendaOf(tt, thu(9, 10))!.periods.map((p) => p.subjectCode), ['A']);
});

test('next class: an untimed class later today is found', () => {
  const n = nextClassOf('T8', bellWeek, thu(12, 20))!;
  assert.equal(n.inDays, 0);
  assert.equal(n.period.period, 'P8');
  assert.equal(whenLabel(n), 'today at 2:10 pm');
  // Once it has started, the next one is Friday's.
  const twice: TimetableDay[] = [
    { day: 'Thu', periods: [untimed(8, 'A')] },
    { day: 'Fri', periods: [untimed(2, 'A')] },
  ];
  const fri = nextClassOf('A', twice, thu(14, 30))!;
  assert.equal(fri.day, 'Fri');
  assert.equal(whenLabel(fri), 'tomorrow at 9:00 am');
});
