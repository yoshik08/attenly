/**
 * Headless screenshots of every screen at phone and desktop widths.
 *   node tests/shots.mjs [outDir] [user]
 * Needs the local stack (node tests/stack.mjs) running.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const st = JSON.parse(readFileSync('tests/.stack.json', 'utf8'));
const out = process.argv[2] ?? '.impeccable/review';
const who = process.argv[3] ?? 'main';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pages = [['attendance', '/'], ['timetable', '/timetable'], ['cgpa', '/cgpa'], ['calculator', '/calculator'], ['settings', '/settings']];
for (const [vw, size] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: vw === 'mobile' ? 2 : 1, reducedMotion: 'reduce' });
  if (who !== 'none') await ctx.addCookies([{ name: st.cookieName, value: st.users[who].cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const [name, path] of pages) {
    await page.goto(st.app + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${who}-${vw}-${name}.png`, fullPage: true });
  }
  console.log(vw, errors.length ? errors : 'no console errors');
  await ctx.close();
}
await browser.close();
