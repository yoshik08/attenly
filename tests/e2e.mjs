/**
 * End-to-end: drives the real UI in headless Chromium against the local stack
 * (in-memory MongoDB, mock ERP + solver, synthetic Google sessions).
 *
 *   npm run test:e2e              starts its own stack (next dev)
 *   E2E_PROD=1 npm run test:e2e   against `next build` output (run the build first)
 *   E2E_REUSE=1 npm run test:e2e  reuses a stack already started with `npm run stack`
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { MongoClient } from 'mongodb';

let stack;
let st;
let browser;
let mongo;
const consoleErrors = [];

async function control(body) {
  const r = await fetch(`${st.mock}/__mock/control`, { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
async function resetMock() {
  await control({ knobs: { solverWrong: 0, solverDown: false, rateLimitLogins: false, failDatasets: [], loginDelayMs: 0, attendanceDbDown: false } });
}

async function ctxFor(user, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  if (user) {
    await ctx.addCookies([{ name: st.cookieName, value: st.users[user].cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`${user}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Expected answers (wrong password 401, wrong captcha 422, paused 409) surface as
    // "Failed to load resource" in Chrome; they are part of the flows under test.
    const expected = /Failed to load resource: the server responded with a status of (401|409|422)/.test(m.text()) && /\/api\/erp\//.test(m.location().url ?? '');
    if (!expected) consoleErrors.push(`${user}: ${m.text()} @ ${m.location().url ?? ''}`);
  });
  return { ctx, page };
}

async function linkVia(page, id, password) {
  const captcha = page.getByLabel('Captcha', { exact: true });
  await page.waitForFunction(() => {
    const el = document.querySelector('input[id^="cap-"]');
    return el && el.value.length > 0;
  });
  if (id) await page.getByLabel('University ID', { exact: true }).fill(id);
  await page.getByLabel('ERP password', { exact: true }).fill(password);
  assert.ok((await captcha.inputValue()).length >= 4, 'captcha auto-filled');
}

before(async () => {
  if (!process.env.E2E_REUSE) {
    stack = spawn(process.execPath, ['tests/stack.mjs', ...(process.env.E2E_PROD ? ['--prod'] : [])], {
      env: { ...process.env, APP_PORT: '3200', MOCK_ERP_PORT: '4200' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('stack did not start')), 180_000);
      stack.stdout.on('data', (b) => {
        if (b.toString().includes('READY')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }
  st = JSON.parse(readFileSync('tests/.stack.json', 'utf8'));
  mongo = await MongoClient.connect(st.mongoUri);
  browser = await chromium.launch({ headless: true });
  // Warm the dev server so the first assertions don't race compilation.
  for (const p of ['/', '/timetable', '/cgpa', '/calculator', '/settings', '/privacy']) await fetch(st.app + p).catch(() => undefined);
});

after(async () => {
  await browser?.close();
  await mongo?.close();
  stack?.kill();
  assert.deepEqual(consoleErrors, [], 'no console errors or page errors');
});

test('the bare deployment URL redirects into the app', async () => {
  const origin = new URL(st.app).origin;
  const r = await fetch(origin + '/', { redirect: 'manual' });
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('location'), '/attenly');
});

test('health check reports the database and solver without any data', async () => {
  const r = await fetch(st.app + '/api/health');
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.db, 'ok');
  assert.equal(typeof d.linkedUsers, 'number');
  assert.equal(d.solver, true);
  assert.deepEqual(Object.keys(d).sort(), ['db', 'linkedUsers', 'ms', 'ok', 'solver']);
});

test('signed out: the gate explains the app and starts Google sign-in', async () => {
  const { ctx, page } = await ctxFor(null);
  await page.goto(st.app);
  await page.getByRole('heading', { name: 'Your KL attendance, without the ERP.' }).waitFor();
  let googleUrl = null;
  await page.route('https://accounts.google.com/**', (route) => {
    googleUrl = route.request().url();
    return route.abort();
  });
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !googleUrl; i++) await page.waitForTimeout(100);
  assert.ok(googleUrl, 'navigated to Google');
  const u = new URL(googleUrl);
  assert.equal(u.searchParams.get('client_id'), 'local-test-client.apps.googleusercontent.com');
  assert.equal(u.searchParams.get('redirect_uri'), `${st.app}/api/auth/callback/google`);
  await ctx.close();
});

test('a failed Google sign-in comes back with a readable message', async () => {
  const { ctx, page } = await ctxFor(null);
  await page.goto(`${st.app}?error=OAuthCallback`);
  await page.getByRole('alert').filter({ hasText: 'Google sign-in didn’t finish. Try again.' }).waitFor();
  assert.ok(!page.url().includes('error='), 'error param removed from the address bar');
  await ctx.close();
});

test('privacy page says how credentials are stored', async () => {
  const { ctx, page } = await ctxFor(null);
  await page.goto(`${st.app}/privacy`);
  await page.getByText('They are stored as you typed them, not encrypted').waitFor();
  await ctx.close();
});

test('first link: a wrong password is explained, the right one syncs and shows attendance', async () => {
  const { ctx, page } = await ctxFor('fresh');
  await page.goto(st.app);
  await page.getByRole('heading', { name: 'Link your ERP account' }).waitFor();
  await linkVia(page, '9900000002', 'wrong-password');
  await page.getByRole('button', { name: 'Link and sync' }).click();
  await page.getByRole('alert').filter({ hasText: 'Incorrect username or password.' }).waitFor();
  assert.equal(await page.getByLabel('ERP password').getAttribute('aria-invalid'), 'true');
  await linkVia(page, null, 'other-pass-2');
  await page.getByRole('button', { name: 'Link and sync' }).click();
  await page.getByRole('heading', { name: 'Attendance' }).waitFor();
  await page.getByRole('article', { name: 'Electrical Machines' }).waitFor();
  await page.getByRole('article', { name: 'Signals and Systems' }).waitFor();
  await ctx.close();
});

test('a typo in the captcha loads a fresh one and says so', async () => {
  const { ctx, page } = await ctxFor('fresh');
  await page.goto(st.app);
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('button', { name: 'Link another ERP account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Link another ERP account' });
  await sheet.waitFor();
  await linkVia(page, '9900000002', 'other-pass-2');
  await sheet.getByLabel('Captcha', { exact: true }).fill('zzzzzz');
  await sheet.getByRole('button', { name: 'Link and sync' }).click();
  await sheet.getByRole('alert').filter({ hasText: 'The captcha didn’t match. Here’s a fresh one.' }).waitFor();
  await page.waitForFunction(() => document.querySelector('dialog input[id^="cap-"]')?.value.length > 0);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await ctx.close();
});

test('attendance: course cards, band badges, rings, planner and keyboard', async () => {
  // Make sure the main user has an account (the smoke run may not have happened).
  const u = await mongo.db('skipwise').collection('users').findOne({ googleId: st.users.main.sub });
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  if (!u) {
    await linkVia(page, '9900000001', 'kl-test-pass');
    await page.getByRole('button', { name: 'Link and sync' }).click();
  }
  const os = page.getByRole('article', { name: 'Operating Systems' });
  await os.waitFor();
  // Attendance is per course: no cross-course suggestion and no overall total.
  assert.equal(await page.locator('.plate').count(), 0, 'no insight plate');
  assert.equal(await page.getByText('Overall, weighted').count(), 0, 'no overall figure');
  // Each card carries the college band badge and a ring with the course's figure.
  await os.getByText('CONDONATION', { exact: true }).waitFor();
  assert.equal(await os.locator('svg circle').count(), 2, 'ring track and arc');
  // Planner via keyboard, from the card itself.
  const plan = os.locator('button[aria-expanded]');
  await plan.focus();
  await page.keyboard.press('Enter');
  assert.equal(await plan.getAttribute('aria-expanded'), 'true');
  assert.equal(await os.locator('.bub[data-s="need-thin"]').count() > 0, true, 'needed classes drawn');
  const more = os.getByRole('button', { name: 'Attend upcoming lectures: one more' });
  for (let i = 0; i < 20; i++) await more.click();
  await os.getByText('After that plan').waitFor();
  await os.locator('.figure').filter({ hasText: '85%' }).last().waitFor();
  await os.getByRole('button', { name: 'Reset' }).click();
  await os.getByText('Add classes to see where you’d land').waitFor();
  await ctx.close();
});

test('force sync from the status pill finishes fast, reusing the ERP session', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  await page.getByRole('article', { name: 'Database Management Systems' }).waitFor();
  await control({ bump: { id: '9900000001', code: '24CS2202', k: 'L', attended: 1, conducted: 1 } });
  const before = await control({});
  await page.getByRole('button', { name: /Synced|Not synced|Sync failed/ }).click();
  const status = page.getByRole('dialog', { name: 'Sync status' });
  const done = page.waitForResponse((r) => r.url().endsWith('/api/erp/hard-sync'));
  const started = Date.now();
  await status.getByRole('button', { name: 'Sync now' }).click();
  const res = await done;
  const took = Date.now() - started;
  assert.equal((await res.json()).code, 'synced');
  assert.ok(took < 5_000, `the manual sync answered in ${took}ms`);
  // The saved ERP session is reused: no second captcha solve or login.
  const after = await control({});
  assert.equal(after.counters.logins, before.counters.logins, 'no new ERP login');
  assert.equal(after.counters.solves, before.counters.solves, 'no new captcha solve');
  await page.keyboard.press('Escape');
  const db = page.getByRole('article', { name: 'Database Management Systems' });
  await db.getByText('+1 lecture attended since you last looked').waitFor();
  await db.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2200);
  await page.reload();
  await page.getByRole('article', { name: 'Database Management Systems' }).waitFor();
  assert.equal(await page.getByText('+1 lecture attended since you last looked').count(), 0, 'badge cleared after being seen');
  await ctx.close();
});

test('auto-sync: data older than 5.5 minutes re-syncs on its own', async () => {
  await mongo.db('skipwise').collection('snapshots').updateMany({ googleId: st.users.main.sub }, { $set: { syncedAt: new Date(Date.now() - 10 * 60_000) } });
  const { ctx, page } = await ctxFor('main');
  const autoSync = page.waitForRequest((r) => r.url().endsWith('/api/erp/hard-sync') && r.postData()?.includes('"auto"'));
  await page.goto(st.app);
  await autoSync;
  await page.getByRole('button', { name: /Synced just now/ }).waitFor({ timeout: 30_000 });
  await ctx.close();
});

test('timetable: a course’s next class opens its day; slots link back', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  const link = page.getByRole('article', { name: 'Probability and Statistics' }).getByRole('link', { name: /^Next class/ });
  await link.click();
  await page.waitForURL(/\/timetable\?day=/);
  await page.getByRole('heading', { name: 'Timetable' }).waitFor();
  const day = new URL(page.url()).searchParams.get('day');
  await page.getByRole('tab', { name: day, exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
  const slot = page.locator('ol li a').filter({ hasText: 'Probability and Statistics' }).first();
  await slot.click();
  await page.waitForURL(/#course-24MT2005/);
  await page.getByRole('article', { name: 'Probability and Statistics' }).waitFor();
  await ctx.close();
});

test('plan the day: the strip answers each period as it is planned', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  const tabs = page.getByRole('navigation', { name: 'Sections' }).last();
  await tabs.getByRole('link', { name: 'Plan the day' }).click();
  await page.waitForURL(/\/plan$/);
  await page.getByRole('heading', { name: 'Plan the day' }).waitFor();
  const strip = page.getByRole('list', { name: 'Courses and the percentage each would have' });
  // The animate-in figures split their digits across spans, so compare without whitespace.
  const stripText = async () => (await strip.innerText()).replace(/\s+/g, '');
  const before = await stripText();
  const cards = page.locator('ol > li');
  const count = await cards.count();
  assert.ok(count > 0, 'the day has periods');
  // Bunk every period: some course in the strip must drop and say what it was.
  for (let i = 0; i < count; i++) await cards.nth(i).getByRole('group').getByRole('button', { name: 'Bunk' }).click();
  await page.getByText(/^was \d+%$/).first().waitFor();
  assert.notEqual(await stripText(), before, 'the plan changes the strip');
  // Not conducted counts for neither side: the strip returns to the recorded figures.
  for (let i = 0; i < count; i++) await cards.nth(i).getByRole('group').getByRole('button', { name: 'Not conducted' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.getByText(/^was \d+%$/).count(), 0, 'not conducted changes nothing');
  assert.equal(await stripText(), before, 'strip back to the recorded figures');
  // Attending counts on both sides.
  await cards.first().getByRole('group').getByRole('button', { name: 'Attended' }).click();
  assert.equal(await cards.first().getByRole('button', { name: 'Attended' }).getAttribute('aria-pressed'), 'true');
  await ctx.close();
});

test('CGPA: latest semester first with its grades', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/cgpa`);
  await page.getByText('8.50').first().waitFor();
  await page.getByRole('heading', { name: /Even Sem/ }).waitFor();
  await page.getByRole('button', { name: /Odd Sem/ }).click();
  await page.getByRole('cell', { name: /Problem Solving with C/ }).waitFor();
  await ctx.close();
});

test('calculator: rounding, both lines, validation, saved results', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/calculator`);
  await page.getByLabel('Classes held').fill('39');
  await page.getByLabel('Classes attended').fill('33');
  await page.getByText('84.62% before rounding up').waitFor();
  await page.getByText('You’re on the 85% line. Missing the next class drops you below it.').waitFor();
  // The calculator follows the one global target; it has no 75/85 switch of its own.
  await page.getByRole('link', { name: 'Change the target' }).click();
  await page.getByRole('heading', { name: 'Forecast' }).waitFor();
  await page.getByRole('tab', { name: '75%' }).click();
  await page.goto(`${st.app}/calculator`);
  await page.getByLabel('Classes held').fill('39');
  await page.getByLabel('Classes attended').fill('33');
  await page.getByText(/You can miss \d+ more and still show 75%\./).waitFor();
  await page.getByLabel('Classes attended').fill('40');
  await page.getByText('You can’t attend more classes than were held.').waitFor();
  await page.getByLabel('Classes attended').fill('33');
  await page.getByLabel('Save this result as').fill('Operating Systems');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = page.getByRole('region', { name: 'Saved results' });
  await saved.getByText('Operating Systems').waitFor();
  await page.getByRole('tab', { name: 'By component' }).click();
  await page.getByLabel('Lecture %').fill('80');
  await page.getByLabel('Practical %').fill('100');
  await page.getByText('86.67% before rounding up').waitFor();
  await saved.getByRole('button', { name: 'Delete Operating Systems' }).click();
  assert.equal(await page.getByRole('region', { name: 'Saved results' }).count(), 0);
  await ctx.close();
});

test('forecast: marking days moves the projection, Reset restores it', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/forecast`);
  await page.getByRole('heading', { name: 'Forecast' }).waitFor();
  const daa = page.getByRole('listitem').filter({ hasText: 'Design and Analysis of Algorithms' });
  const flat = async () => (await daa.innerText()).replace(/\s+/g, '');
  const before = await flat();
  await page.getByRole('button', { name: 'Mark absent' }).click();
  await page.waitForTimeout(300);
  assert.notEqual(await flat(), before, 'absent days drop the projection');
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(300);
  assert.equal(await flat(), before, 'Reset brings the projection back');
  // Sundays are holidays and cannot be marked.
  const sunday = page.locator('button[aria-label*=": holiday"]').first();
  assert.equal(await sunday.isDisabled(), true, 'Sundays count as holidays');
  await ctx.close();
});

test('history: a month of days coloured by attendance, and one day’s periods', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/history`);
  await page.getByRole('heading', { name: 'History' }).waitFor();
  await page.getByRole('list', { name: 'Legend' }).waitFor();
  // Every day that had classes is a button; the first class day had absences only.
  const days = page.locator('button[aria-label*=" attended"]');
  assert.ok((await days.count()) > 0, 'the calendar has days with classes');
  // The page opens on the newest month with records; walk back to the first one.
  const prev = page.getByRole('button', { name: 'Previous month' });
  for (let i = 0; i < 6 && (await page.locator('button[aria-label*="0 of"]').count()) === 0; i++) {
    await prev.click();
    await page.waitForTimeout(120);
  }
  const red = page.locator('button[aria-label*="0 of"]').first();
  assert.equal(await red.count(), 1, 'a day with no attendance');
  await red.click();
  await page.getByText('Absent').first().waitFor();
  assert.match(await page.locator('section[aria-label^="Periods on"]').innerText(), /0 attended/);
  // A day where everything was attended.
  const green = page.locator('button[aria-label*=" attended"]').last();
  await green.click();
  await page.waitForTimeout(150);
  assert.match(await page.locator('section[aria-label^="Periods on"]').innerText(), /Attended/);
  await ctx.close();
});

test('payments: every fee order, and its receipt read from the ERP', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/payments`);
  await page.getByRole('heading', { name: 'Payments' }).waitFor();
  await page.getByText('SBI:P-96539:T-1793586750').waitFor();
  await page.getByText('Semester-2 Tuition Fee').first().waitFor();
  await page.getByText('HDF:P-96539:T-1791714022').waitFor();
  // The pending order says so.
  await page.getByText('Pending').waitFor();
  await page.getByRole('button', { name: 'Receipt' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Online payment receipt' });
  await sheet.getByText('TEST STUDENT').waitFor();
  await sheet.getByText('TUITION FEE-Semester-2 Tuition Fee').waitFor();
  await sheet.getByText('*** TEST AMOUNT RUPEES ONLY ***.').waitFor();
  await sheet.getByRole('button', { name: 'Print' }).waitFor();
  await ctx.close();
});

test('settings: one global target drives the calculator and the forecast', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/settings`);
  assert.equal(await page.getByLabel('Floor (%)').count(), 0, 'no separate floor');
  assert.equal(await page.getByLabel('Cruise line (%)').count(), 0, 'no separate cruise line');
  await page.getByRole('tab', { name: '75%' }).click();
  await page.goto(`${st.app}/calculator`);
  await page.getByText('Aim for 75%').waitFor();
  await page.goto(`${st.app}/forecast`);
  await page.getByRole('heading', { name: 'Forecast' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '75%' }).getAttribute('aria-selected'), 'true');
  // The college's band on a card does not move with the target.
  await page.goto(st.app);
  const os = page.getByRole('article', { name: 'Operating Systems' });
  await os.waitFor();
  await os.getByText('CONDONATION', { exact: true }).waitFor();
  await page.goto(`${st.app}/settings`);
  await page.getByRole('button', { name: 'Back to 85%' }).click();
  assert.equal(await page.getByRole('tab', { name: '85%' }).getAttribute('aria-selected'), 'true');
  await ctx.close();
});

test('accounts: add, switch, make primary, remove', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('button', { name: 'Link another ERP account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Link another ERP account' });
  await linkVia(page, '9900000002', 'other-pass-2');
  await sheet.getByLabel('Name for this account').fill('Sibling');
  await sheet.getByRole('button', { name: 'Link and sync' }).click();
  await page.getByRole('article', { name: 'Electrical Machines' }).waitFor();
  await page.getByText('Showing Sibling').waitFor();
  // switch back from the account menu
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('button', { name: /^9900000001/ }).click();
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();
  // settings: make primary, then remove (two taps)
  await page.goto(`${st.app}/settings`);
  const card = page.locator('li').filter({ hasText: 'Sibling' });
  await card.getByRole('button', { name: 'Make primary' }).click();
  await card.getByText('primary').waitFor();
  await card.getByRole('button', { name: 'Remove' }).click();
  await card.getByRole('button', { name: 'Remove it and its data' }).click();
  await page.locator('li').filter({ hasText: 'Sibling' }).waitFor({ state: 'detached' });
  const doc = await mongo.db('skipwise').collection('users').findOne({ googleId: st.users.main.sub });
  assert.equal(doc.accounts.length, 1);
  assert.equal(doc.erpUid, '9900000001');
  assert.equal(await mongo.db('skipwise').collection('snapshots').countDocuments({ googleId: st.users.main.sub, universityId: '9900000002' }), 0);
  await ctx.close();
});

test('a password changed on the ERP pauses syncing until it is re-entered', async () => {
  await control({ password: { id: '9900000001', value: 'new-erp-pass' } });
  // A background sync is the one that logs in and notices; the button reuses
  // the saved ERP session, so make the cloud data stale exactly as it is after
  // five and a half minutes.
  await mongo.db('skipwise').collection('snapshots').updateMany({ googleId: st.users.main.sub }, { $set: { syncedAt: new Date(Date.now() - 10 * 60_000) } });
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  await page.getByRole('button', { name: 'Password needed' }).waitFor({ timeout: 30_000 });
  await page.getByText('The ERP rejected the saved password. Enter your current ERP password.').first().waitFor();
  await page.getByRole('button', { name: 'Enter password' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Enter your ERP password' });
  await sheet.waitFor();
  await linkVia(page, null, 'new-erp-pass');
  await sheet.getByRole('button', { name: 'Save password and sync' }).click();
  await page.getByRole('button', { name: /Synced just now/ }).waitFor({ timeout: 30_000 });
  const doc = await mongo.db('skipwise').collection('users').findOne({ googleId: st.users.main.sub });
  assert.equal(doc.erpPass, 'new-erp-pass');
  await control({ password: { id: '9900000001', value: 'kl-test-pass' } });
  await mongo.db('skipwise').collection('users').updateOne({ googleId: st.users.main.sub }, { $set: { erpPass: 'kl-test-pass', 'accounts.0.erpPass': 'kl-test-pass' } });
  await ctx.close();
});

test('tab bar navigates on phones; the rest live under More; desktop shows every section', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  const tabs = page.getByRole('navigation', { name: 'Sections' }).last();
  await tabs.getByRole('link', { name: 'Timetable' }).click();
  await page.waitForURL(/\/timetable$/);
  await tabs.getByRole('link', { name: 'History' }).click();
  await page.waitForURL(/\/history$/);
  await tabs.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('link', { name: 'CGPA' }).click();
  await page.waitForURL(/\/cgpa$/);
  assert.equal(await tabs.getByRole('button', { name: 'More' }).getAttribute('aria-expanded'), 'false');
  await ctx.close();
  const desk = await ctxFor('main', { viewport: { width: 1440, height: 900 } });
  await desk.page.goto(st.app);
  const nav = desk.page.getByRole('navigation', { name: 'Sections' }).first();
  await nav.getByRole('link', { name: 'Payments' }).click();
  await desk.page.waitForURL(/\/payments$/);
  await nav.getByRole('link', { name: 'Settings' }).click();
  await desk.page.waitForURL(/\/settings$/);
  await desk.ctx.close();
});

test('semester: automatic finds the newest with attendance; Settings can pick another', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(st.app);
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();
  await page.getByText('Even Sem 2026-2027').first().waitFor();
  await page.getByRole('link', { name: 'Change' }).first().click();
  await page.waitForURL(/\/settings#semester$/);
  await page.getByText('Showing Even Sem 2026-2027.').waitFor();
  await page.getByRole('tab', { name: 'Choose' }).click();
  await page.getByLabel('Academic year').selectOption({ label: '2025-2026' });
  await page.getByLabel('Semester', { exact: true }).selectOption({ label: 'Odd Sem' });
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/erp/hard-sync'));
  await page.getByRole('button', { name: 'Sync this semester' }).click();
  assert.equal((await (await synced).json()).code, 'synced');
  await page.getByRole('button', { name: 'Showing Odd Sem 2025-2026' }).waitFor();
  await page.getByRole('navigation', { name: 'Sections' }).last().getByRole('link', { name: 'Attendance' }).click();
  await page.getByRole('article', { name: 'Computer Organization' }).waitFor();
  await page.getByText('Odd Sem 2025-2026').first().waitFor();
  await page.goto(`${st.app}/settings`);
  const back = page.waitForResponse((r) => r.url().endsWith('/api/erp/hard-sync'));
  await page.getByRole('tab', { name: 'Automatic' }).click();
  await back;
  await page.getByText('Showing Even Sem 2026-2027.').waitFor();
  await ctx.close();
});

test('attendance register down on the ERP: the home screen says so; kept numbers are dated', async () => {
  const forceSync = async (page) => {
    await page.getByRole('button', { name: /Synced|Not synced|Sync failed/ }).click();
    const done = page.waitForResponse((r) => r.url().endsWith('/api/erp/hard-sync'));
    await page.getByRole('dialog', { name: 'Sync status' }).getByRole('button', { name: 'Sync now' }).click();
    assert.equal((await (await done).json()).code, 'synced');
    await page.keyboard.press('Escape');
  };
  const { ctx, page } = await ctxFor('main', { reducedMotion: 'reduce' });
  await page.goto(st.app);
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();
  await control({ knobs: { attendanceDbDown: true } });
  await forceSync(page);
  const notice = page.getByRole('status').filter({ hasText: 'KL ERP’s attendance register is down' });
  await notice.getByText(/These numbers are from just now/).waitFor();
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();

  // Nothing read for this term yet (the real ERP on 3 Nov 2026): no courses, no empty-term message.
  await mongo.db('skipwise').collection('snapshots').deleteMany({ googleId: st.users.main.sub });
  await page.evaluate(() => localStorage.clear()); // a first visit: nothing cached on the device either
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/erp/hard-sync'));
  await page.reload();
  assert.equal((await (await synced).json()).code, 'synced');
  await notice.getByText(/Attenly checks again on every sync/).waitFor();
  await page.getByText('Even Sem 2026-2027').first().waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  assert.equal(await page.getByText(/The ERP shows no attendance/).count(), 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((v) => v.id), []);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/register-down.png`, fullPage: true });

  await control({ knobs: { attendanceDbDown: false } });
  await forceSync(page);
  await page.getByRole('article', { name: 'Operating Systems' }).waitFor();
  assert.equal(await notice.count(), 0);
  await ctx.close();
});

test('accessibility: no serious or critical WCAG 2.2 AA issues on any screen', async () => {
  const problems = [];
  for (const [who, viewport] of [[null, { width: 390, height: 844 }], ['main', { width: 390, height: 844 }], ['main', { width: 1440, height: 900 }]]) {
    const { ctx, page } = await ctxFor(who, { viewport, reducedMotion: 'reduce' });
    for (const path of who ? ['/', '/timetable', '/plan', '/forecast', '/history', '/payments', '/cgpa', '/calculator', '/settings', '/privacy'] : ['/', '/privacy']) {
      await page.goto(st.app + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
        problems.push(`${who ?? 'signed-out'} ${viewport.width}px ${path}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
      }
    }
    await ctx.close();
  }
  assert.deepEqual(problems, []);
});

test('sign out returns to the gate', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/settings`);
  await page.getByRole('button', { name: 'Sign out of Google' }).click();
  await page.getByRole('heading', { name: 'Your KL attendance, without the ERP.' }).waitFor({ timeout: 20_000 });
  await ctx.close();
});

test('reset mock', async () => {
  await resetMock();
});
