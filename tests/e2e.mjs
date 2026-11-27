/**
 * End-to-end: drives the real UI in headless Chromium against the local stack
 * (in-memory MongoDB, mock ERP serving real captchas, synthetic Google sessions).
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
import { planLtpsData } from './fixtures/plan-ltps.mjs';

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
  await control({ knobs: { rateLimitLogins: false, failDatasets: [], loginDelayMs: 0, attendanceDbDown: false } });
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
    // Expected answers (wrong password 401, wrong captcha 422, paused 409, a
    // rate-limited ERP 429) surface as "Failed to load resource" in Chrome; they
    // are part of the flows under test.
    const expected = /Failed to load resource: the server responded with a status of (401|409|422|429)/.test(m.text()) && /\/api\/erp\//.test(m.location().url ?? '');
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  // Warm the dev server so the first assertions don't race compilation.
  for (const p of ['/', '/timetable', '/cgpa', '/marks', '/booklets', '/courses', '/profile', '/circulars', '/calculator', '/settings', '/privacy']) await fetch(st.app + p).catch(() => undefined);
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

test('health check reports the database and the built-in captcha reader without any data', async () => {
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

test('without Google: the ERP login alone signs in; nothing reaches the database; it all stays in this browser', async () => {
  const db = mongo.db('skipwise');
  const countAll = async () =>
    Object.fromEntries(await Promise.all(['users', 'snapshots', 'erpSessions', 'records'].map(async (c) => [c, await db.collection(c).countDocuments()])));
  const before = await countAll();
  const { ctx, page } = await ctxFor(null);
  const calls = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/attenly/api/')) calls.push(u.pathname);
  });
  await page.goto(st.app);
  await page.getByRole('button', { name: 'Sign in without Google' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign in without Google' });
  await sheet.getByText('Attenly’s database keeps nothing').waitFor();
  await linkVia(page, '9900000001', 'kl-test-pass');
  await sheet.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Attendance' }).waitFor();
  await page.getByRole('article', { name: 'Database Management Systems' }).waitFor();
  assert.deepEqual(await countAll(), before, 'nothing written to the database');
  const stored = await page.evaluate(() => localStorage.getItem('attenly:local:v1'));
  assert.ok(stored?.includes('"universityId":"9900000001"'), 'the account is kept in this browser');
  assert.ok(!stored.includes('kl-test-pass'), 'the password is sealed, not readable');

  // A reload paints from this browser: no Google data request, and fresh data isn't pulled again.
  calls.length = 0;
  await page.reload();
  await page.getByRole('article', { name: 'Database Management Systems' }).waitFor();
  await page.waitForTimeout(1500);
  // next-auth's own session probe isn't a data request; anything else would be.
  assert.deepEqual(calls.filter((c) => c !== '/attenly/api/auth/session'), [], 'no API calls on reload');

  // Sync now refreshes through the sealed login.
  await page.getByRole('button', { name: /Synced|Not synced/ }).click();
  const status = page.getByRole('dialog', { name: 'Sync status' });
  await status.getByText('it quietly pulls fresh numbers from the ERP', { exact: false }).waitFor();
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/local/sync'));
  await status.getByRole('button', { name: 'Sync now' }).click();
  assert.equal((await (await synced).json()).code, 'synced');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Synced just now/ }).waitFor();

  // ERP screens read on demand, documents open in a new tab through a form post.
  await page.goto(`${st.app}/marks`);
  await page.getByRole('article', { name: 'Design and Analysis of Algorithms' }).getByText('24.62', { exact: true }).waitFor();
  await page.goto(`${st.app}/circulars`);
  const doc = ctx.waitForEvent('response', (r) => r.url().endsWith('/api/local/circular'));
  await page.getByRole('button', { name: /Mid-term examination schedule/ }).click();
  const docRes = await doc;
  assert.equal(docRes.status(), 200);
  assert.equal(docRes.headers()['content-type'], 'application/pdf');
  assert.ok(!docRes.url().includes('key='), 'the sealed login is not in the address');
  await page.goto(`${st.app}/payments`);
  await page.getByRole('button', { name: 'Receipt' }).first().click();
  await page.getByRole('dialog', { name: 'Online payment receipt' }).getByText('TEST STUDENT').waitFor();
  await page.keyboard.press('Escape');

  // Settings speak for this mode, and pass the accessibility check.
  await page.goto(`${st.app}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Signed in without Google' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Link another ERP account' }).count(), 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), []);
  assert.deepEqual(await countAll(), before, 'still nothing in the database');

  // Five minutes on, an open tab re-syncs on its own, quietly, even while hidden.
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('attenly:local:v1'));
    a.snapshot.syncedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    localStorage.setItem('attenly:local:v1', JSON.stringify(a));
    localStorage.removeItem('attenly:local:auto');
  });
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.__sawSyncing = false;
    new MutationObserver(() => {
      if (document.body?.textContent?.includes('Syncing with ERP')) window.__sawSyncing = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const quiet = page.waitForResponse((r) => r.url().endsWith('/api/local/sync'));
  await page.goto(`${st.app}/settings`);
  assert.equal(await page.evaluate(() => document.visibilityState), 'hidden');
  assert.equal((await (await quiet).json()).code, 'synced');
  await page.getByRole('button', { name: /Synced just now/ }).waitFor();
  assert.equal(await page.evaluate(() => window.__sawSyncing), false, 'the background sync never showed a spinner');

  // Signing out forgets it all on this device.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('heading', { name: 'Your KL attendance, without the ERP.' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('attenly:local:v1')), null);
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
  // Planner via keyboard, from the card's own Plan control.
  const plan = os.getByRole('button', { name: /^(Plan|Hide plan)$/ });
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

test('attendance: timetable-only lectures have 0/0 rows and working Attend / Skip steppers', async () => {
  const { ctx, page } = await ctxFor(null, { timezoneId: 'Asia/Kolkata', reducedMotion: 'reduce' });
  try {
    const now = new Date('2026-11-15T10:30:00+05:30').getTime();
    // The reported 1 practical / 3 skilling spare budgets use the 75% target.
    await page.addInitScript(() => localStorage.setItem('attenly:settings:v2', JSON.stringify({ target: 75 })));
    await page.clock.install({ time: now });
    await page.route('**/api/data**', (route) => route.fulfill({ json: planLtpsData(now) }));
    await page.goto(st.app);
    const aoop = page.getByRole('article', { name: 'Advanced Object Oriented Programming', exact: true });
    const cn = page.getByRole('article', { name: 'Computer Networks and Network Programming', exact: true });
    const gl = page.getByRole('article', { name: 'Global Logic', exact: true });
    const rows = (card) => card.getByRole('list', { name: /classes by type$/ }).locator('li');
    const rowText = async (card) => (await rows(card).allTextContents()).map((s) => s.replace(/\s+/g, ''));
    const projection = (card) => card.locator('.t-acc-panel .figure').last().locator('> [aria-hidden="true"]');

    await aoop.waitFor();
    assert.deepEqual(await rowText(aoop), ['Lecture0/0—', 'Practical2/21tospare', 'Skilling6/63tospare']);
    assert.deepEqual(await rowText(cn), ['Lecture0/0—', 'Skilling6/8nonespare']);
    assert.deepEqual(await rowText(gl), ['Skilling11/113tospare']);
    await aoop.getByRole('link', { name: 'Next class tomorrow at 8:10 am · H102' }).waitFor();
    await cn.getByRole('link', { name: 'Next class tomorrow at 10:00 am · H102' }).waitFor();

    for (const card of [aoop, cn, gl]) await card.getByRole('button', { name: 'Plan', exact: true }).click();
    for (const card of [aoop, cn]) {
      await card.getByRole('group', { name: 'Attend upcoming lectures', exact: true }).waitFor();
      await card.getByRole('group', { name: 'Skip upcoming lectures', exact: true }).waitFor();
      assert.equal(await card.getByRole('button', { name: 'Attend upcoming lectures: one fewer' }).isDisabled(), true);
    }
    assert.equal(await gl.getByRole('group', { name: /upcoming lectures/ }).count(), 0);
    assert.equal(await gl.getByRole('group', { name: /upcoming skilling sessions/ }).count(), 2);

    await cn.getByRole('button', { name: 'Attend upcoming lectures: one more' }).click();
    assert.equal(await projection(cn).innerText(), '84%', 'the first lecture attend raises 75% to 84%');
    assert.deepEqual(await rowText(cn), ['Lecture0/0—', 'Skilling6/8nonespare'], 'planning preserves recorded counts and budgets');

    await aoop.getByRole('button', { name: 'Attend upcoming lectures: one more' }).click();
    assert.equal(await projection(aoop).innerText(), '100%', 'an all-attended course stays at 100%');
    await aoop.getByRole('button', { name: 'Skip upcoming lectures: one more' }).click();
    assert.equal(await projection(aoop).innerText(), '78%');
    await aoop.getByRole('button', { name: 'Attend upcoming lectures: one more' }).click();
    assert.equal(await projection(aoop).innerText(), '82%', 'attending another lecture improves the mixed plan');
    await aoop.getByRole('button', { name: 'Reset' }).click();
    assert.equal(await projection(aoop).innerText(), '100%');
    assert.deepEqual(await rowText(aoop), ['Lecture0/0—', 'Practical2/21tospare', 'Skilling6/63tospare']);

    const ai = page.getByRole('article', { name: 'Generative AI', exact: true });
    const sdg = page.getByRole('article', { name: 'Insights to Sustainable Development Goals', exact: true });
    assert.deepEqual((await rowText(ai)).map((s) => s.split(/attend/)[0]), ['Lecture4/4', 'Skilling6/16']);
    assert.equal((await rowText(sdg))[0].startsWith('Lecture2/4'), true);
  } finally {
    await ctx.close();
  }
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
  assert.equal(after.counters.captchas, before.counters.captchas, 'no new captcha read');
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
  await page.getByRole('tab', { name: new RegExp(`^${day}\\s*\\d+$`) }).and(page.locator('[aria-selected="true"]')).waitFor();
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
  // The whole day at once: every period takes it; pressed again, the day clears.
  const whole = page.getByRole('group', { name: /^Every period on / });
  const pressed = (name) => cards.getByRole('button', { name, exact: true, pressed: true }).count();
  await whole.getByRole('button', { name: 'Bunk all' }).click();
  assert.equal(await pressed('Bunk'), count, 'every period bunked');
  assert.equal(await whole.getByRole('button', { name: 'Bunk all' }).getAttribute('aria-pressed'), 'true');
  await page.getByText(/^was \d+%$/).first().waitFor();
  await whole.getByRole('button', { name: 'Attend all' }).click();
  assert.equal(await pressed('Attended'), count, 'every period attended');
  assert.equal(await pressed('Bunk'), 0);
  await whole.getByRole('button', { name: 'None conducted' }).click();
  assert.equal(await pressed('Not conducted'), count);
  await whole.getByRole('button', { name: 'None conducted' }).click();
  assert.equal(await pressed('Not conducted'), 0, 'pressed again, the day clears');
  assert.match(await page.getByText(/ of \d+ planned/).innerText(), /^0 of /);
  await ctx.close();
});

