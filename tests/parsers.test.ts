/**
 * Parser + math unit tests. Run with: node --test tests/parsers.test.ts
 * (Node 24 type-strips the TS on the fly; no build step needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseAttendance,
  parseTimetable,
  parseInternals,
  parseCgpa,
  computeGpa,
  parseResults,
  parseBookletMarks,
  extractCsrf,
  extractCaptchaSrc,
  detectLoginForm,
  parseLoginError,
  classifyLoginError,
} from '../lib/erp/parsers';
import { sealSession, unsealSession, looksRateLimited } from '../lib/erp/client';

const dir = dirname(fileURLToPath(import.meta.url));
const attendanceHtml = readFileSync(join(dir, 'fixtures', 'attendance.html'), 'utf8');
const timetableHtml = readFileSync(join(dir, 'fixtures', 'timetable.html'), 'utf8');

test('parseAttendance maps LTPS columns from headers', () => {
  const rows = parseAttendance(attendanceHtml);
  assert.equal(rows.length, 2, 'total row should be skipped');
  const cs201 = rows.find((r) => r.code === 'CS201');
  assert.ok(cs201);
  assert.equal(cs201.title, 'Data Structures and Algorithms');
  assert.deepEqual(cs201.components.L, { conducted: 28, attended: 22 });
  assert.deepEqual(cs201.components.T, { conducted: 10, attended: 7 });
  assert.deepEqual(cs201.components.P, { conducted: 0, attended: 0 });
  const cs202 = rows.find((r) => r.code === 'CS202');
  assert.ok(cs202);
  assert.deepEqual(cs202.components.P, { conducted: 12, attended: 12 });
});

test('parseAttendance returns [] for unrelated HTML', () => {
  assert.deepEqual(parseAttendance('<html><body><p>hello</p></body></html>'), []);
});

test('parseTimetable handles days-as-rows grid', () => {
  const days = parseTimetable(timetableHtml);
  assert.equal(days.length, 2);
  assert.equal(days[0].day, 'Mon');
  assert.equal(days[0].periods.length, 2, 'lunch break cell skipped');
  const p1 = days[0].periods[0];
  assert.equal(p1.period, 'P1');
  assert.equal(p1.start, '09:00');
  assert.equal(p1.end, '09:50');
  assert.equal(p1.subjectCode, 'CS201');
  assert.equal(p1.room, 'R-304');
  const p2 = days[0].periods[1];
  assert.equal(p2.type, 'L', 'type inferred from (L) marker');
  const tue = days[1];
  assert.equal(tue.periods.length, 2, 'empty cell skipped');
  assert.equal(tue.periods[1].type, 'S');
});

test('login page helpers', () => {
  const loginHtml = `
    <form id="login-form" action="/index.php?r=site%2Flogin" method="post">
      <input type="hidden" name="_csrf" value="csrf-abc-123">
      <input name="LoginForm[username]">
      <img id="loginFormCaptcha-image" src="index.php?r=site%2Fcaptcha&v=xyz">
      <div class="help-block-error">Incorrect username or password.</div>
    </form>`;
  assert.equal(extractCsrf(loginHtml), 'csrf-abc-123');
  assert.equal(extractCaptchaSrc(loginHtml), 'index.php?r=site%2Fcaptcha&v=xyz');
  assert.equal(detectLoginForm(loginHtml), true);
  assert.equal(detectLoginForm('<html><body>dashboard</body></html>'), false);
  assert.equal(parseLoginError(loginHtml), 'Incorrect username or password.');
  assert.equal(classifyLoginError('Incorrect username or password.'), 'bad_credentials');
  assert.equal(classifyLoginError('Wrong verification code.'), 'bad_captcha');
});

test('session seal/unseal roundtrip with expiry', () => {
  const token = sealSession({ jar: { PHPSESSID: 'abc' }, csrf: 'tok', exp: Date.now() + 60000 });
  const back = unsealSession<{ jar: Record<string, string>; csrf: string }>(token);
  assert.ok(back);
  assert.deepEqual(back.jar, { PHPSESSID: 'abc' });
  assert.equal(back.csrf, 'tok');

  const expired = sealSession({ exp: Date.now() - 1000 });
  assert.equal(unsealSession(expired), null, 'expired token rejected');
  assert.equal(unsealSession('garbage-token'), null, 'tampered token rejected');
});

test('looksRateLimited ignores the message when embedded in page JS', () => {
  const loginPage = `<html><body><form id="login-form"></form><script>
    userHelpBlock.innerHTML = "Too many requests. Please try again in one minute.";
  </script></body></html>`;
  assert.equal(looksRateLimited(200, loginPage), false);
  assert.equal(looksRateLimited(429, 'anything'), true);
  assert.equal(looksRateLimited(200, '<html><body>Too many requests. Please try again in one minute.</body></html>'), true);
});
// Math engine tests live in tests/math.test.ts.

test('parseAttendance handles the KL courselist layout (one row per LTPS component)', () => {
  const html = `<table><thead><tr><th>#</th><th>Coursecode</th><th>Coursedesc</th><th>Ltps</th><th>Section</th><th>Total Conducted</th><th>Total Attended</th><th>Tcbr</th></tr></thead><tbody>
<tr><td>1</td><td>25CS1302E</td><td>DATABASE SYSTEMS</td><td>L</td><td>S-9-MA</td><td>20</td><td>16</td><td>0</td></tr>
<tr><td>2</td><td>25CS1302E</td><td>DATABASE SYSTEMS</td><td>P</td><td>S-9-A</td><td>20</td><td>18</td><td>0</td></tr>
<tr><td>3</td><td>25CS2103E</td><td>OPERATING SYSTEMS</td><td>L</td><td>S-9-MA</td><td>18</td><td>18</td><td>0</td></tr>
</tbody></table>`;
  const rows = parseAttendance(html);
  assert.equal(rows.length, 2);
  const db = rows.find((r) => r.code === '25CS1302E');
  assert.ok(db);
  assert.equal(db.title, 'DATABASE SYSTEMS');
  assert.deepEqual(db.components.L, { conducted: 20, attended: 16 });
  assert.deepEqual(db.components.P, { conducted: 20, attended: 18 });
  assert.deepEqual(db.components.T, { conducted: 0, attended: 0 });
});

test('parseTimetable handles the KL grid (Mon rows, numbered periods, CODE-X cells)', () => {
  const html = `<table><tr><th>Oday</th><th>1</th><th>2</th><th>3</th></tr>
<tr><td>Mon</td><td>25CS1302E-L - S-9 -RoomNo-H-003</td><td>-</td><td>25CS2104E-S - S-9 -RoomNo-H102</td></tr>
<tr><td>Tue</td><td>25FL2112E-P - S-7 -RoomNo-H007</td><td>25CS1302E-L - S-9 -RoomNo-H-003</td><td>-</td></tr>
</table>`;
  const days = parseTimetable(html);
  assert.equal(days.length, 2);
  assert.equal(days[0].day, 'Mon');
  assert.equal(days[0].periods.length, 2, 'dash cell skipped');
  const p1 = days[0].periods[0];
  assert.equal(p1.subjectCode, '25CS1302E');
  assert.equal(p1.type, 'L');
  assert.equal(p1.room, 'H-003');
  assert.equal(p1.period, 'P1');
  const p3 = days[0].periods[1];
  assert.equal(p3.subjectCode, '25CS2104E');
  assert.equal(p3.type, 'S');
  assert.equal(p3.period, 'P3');
});

test('parseInternals maps component columns from headers', () => {
  const html = `<table><thead><tr><th>Sno</th><th>Course Code</th><th>Course Name</th><th>Mid-Term Examination (Descriptive)</th><th>Hackathon</th></tr></thead>
  <tbody><tr><td>1</td><td>25SC2107E</td><td>MACHINE LEARNING</td><td>25.5</td><td>-</td></tr></tbody></table>`;
  const rows = parseInternals(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].courseCode, '25SC2107E');
  assert.equal(rows[0].components.length, 2);
  assert.equal(rows[0].components[0].marks, '25.5');
});

test('parseCgpa positional fallback + computeGpa', () => {
  const html = `<table><thead><tr><th>#</th><th>a</th><th>b</th><th>Course Code</th><th>Course Name</th><th>Grade</th><th>Grade Point</th><th>Credits</th><th>Status</th><th>Academic Year</th><th>Semester</th></tr></thead>
  <tbody>
  <tr><td>1</td><td>x</td><td>y</td><td>25SC2107E</td><td>MACHINE LEARNING</td><td>O</td><td>10</td><td>4</td><td>P</td><td>2026-2027</td><td>Odd Sem</td></tr>
  <tr><td>2</td><td>x</td><td>y</td><td>25CS2104E</td><td>OPERATING SYSTEMS</td><td>A</td><td>9</td><td>4</td><td>P</td><td>2026-2027</td><td>Odd Sem</td></tr>
  </tbody></table>`;
  const rows = parseCgpa(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].grade, 'O');
  assert.equal(rows[0].credits, 4);
  const { cgpa, terms } = computeGpa(rows);
  assert.equal(cgpa, 9.5);
  assert.equal(terms.length, 1);
  assert.equal(terms[0].sgpa, 9.5);
});

test('parseResults extracts booklet links', () => {
  const html = `<table><thead><tr><th>#</th><th>Course Code</th><th>Course Name</th><th>Academic Year</th><th>Semester</th><th>Study Year</th><th>Type</th><th>Exam</th><th>Eval No</th><th>View Booklet</th></tr></thead>
  <tbody><tr><td>1</td><td>25SC2107E</td><td>MACHINE LEARNING</td><td>2026-2027</td><td>Odd Sem</td><td>2</td><td>sem-in</td><td>Mid-Term Examination (Descriptive)</td><td>1</td>
  <td><a href="/index.php?r=studentinfo%2Fstudentendexamresult%2Fqpwise&amp;id=123">Booklet</a></td></tr></tbody></table>`;
  const rows = parseResults(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].courseCode, '25SC2107E');
  assert.ok(rows[0].bookletUrl?.includes('qpwise'));
});

test('parseBookletMarks parses a generic marks table', () => {
  const html = `<div class="modal-title">Student Mid-Term Examination (Descriptive) Qp Wise Marks</div>
  <table><thead><tr><th>Sno</th><th>Coursecode</th><th>1 B</th><th>Total Marks</th></tr></thead>
  <tbody><tr><td>1</td><td>25SC2107E</td><td>6.5</td><td>25.5</td></tr></tbody></table>`;
  const m = parseBookletMarks(html);
  assert.ok(m.title.includes('Qp Wise Marks'));
  assert.deepEqual(m.headers, ['Sno', 'Coursecode', '1 B', 'Total Marks']);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0][2], '6.5');
});
