/**
 * ERP parsers. The login-page fixtures are real KL ERP pages (session tokens
 * removed); the attendance/timetable fixtures are synthetic.
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseAttendance,
  parseTimetable,
  parseCgpa,
  computeGpa,
  parseInternals,
  extractCsrf,
  extractCaptchaSrc,
  detectLoginForm,
  parseLoginErrors,
  parseLoginError,
  classifyLoginError,
  pickLoginMessage,
  parseTermOptions,
} from '../lib/erp/parsers';
import { sealSession, unsealSession, looksRateLimited } from '../lib/erp/client';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(dir, 'fixtures', name), 'utf8');

test('header-mapped attendance table: LTPS columns, total row skipped', () => {
  const rows = parseAttendance(fixture('attendance.html'));
  assert.equal(rows.length, 2);
  const cs201 = rows.find((r) => r.code === 'CS201');
  assert.ok(cs201);
  assert.equal(cs201.title, 'Data Structures and Algorithms');
  assert.deepEqual(cs201.components.L, { conducted: 28, attended: 22 });
  assert.deepEqual(cs201.components.T, { conducted: 10, attended: 7 });
});

test('KL courselist layout: one row per course and component', () => {
  const html = `<table><thead><tr><th>#</th><th>Coursecode</th><th>Coursedesc</th><th>Ltps</th><th>Section</th><th>Total Conducted</th><th>Total Attended</th><th>Percentage</th></tr></thead><tbody>
    <tr><td>1</td><td>24CS2201</td><td>Design and Analysis of Algorithms</td><td>L</td><td>S-12</td><td>40</td><td>34</td><td>85</td></tr>
    <tr><td>2</td><td>24CS2201</td><td>Design and Analysis of Algorithms</td><td>P</td><td>S-12</td><td>22</td><td>18</td><td>82</td></tr>
    <tr><td>3</td><td>24UC2203</td><td>Technical Skills</td><td>S</td><td>S-12</td><td>16</td><td>14</td><td>88</td></tr></tbody></table>`;
  const rows = parseAttendance(html);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].components.L, { conducted: 40, attended: 34 });
  assert.deepEqual(rows[0].components.P, { conducted: 22, attended: 18 });
  assert.deepEqual(rows[0].components.T, { conducted: 0, attended: 0 });
  assert.deepEqual(rows[1].components.S, { conducted: 16, attended: 14 });
});

test('unrelated HTML yields no courses and no timetable', () => {
  assert.deepEqual(parseAttendance('<html><body><p>hello</p></body></html>'), []);
  assert.deepEqual(parseTimetable('<p>Internal Server Error</p>'), []);
});

test('timetable grid: days as rows, period labels with times, breaks skipped', () => {
  const days = parseTimetable(fixture('timetable.html'));
  assert.equal(days.length, 2);
  assert.equal(days[0].day, 'Mon');
  assert.equal(days[0].periods.length, 2);
  assert.deepEqual(
    { period: days[0].periods[0].period, start: days[0].periods[0].start, end: days[0].periods[0].end, room: days[0].periods[0].room },
    { period: 'P1', start: '09:00', end: '09:50', room: 'R-304' },
  );
  assert.equal(days[0].periods[1].type, 'L');
});

test('KL timetable cells: code, type and room; HTML entities decoded', () => {
  const html = `<table><tr><th>Day</th><th>P1 (09:00-09:50)</th><th>P5 (1:40-2:30)</th></tr>
    <tr><td>Wednesday</td><td>24CS2204-L - S-12 -RoomNo-C-301</td><td>24UC2203-S - S-12 -RoomNo-R&amp;D-2</td></tr>
    <tr><td>Saturday</td><td>-</td><td>24CS2202-P&nbsp;- S-12 -RoomNo-Lab-4</td></tr></table>`;
  const days = parseTimetable(html);
  assert.equal(days.length, 2);
  assert.deepEqual(
    days[0].periods.map((p) => [p.subjectCode, p.type, p.room]),
    [
      ['24CS2204', 'L', 'C-301'],
      ['24UC2203', 'S', 'R&D-2'],
    ],
  );
  assert.equal(days[0].periods[1].start, '1:40');
  assert.deepEqual(days[1].periods.map((p) => [p.subjectCode, p.type, p.room]), [['24CS2202', 'P', 'Lab-4']]);
});

test('real ERP login page: CSRF, captcha image and login form found', () => {
  const html = fixture('erp-login.html');
  assert.equal(extractCsrf(html), 'TEST_CSRF_TOKEN');
  assert.equal(extractCaptchaSrc(html), '/index.php?r=site%2Fcaptcha&v=TEST');
  assert.equal(detectLoginForm(html), true);
  assert.deepEqual(parseLoginErrors(html), []);
  assert.equal(parseLoginError(html), null);
});

test('real ERP page, wrong captcha: both errors read, captcha wins', () => {
  const errs = parseLoginErrors(fixture('erp-login-bad-captcha.html'));
  assert.deepEqual(errs, ['Incorrect username or password.', 'The verification code is incorrect.']);
  assert.equal(classifyLoginError(errs), 'bad_captcha');
  assert.equal(pickLoginMessage(errs, 'bad_captcha'), 'The verification code is incorrect.');
});

test('real ERP page, wrong password only: bad credentials', () => {
  const errs = parseLoginErrors(fixture('erp-login-bad-password.html'));
  assert.deepEqual(errs, ['Incorrect username or password.']);
  assert.equal(classifyLoginError(errs), 'bad_credentials');
  assert.equal(pickLoginMessage(errs, 'bad_credentials'), 'Incorrect username or password.');
});

test('classifyLoginError edge cases', () => {
  assert.equal(classifyLoginError(null), 'unknown');
  assert.equal(classifyLoginError([]), 'unknown');
  assert.equal(classifyLoginError('Too many requests. Please try again in one minute.'), 'rate_limited');
  assert.equal(classifyLoginError('Please enter the MFA code.'), 'unknown');
});

test('rate-limit detection ignores the ERP’s own script text', () => {
  const page = fixture('erp-login.html');
  assert.ok(page.includes('Too many requests'));
  assert.equal(looksRateLimited(200, page), false);
  assert.equal(looksRateLimited(429, ''), true);
  assert.equal(looksRateLimited(200, '<p>Too many requests. Please try again in one minute.</p>'), true);
});

test('term options: placeholder options dropped', () => {
  const html = `<select name="DynamicModel[academicyear]"><option value="">Select Academic Year</option><option value="2026-2027">2026-2027</option></select>
    <select name="DynamicModel[semesterid]"><option value="">Select</option><option value="1">Odd Sem</option><option value="2">Even Sem</option></select>`;
  assert.deepEqual(parseTermOptions(html), {
    years: [{ id: '2026-2027', label: '2026-2027' }],
    semesters: [
      { id: '1', label: 'Odd Sem' },
      { id: '2', label: 'Even Sem' },
    ],
  });
});

test('CGPA grid and GPA maths; semesters ordered odd before even', () => {
  const head = '<thead><tr><th>#</th><th>University</th><th>Program</th><th>Course Code</th><th>Course Name</th><th>Grade</th><th>Grade Point</th><th>Credits</th><th>Status</th><th>Academic Year</th><th>Semester</th></tr></thead>';
  const row = (code: string, g: string, p: number, c: number, y: string, s: string) =>
    `<tr><td>1</td><td>KLU</td><td>B.Tech</td><td>${code}</td><td>Course ${code}</td><td>${g}</td><td>${p}</td><td>${c}</td><td>P</td><td>${y}</td><td>${s}</td></tr>`;
  const html = `<table>${head}<tbody>${row('CS101', 'A+', 9, 4, '2024-2025', 'Odd Sem')}${row('CS102', 'B+', 7, 3, '2024-2025', 'Even Sem')}${row('CS103', 'F', 0, 3, '2024-2025', 'Even Sem')}</tbody></table>`;
  const rows = parseCgpa(html);
  assert.equal(rows.length, 3);
  const { cgpa, terms } = computeGpa(rows);
  assert.equal(cgpa, Math.round(((9 * 4 + 7 * 3) / 7) * 100) / 100);
  assert.deepEqual(
    terms.map((t) => t.semester),
    ['Odd Sem', 'Even Sem'],
  );
});

test('internals grid parses one row per course', () => {
  const html = `<table><thead><tr><th>#</th><th>Academic Year</th><th>Semester</th><th>Course Code</th><th>Course Name</th><th>Mid Term</th><th>Assignment</th></tr></thead>
    <tbody><tr><td>1</td><td>2026-2027</td><td>Odd Sem</td><td>24CS2201</td><td>Algorithms</td><td>18</td><td>8</td></tr></tbody></table>`;
  const rows = parseInternals(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].courseCode, '24CS2201');
  assert.deepEqual(
    rows[0].components.map((c) => [c.name, c.marks]),
    [
      ['Mid Term', '18'],
      ['Assignment', '8'],
    ],
  );
});

test('sealed tokens round-trip, reject tampering and expire', () => {
  process.env.SESSION_SECRET = 'a'.repeat(64);
  const t = sealSession({ hello: 'world', exp: Date.now() + 60_000 });
  assert.equal(unsealSession<{ hello: string }>(t)?.hello, 'world');
  const bad = t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.slice(-1);
  assert.equal(unsealSession(bad), null);
  assert.equal(unsealSession(sealSession({ exp: Date.now() - 1 })), null);
});