test('CGPA: one SGPA per semester, each from its own courses; the CGPA over all', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/cgpa`);
  // Odd 98/11 = 8.91, Even 89/11 = 8.09, CGPA 187/22 = 8.50; Term3 has only a 0-credit course.
  await page.getByText('8.50').first().waitFor();
  await page.getByText('22 credits over 2 semesters').waitFor();
  const odd = page.getByRole('region', { name: 'Odd Sem 2024-2025' });
  const even = page.getByRole('region', { name: 'Even Sem 2024-2025' });
  const term3 = page.getByRole('region', { name: 'Term3 2024-2025' });
  await odd.getByText('SGPA 8.91 · 11 credits · 3 courses').waitFor();
  await even.getByText('SGPA 8.09 · 11 credits · 3 courses').waitFor();
  await term3.getByText('SGPA — · 0 credits · 0 courses').waitFor();
  await odd.getByRole('cell', { name: /Problem Solving with C/ }).waitFor();
  await odd.getByText('· 0 credits, not counted').waitFor();
  assert.equal(await even.getByRole('cell', { name: /Problem Solving with C/ }).count(), 0, 'a course counts in exactly one semester');
  // Newest first.
  const order = await page.locator('section[id^="sem-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  assert.deepEqual(order, ['Term3 2024-2025', 'Even Sem 2024-2025', 'Odd Sem 2024-2025']);
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
  // The day's dots are its periods, one each, in the list's order and states.
  const dotsOf = async () =>
    page.locator('section[aria-label="Attendance calendar"] button[aria-pressed="true"] > span[aria-hidden] > span').evaluateAll((els) =>
      els.map((e) => (e.className.includes('bg-safe') ? 'P' : e.className.includes('bg-det') ? 'A' : '-')).join(''),
    );
  const listOf = async () =>
    page.locator('section[aria-label^="Periods on"] ol > li').evaluateAll((els) =>
      els.map((e) => ({ safe: 'P', detained: 'A' })[e.getAttribute('data-tone')] ?? '-').join(''),
    );
  assert.equal(await dotsOf(), await listOf(), 'dots match the day');
  assert.match(await page.locator('section[aria-label^="Periods on"]').innerText(), /0 attended/);
  // A day where everything was attended.
  const green = page.locator('button[aria-label*=" attended"]').last();
  await green.click();
  await page.waitForTimeout(150);
  assert.match(await page.locator('section[aria-label^="Periods on"]').innerText(), /Attended/);
  assert.equal(await dotsOf(), await listOf(), 'dots match the day');
  assert.ok((await dotsOf()).length > 0);
  await ctx.close();
});

test('history shortcut: phones get a pill beside the Attendance title, desktop keeps its sidebar only', async () => {
  for (const width of [320, 390]) {
    const { ctx, page } = await ctxFor('main', { viewport: { width, height: 760 } });
    await page.goto(st.app);
    const title = page.getByRole('heading', { name: 'Attendance', level: 1 });
    await title.waitFor();
    const pill = page.getByRole('main').getByRole('link', { name: 'History', exact: true });
    await pill.waitFor();
    const [h, b] = [await title.boundingBox(), await pill.boundingBox()];
    assert.ok(Math.abs(h.y + h.height / 2 - (b.y + b.height / 2)) <= 1.5, `centred on the title at ${width}px`);
    assert.ok(b.x >= h.x + h.width, `beside the title, not under it, at ${width}px`);
    assert.ok(b.x + b.width <= width - 15, `inside the gutter at ${width}px`);
    assert.equal(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().height < 40), true, 'one line');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no sideways scroll at ${width}px`);
    if (width === 390) {
      // The dock is untouched: four sections plus More, and History is still in the More sheet.
      const dock = page.getByRole('navigation', { name: 'Sections' });
      assert.deepEqual(
        (await dock.locator('li').allInnerTexts()).map((t) => t.trim()),
        ['Attendance', 'Timetable', 'Plan', 'Forecast', 'More'],
      );
      await dock.getByRole('button', { name: 'More' }).click();
      const more = page.getByRole('dialog', { name: 'More' });
      await more.getByRole('link', { name: /History/ }).waitFor();
      await page.keyboard.press('Escape');
      await more.waitFor({ state: 'detached' });
      // It opens the existing History page; More lights up there and Back returns to Attendance.
      await pill.click();
      await page.waitForURL(/\/attenly\/history$/);
      await page.getByRole('heading', { name: 'History', level: 1 }).waitFor();
      assert.equal(await dock.locator('li[data-active="true"]').innerText(), 'More');
      await page.goBack();
      await title.waitFor();
      assert.equal(await dock.locator('li[data-active="true"]').innerText(), 'Attendance');
    }
    await ctx.close();
  }
  const { ctx, page } = await ctxFor('main', { viewport: { width: 1440, height: 900 } });
  await page.goto(st.app);
  await page.getByRole('heading', { name: 'Attendance', level: 1 }).waitFor();
  assert.equal(await page.getByRole('main').getByRole('link', { name: 'History', exact: true }).isVisible(), false, 'no shortcut on desktop');
  await page.getByRole('complementary').getByRole('link', { name: 'History' }).waitFor();
  await ctx.close();
});

