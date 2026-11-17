/**
 * SGPA per semester and CGPA (lib/gpa.ts). The three 2025-2026 semesters are a real
 * student's grade list as the ERP prints it; each SGPA is checked on its own, then the
 * CGPA must come out at the ERP's 8.72.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCGPA, computeSGPA, gradePointOf, groupBySemester, roundGpa, type GradeRow } from '../lib/gpa';
import { computeGpa, parseCgpa } from '../lib/erp/parsers';

const row = (academicYear: string, semester: string, courseCode: string, grade: string, gradePoint: number, credits: number): GradeRow => ({
  courseCode,
  courseName: courseCode,
  grade,
  gradePoint,
  credits,
  academicYear,
  semester,
});

const ODD = [
  row('2025-2026', 'Odd Sem', '25EC2101E', 'B', 6, 3),
  row('2025-2026', 'Odd Sem', '25MT1002E', 'A', 8, 4),
  row('2025-2026', 'Odd Sem', '25CS1105E', 'A+', 9, 4.5),
  row('2025-2026', 'Odd Sem', '25UC1102E', 'O', 10, 2),
  row('2025-2026', 'Odd Sem', '25UC1203E', 'O', 10, 2),
  row('2025-2026', 'Odd Sem', '25UC0034', 'P', 10, 0),
];
const EVEN = [
  row('2025-2026', 'Even Sem', '25MT1205E', 'B+', 7, 4),
  row('2025-2026', 'Even Sem', '25CS1104E', 'O', 10, 3.5),
  row('2025-2026', 'Even Sem', '25CS1204E', 'A+', 9, 4),
  row('2025-2026', 'Even Sem', '25UC1204E', 'O', 10, 2),
  row('2025-2026', 'Even Sem', '25UC0035', 'P', 8, 0),
];
const TERM3 = [
  row('2025-2026', 'Term3', '25CS1201E', 'O', 10, 3),
  row('2025-2026', 'Term3', '25FL1302E', 'A+', 9, 2),
  row('2025-2026', 'Term3', '25MT1306E', 'A', 8, 4),
  row('2025-2026', 'Term3', '25CS1305E', 'A+', 9, 4),
  row('2025-2026', 'Term3', '25CS1308E', 'A+', 9, 3),
  row('2025-2026', 'Term3', '25UC0036', 'P', 10, 0),
];
// The ERP lists courses by code, all semesters mixed together.
const ALL = [...ODD, ...EVEN, ...TERM3].sort((a, b) => a.courseCode.localeCompare(b.courseCode));

test('2025-2026 Odd Sem: 130.5 / 15.5 = 8.4193… → 8.42', () => {
  assert.deepEqual(computeSGPA(ODD), { gpa: 8.42, credits: 15.5, points: 130.5, counted: 5 });
});

test('2025-2026 Even Sem: 119 / 13.5 = 8.8148… → 8.81', () => {
  assert.deepEqual(computeSGPA(EVEN), { gpa: 8.81, credits: 13.5, points: 119, counted: 4 });
});

test('2025-2026 Term3: 143 / 16 = 8.9375 → 8.94', () => {
  assert.deepEqual(computeSGPA(TERM3), { gpa: 8.94, credits: 16, points: 143, counted: 5 });
});

test('grouping the mixed list gives the same three semesters, oldest first, nothing unclassified', () => {
  const { semesters, unclassified } = groupBySemester(ALL);
  assert.deepEqual(
    semesters.map((s) => [s.academicYear, s.semester, s.gpa, s.credits, s.courses.length]),
    [
      ['2025-2026', 'Odd Sem', 8.42, 15.5, 6],
      ['2025-2026', 'Even Sem', 8.81, 13.5, 5],
      ['2025-2026', 'Term3', 8.94, 16, 6],
    ],
  );
  assert.equal(unclassified.length, 0);
});

test('cross-check: CGPA = 392.5 / 45 = 8.7222… → 8.72, the ERP’s own figure', () => {
  const c = computeCGPA(ALL);
  assert.deepEqual(c, { gpa: 8.72, credits: 45, points: 392.5, counted: 14 });
  const { semesters } = groupBySemester(ALL);
  assert.equal(semesters.reduce((n, s) => n + s.credits, 0), 45);
  assert.equal(semesters.reduce((n, s) => n + s.points, 0), 392.5);
  // The sync-time summary agrees.
  const stored = computeGpa(ALL.map((r) => ({ ...r, status: 'P' })));
  assert.equal(stored.cgpa, 8.72);
  assert.deepEqual(stored.terms.map((t) => t.sgpa), [8.42, 8.81, 8.94]);
});

test('a semester of only 0-credit courses has no SGPA (null, shown as —), never 0 or NaN', () => {
  const r = computeSGPA([row('2025-2026', 'Term3', 'X', 'P', 10, 0), row('2025-2026', 'Term3', 'Y', 'O', 10, 0)]);
  assert.equal(r.gpa, null);
  assert.equal(r.credits, 0);
});

test('an F scores 0 points but its credits count', () => {
  const r = computeSGPA([row('y', 's', 'A', 'O', 10, 4), row('y', 's', 'B', 'F', 0, 4)]);
  assert.deepEqual(r, { gpa: 5, credits: 8, points: 40, counted: 2 });
});

test('absent / undeclared results are left out until declared', () => {
  const r = computeSGPA([row('y', 's', 'A', 'A', 8, 4), row('y', 's', 'B', 'AB', 0, 4), row('y', 's', 'C', '', 0, 3)]);
  assert.deepEqual(r, { gpa: 8, credits: 4, points: 32, counted: 1 });
});

test('the printed grade point wins; the scale is the fallback', () => {
  assert.equal(gradePointOf({ grade: 'A', gradePoint: 8 }), 8);
  assert.equal(gradePointOf({ grade: 'A', gradePoint: 0 }), 8);
  assert.equal(gradePointOf({ grade: 'C', gradePoint: 0 }), 5);
  assert.equal(gradePointOf({ grade: 'P', gradePoint: 0 }), 4);
  assert.equal(gradePointOf({ grade: 'F', gradePoint: 0 }), 0);
  assert.equal(gradePointOf({ grade: 'AB', gradePoint: 0 }), null);
});

test('years never mix: the same semester name in two years is two semesters', () => {
  const { semesters } = groupBySemester([
    row('2025-2026', 'Odd Sem', 'A', 'O', 10, 4),
    row('2026-2027', 'Odd Sem', 'B', 'B', 6, 4),
  ]);
  assert.deepEqual(semesters.map((s) => [s.academicYear, s.gpa]), [
    ['2025-2026', 10],
    ['2026-2027', 6],
  ]);
});

test('a row with no semester goes into no SGPA and is listed as unclassified', () => {
  const { semesters, unclassified } = groupBySemester([row('2025-2026', 'Odd Sem', 'A', 'O', 10, 4), row('2025-2026', '', 'B', 'B', 6, 4)]);
  assert.deepEqual(semesters.map((s) => [s.semester, s.gpa, s.credits]), [['Odd Sem', 10, 4]]);
  assert.deepEqual(unclassified.map((r) => r.courseCode), ['B']);
});

test('rounding is half up and free of float drift', () => {
  assert.equal(roundGpa(130.5, 16), 8.16); // 8.15625
  assert.equal(roundGpa(32.5, 4), 8.13); // 8.125 exactly → up
  assert.equal(roundGpa(130.5, 15.5), 8.42);
  assert.equal(roundGpa(119, 13.5), 8.81);
});

test('the ERP grade list: "Reg Academic Year" and "Reg Sem" are read', () => {
  const html = `<table><thead><tr><th>#</th><th>University Id</th><th>Student Name</th><th>Course Code</th><th>Course Name</th><th>Grade</th><th>Grade Point</th><th>Credits</th><th>Promotion</th><th>Reg Academic Year</th><th>Reg Sem</th><th></th></tr></thead><tbody>
    <tr><td>1</td><td>x</td><td>y</td><td>25CS1201E</td><td>FRONT END</td><td>O</td><td>10</td><td>3</td><td>P</td><td>2025-2026</td><td>Term3</td><td></td></tr>
    <tr><td>2</td><td>x</td><td>y</td><td>25EC2101E</td><td>DIGITAL DESIGN</td><td>B</td><td>6</td><td>3</td><td>P</td><td>2025-2026</td><td>Odd Sem</td><td></td></tr>
    <tr><td>3</td><td>x</td><td>y</td><td>25UC0034</td><td>PRACTICUM</td><td>P</td><td>10</td><td>0</td><td>P</td><td>2025-2026</td><td>Odd Sem</td><td></td></tr>
  </tbody></table>`;
  const rows = parseCgpa(html);
  assert.deepEqual(rows.map((r) => [r.courseCode, r.academicYear, r.semester, r.gradePoint, r.credits]), [
    ['25CS1201E', '2025-2026', 'Term3', 10, 3],
    ['25EC2101E', '2025-2026', 'Odd Sem', 6, 3],
    ['25UC0034', '2025-2026', 'Odd Sem', 10, 0],
  ]);
  assert.deepEqual(groupBySemester(rows).semesters.map((s) => [s.semester, s.gpa]), [
    ['Odd Sem', 6],
    ['Term3', 10],
  ]);
});
