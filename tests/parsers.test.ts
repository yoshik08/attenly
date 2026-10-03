/**
 * Parser + math unit tests. Run with: node --test tests/parsers.test.ts
 * (Node 24 type-strips the TS on the fly; no build step needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseAttendance,
  parseTimetable,
  extractCsrf,
  extractCaptchaSrc,
  detectLoginForm,
  parseLoginError,
  classifyLoginError,
} from '../lib/erp/parsers';
import { sealSession, unsealSession, looksRateLimited } from '../lib/erp/client';
import {
  weightedPct,
  classImpact,
  maxSkippable,
  policyBand,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from '../lib/math';

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

test('weightedPct uses LTPS weights', () => {
  const subj = {
    code: 'X',
    title: 'X',
    components: {
      L: { conducted: 10, attended: 10 },
      T: { conducted: 10, attended: 0 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  };
  // L weight 100, T weight 25 -> (1000+0)/(1000+250) = 80%
  assert.equal(weightedPct(subj, DEFAULT_WEIGHTS), 80);
});

test('classImpact deltas are sane', () => {
  const subj = {
    code: 'X',
    title: 'X',
    components: {
      L: { conducted: 28, attended: 22 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  };
  const { gain, loss } = classImpact(subj, DEFAULT_WEIGHTS, 'L');
  assert.ok(gain > 0 && gain < 5, `gain=${gain}`);
  assert.ok(loss > 0 && loss < 5, `loss=${loss}`);
});

test('maxSkippable respects the safe line', () => {
  const subj = {
    code: 'X',
    title: 'X',
    components: {
      L: { conducted: 20, attended: 20 },
      T: { conducted: 0, attended: 0 },
      P: { conducted: 0, attended: 0 },
      S: { conducted: 0, attended: 0 },
    },
  };
  // 100% with 20 classes: can miss floor((2000/85 - 2000)/100) = floor(3.529) = 3
  assert.equal(maxSkippable(subj, DEFAULT_WEIGHTS, 85), 3);
  assert.equal(policyBand(90, DEFAULT_THRESHOLDS), 'safe');
  assert.equal(policyBand(80, DEFAULT_THRESHOLDS), 'condonation');
  assert.equal(policyBand(70, DEFAULT_THRESHOLDS), 'below');
});