test('nav: the sync pill never overlaps a nav item at any width', async () => {
  for (const width of [1024, 1152, 1280, 1440, 1920]) {
    const { ctx, page } = await ctxFor('main', { viewport: { width, height: 900 } });
    await page.goto(st.app);
    await page.getByRole('article').first().waitFor();
    const pill = await page.getByRole('button', { name: /^Sync status/ }).boundingBox();
    const links = page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link');
    const count = await links.count();
    assert.ok(pill, `${width}px: the pill is on screen`);
    for (let i = 0; i < count; i++) {
      const b = await links.nth(i).boundingBox();
      if (!b) continue; // hidden below lg
      const overlaps = !(pill.x >= b.x + b.width || b.x >= pill.x + pill.width || pill.y >= b.y + b.height || b.y >= pill.y + pill.height);
      assert.equal(overlaps, false, `${width}px: the pill overlaps nav item ${i}`);
    }
    await ctx.close();
  }
});

test('sync pill: a fast stop says what happened and offers a retry', async () => {
  const { ctx, page } = await ctxFor('main');
  try {
    await page.goto(st.app);
    await page.getByRole('article').first().waitFor();
    // A warm session skips the login, so drop it: this is a session the ERP ended.
    await mongo.db('skipwise').collection('erpSessions').deleteMany({});
    await control({ knobs: { rateLimitLogins: true } });
    await page.getByRole('button', { name: /^Sync status/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Sync status' });
    await dialog.getByRole('button', { name: /Sync now|Try again/ }).click();
    // Not a bare "failed": the pill names the cause, and the last data is still shown.
    await page.getByRole('button', { name: /ERP busy — showing last sync/ }).waitFor({ timeout: 25_000 });
    await dialog.getByRole('button', { name: 'Try again' }).waitFor();
    await dialog.getByText(/rate-limiting logins/).waitFor();
    await page.keyboard.press('Escape');
  } finally {
    await control({ knobs: { rateLimitLogins: false } });
    await ctx.close();
  }
});

test('payments: every fee order, and its receipt read from the ERP', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/payments`);
  await page.getByRole('heading', { name: 'Payments', exact: true }).waitFor();
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
  await page.keyboard.press('Escape');
  // The semester ledger and what is still owed, read from the ERP's fee structure.
  await page.getByText('₹45,000 due on the ERP').waitFor();
  const ledger = page.getByRole('region', { name: 'Semester fees' });
  await ledger.getByText('Year 2 · Even').waitFor();
  await ledger.getByText('₹45,000 due').waitFor();
  await ledger.getByText('Settled').waitFor();
  await ledger.getByText('HDF:P-96539:T-1793500002').waitFor();
  await ctx.close();
});

test('marks: internals by component, the exam room, and mid-term papers question by question', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/marks`);
  await page.getByRole('heading', { name: 'Marks', exact: true }).waitFor();
  const daa = page.getByRole('article', { name: 'Design and Analysis of Algorithms' });
  await daa.waitFor();
  // Mid-term 24/45 → 10.667 of 20; practical 93/100 → 13.95 of 15; MOOCs not marked yet.
  await daa.getByText('24.62', { exact: true }).waitFor();
  await daa.getByText('of 35 so far').waitFor();
  await daa.getByText('2 of 3 components marked').waitFor();
  await daa.getByText('Not marked yet').waitFor();
  // Question-wise marks: "1 C" scored 0, "3 B" (a negative mark on the ERP) was not written.
  const midTerm = daa.getByRole('button', { name: /Mid-Term Examination/ });
  await midTerm.click();
  assert.equal(await midTerm.getAttribute('aria-expanded'), 'true');
  const q = (label) => daa.getByText(label, { exact: true }).locator('..');
  await q('Q1.C').getByText('0', { exact: true }).waitFor();
  await q('Q3.B').getByText('Not written').waitFor();
  await daa.getByText('1 not written; counted as 0 in the total, as on the ERP.').waitFor();
  const rooms = page.getByRole('region', { name: 'Exam rooms' });
  await rooms.getByText('C-204').waitFor();
  // Another semester has no internals.
  // Year and semester are separate segmented pickers; the synced year (2026–27) is already chosen.
  assert.equal(await page.getByRole('tablist', { name: 'Year' }).getByRole('tab', { name: /2026–27/ }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tablist', { name: 'Semester' }).getByRole('tab', { name: 'Odd Sem' }).click();
  await page.getByText('No internal marks on the ERP for Odd Sem 2026-2027 yet.').waitFor();
  // Mid-term papers live on their own screen now.
  await page.getByRole('link', { name: /Mid-term booklets/ }).waitFor();
  await ctx.close();
});

test('booklets: marks question by question, and the scan read from the ERP', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/booklets`);
  await page.getByRole('heading', { name: 'Booklets', exact: true }).waitFor();
  const card = (name) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const daa = card('Design and Analysis of Algorithms');
  // Booklets show per-question marks only — no reconstructed paper total or meter.
  await daa.getByRole('button', { name: '4 questions' }).click();
  // The button now reads "Hide questions" and says it is expanded.
  assert.equal(await daa.getByRole('button', { name: 'Hide questions' }).getAttribute('aria-expanded'), 'true');
  await daa.getByText('Q1.A').waitFor();
  // The scan streams through Attenly as a PDF, although the ERP labels it text/html.
  const href = await daa.getByRole('link', { name: 'Open scan' }).getAttribute('href');
  const res = await page.request.get(new URL(href, st.app).toString());
  assert.equal(res.status(), 200);
  assert.equal(res.headers()['content-type'], 'application/pdf');
  assert.equal((await res.body()).subarray(0, 4).toString(), '%PDF');
  // A paper the ERP has no scan for says so; its questions still list, including an unwritten one.
  const os = card('Operating Systems');
  await os.getByText('No scan on the ERP').waitFor();
  await os.getByRole('button', { name: '4 questions' }).click();
  await os.getByText('Not written').waitFor();
  await ctx.close();
});

test('courses: by year and term, with faculty', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/courses`);
  await page.getByRole('heading', { name: 'Courses', exact: true }).waitFor();
  // The synced term (Year 2, Even Sem 2026-2027) is shown first.
  const year = page.getByRole('tablist', { name: 'Year' });
  assert.equal(await year.getByRole('tab', { name: /^Year 2/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('tablist', { name: 'Term' }).getByRole('tab', { name: /Even/ }).getAttribute('aria-selected'), 'true');
  const daa = page.getByRole('article', { name: 'Design and Analysis of Algorithms' });
  await daa.waitFor();
  await daa.getByText('Ravi Kumar').first().waitFor();
  await daa.getByText('Sita Lakshmi').waitFor();
  await daa.getByText('Lecture').first().waitFor();
  await daa.getByText('Practical').first().waitFor();
  await page.getByRole('article', { name: 'Technical Skills for Engineers' }).getByText('Skilling').first().waitFor();
  // Year 1 has older courses (spread over later pages of the ERP's tab).
  await year.getByRole('tab', { name: /^Year 1/ }).click();
  await page.getByRole('article', { name: /Problem Solving with C/i }).waitFor();
  await page.getByRole('article', { name: /Linear Algebra and Calculus/i }).getByText('Suresh Naidu').first().waitFor();
  assert.equal(await page.getByRole('article', { name: 'Design and Analysis of Algorithms' }).count(), 0);
  await ctx.close();
});

test('profile: academic details, the bus seat and the counselling diary', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/profile`);
  await page.getByRole('heading', { name: 'Test Student One' }).waitFor();
  await page.getByRole('region', { name: 'Academic' }).getByText('R24').waitFor();
  const bus = page.getByRole('region', { name: 'Bus' });
  await bus.getByText('214', { exact: true }).waitFor();
  await bus.getByText('22', { exact: true }).waitFor();
  const diary = page.getByRole('region', { name: 'Counselling diary' });
  await diary.getByText('Called a parent about attendance in Computer Networks.').waitFor();
  await diary.getByText('Spoke to parent').waitFor();
  // Personal details are not shown.
  assert.equal(await page.getByText('01-01-2006').count(), 0);
  await ctx.close();
});

test('circulars: newest first, documents read from the ERP', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/circulars`);
  await page.getByRole('heading', { name: 'Circulars' }).waitFor();
  const first = page.getByRole('link', { name: /Mid-term examination schedule/ });
  await first.waitFor();
  // A circular without a document is not a link.
  await page.getByText('Campus closed on account of a public holiday').waitFor();
  assert.equal(await page.getByRole('link', { name: /Campus closed/ }).count(), 0);
  const href = await first.getAttribute('href');
  const res = await page.request.get(new URL(href, st.app).toString());
  assert.equal(res.status(), 200);
  assert.equal(res.headers()['content-type'], 'application/pdf');
  await ctx.close();
});

