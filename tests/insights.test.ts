/** Per-course summaries, the plate, next class, and change badges. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsOf, deltaOf, minutesOf, nextClassOf, plateFor, summarize, whenLabel } from '../lib/insights';
import { DEFAULT_TCBR, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type ComponentKey, type SubjectAttendance } from '../lib/math';
import type { TimetableDay } from '../lib/erp/parsers';
import { compareTerms, termCandidates, termFromIds, termText, yearStart, yearsNewestFirst } from '../lib/terms';

const settings = { thresholds: DEFAULT_THRESHOLDS, weights: DEFAULT_WEIGHTS, tcbr: DEFAULT_TCBR };
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

test('verdicts name the class type and count', () => {
  const ok = summarize(course('A', 'Databases', { L: [36, 38], P: [20, 22] }), settings);
  assert.equal(ok.band, 'cruising');
  assert.match(ok.verdict, /^11 practicals to spare, or 5 lectures\.$/);

  const thin = summarize(course('B', 'Operating Systems', { L: [29, 38], T: [9, 11] }), settings);
  assert.equal(thin.band, 'thin-ice');
  assert.equal(thin.verdict, 'Attend the next 20 lectures to reach 85%.');

  const red = summarize(course('C', 'Networks', { L: [25, 36], P: [12, 18] }), settings);
  assert.equal(red.band, 'in-the-red');
  assert.equal(red.verdict, 'Attend the next 9 lectures to climb back above 75%.');

  const line = summarize(course('D', 'Algorithms', { L: [34, 40], T: [10, 12], P: [18, 22] }), settings);
  assert.equal(line.pct, 85);
  assert.equal(line.verdict, 'Right on the 85% line. Skipping any class drops you below it.');
});

test('titles: pipe-separated ERP titles are trimmed, empty ones fall back to the code', () => {
  assert.equal(summarize(course('E', 'Compilers | Theory', { L: [1, 1] }), settings).title, 'Compilers');
  assert.equal(summarize(course('F', '', { L: [1, 1] }), settings).title, 'F');
});

test('the plate leads with the most urgent course', () => {
  const list = [
    course('A', 'Databases', { L: [36, 38] }),
    course('B', 'Operating Systems', { L: [29, 38] }),
    course('C', 'Networks', { L: [25, 36] }),
  ].map((c) => summarize(c, settings));
  const plate = plateFor(list, settings.thresholds)!;
  assert.equal(plate.code, 'C');
  assert.equal(plate.tone, 'in-the-red');
  assert.match(plate.sentence, /^Networks is at 70%, below the 75% floor\./);

  const allGood = [course('A', 'Databases', { L: [36, 38] }), course('B', 'Maths', { L: [40, 40] })].map((c) => summarize(c, settings));
  assert.match(plateFor(allGood, settings.thresholds)!.sentence, /^Every course is at or above 85%\. Tightest is Databases: \d+ lectures? to spare\.$/);
  assert.equal(plateFor([], settings.thresholds), null);
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
  assert.equal(whenLabel(n1), 'today at 1:40');
  const tueEvening = new Date(2026, 10, 3, 18, 0);
  const n2 = nextClassOf('A', tt, tueEvening)!;
  assert.equal(n2.day, 'Thu');
  assert.equal(whenLabel(n2), 'on Thu at 09:50');
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