test('forecast: the last instruction day is picked on the calendar and saved to the account', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/forecast`);
  await page.getByRole('heading', { name: 'Forecast' }).waitFor();
  const trigger = page.getByRole('button', { name: /Last instruction day/ });
  assert.match(await trigger.innerText(), /Month end/, 'unset by default');
  const before = await page.locator('section[aria-label="Projected impact"]').innerText();

  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Last instruction day' });
  await sheet.waitFor();
  // Two months out ends the window later, so more classes are projected.
  await sheet.getByRole('button', { name: 'Next month' }).click();
  await sheet.getByRole('button', { name: 'Next month' }).click();
  await sheet.locator('button[aria-pressed]').last().click();
  await page.waitForTimeout(400);

  const label = await trigger.innerText();
  assert.ok(!label.includes('Month end'), 'a date replaced the month end');
  const after = await page.locator('section[aria-label="Projected impact"]').innerText();
  assert.match(after, /through \d{1,2} \w{3} \d{4}/, 'the copy names the window end');
  assert.notEqual(after.replace(/\s+/g, ''), before.replace(/\s+/g, ''), 'the projection window grew');

  // Stored on the user, so a fresh page load (new client, same session) has it.
  await page.reload();
  await page.getByRole('heading', { name: 'Forecast' }).waitFor();
  assert.equal(await trigger.innerText(), label, 'kept across a reload');
  const doc = await mongo.db('skipwise').collection('users').findOne({ googleId: st.users.main.sub });
  assert.match(String(doc.lastInstructionDay), /^\d{4}-\d{2}-\d{2}$/, 'saved in the database');

  // And it can be cleared again.
  await trigger.click();
  await page.getByRole('dialog', { name: 'Last instruction day' }).getByRole('button', { name: 'Use month end' }).click();
  await page.waitForTimeout(400);
  assert.match(await trigger.innerText(), /Month end/);
  const cleared = await mongo.db('skipwise').collection('users').findOne({ googleId: st.users.main.sub });
  assert.equal(cleared.lastInstructionDay, null);
  await ctx.close();
});

test('settings: one global target drives the calculator and the forecast', async () => {
  const { ctx, page } = await ctxFor('main');
  await page.goto(`${st.app}/settings`);
  assert.equal(await page.getByLabel('Floor (%)').count(), 0, 'no separate floor');
  assert.equal(await page.getByLabel('Cruise line (%)').count(), 0, 'no separate cruise line');
  await page.getByRole('tab', { name: '75%' }).click();
  // At 75 the copy must name the condonation floor, not detention.
  await page.getByText(/the condonation floor, with detention below it/).waitFor();
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
  await page.getByText(/can still be condoned down to 75%/).waitFor();
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
  // The background refresh logs in again (and notices) once the saved session's login is
  // half an hour old; the button reuses it. Make the cloud data stale and drop the saved
  // session, exactly as it is then.
  await mongo.db('skipwise').collection('snapshots').updateMany({ googleId: st.users.main.sub }, { $set: { syncedAt: new Date(Date.now() - 10 * 60_000) } });
  await mongo.db('skipwise').collection('erpSessions').deleteMany({});
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
  await tabs.getByRole('link', { name: 'Forecast' }).click();
  await page.waitForURL(/\/forecast$/);
  await tabs.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('link', { name: 'History' }).click();
  await page.waitForURL(/\/history$/);
  await more.waitFor({ state: 'detached' });
  await tabs.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'CGPA' }).click();
  await page.waitForURL(/\/cgpa$/);
  await tabs.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Marks' }).click();
  await page.waitForURL(/\/marks$/);
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
    for (const path of who ? ['/', '/timetable', '/plan', '/forecast', '/history', '/payments', '/cgpa', '/marks', '/booklets', '/courses', '/profile', '/circulars', '/calculator', '/settings', '/privacy'] : ['/', '/privacy']) {
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
