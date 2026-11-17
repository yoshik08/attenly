/**
 * The built-in captcha reader (lib/erp/solve.ts) on real ERP captchas.
 *
 * tests/fixtures/captchas/<answer>.png are real captchas from the ERP's login page;
 * each answer is what klu-captcha-solver/app.py (Python, onnxruntime) reads, and the
 * TypeScript port matched app.py on all 22 captchas compared (these 8 included).
 * jlbffab.png and zakosmw.png are copies of .local/erp/captcha.png and
 * .local/plan-ltps/captcha.png; the originals are read too when they exist (.local is
 * not committed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { ctcGreedyDecode, solveCaptcha } from '../lib/erp/solve';

const DIR = join(import.meta.dirname, 'fixtures', 'captchas');
const b64 = (buf: Buffer) => buf.toString('base64');

test('reads every saved ERP captcha exactly as app.py does', async () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const png = readFileSync(join(DIR, f));
    assert.equal(await solveCaptcha(b64(png)), f.replace(/\.png$/, ''), f);
    // A data URL reads the same as bare base64.
    assert.equal(await solveCaptcha(`data:image/png;base64,${b64(png)}`), f.replace(/\.png$/, ''), `${f} as data URL`);
  }
});

test('the captchas saved in .local read as their fixture copies', async (t) => {
  const saved = [
    ['.local/erp/captcha.png', 'jlbffab'],
    ['.local/plan-ltps/captcha.png', 'zakosmw'],
  ] as const;
  const present = saved.filter(([p]) => existsSync(p));
  if (present.length === 0) return t.skip('.local is not in this checkout');
  for (const [p, answer] of present) assert.equal(await solveCaptcha(b64(readFileSync(p))), answer, p);
});

test('a captcha that is not 120×50 is refused with a coded error, not resampled', async () => {
  const img = new PNG({ width: 60, height: 25 });
  img.data.fill(255);
  await assert.rejects(solveCaptcha(b64(PNG.sync.write(img))), (e: { code?: string; message?: string }) => {
    return e.code === 'solve_failed' && /60×25/.test(e.message ?? '');
  });
});

test('anything that is not a PNG is refused with a coded error', async () => {
  await assert.rejects(solveCaptcha(b64(Buffer.from('<svg/>'))), (e: { code?: string }) => e.code === 'solve_failed');
  await assert.rejects(solveCaptcha('not base64 at all!'), (e: { code?: string }) => e.code === 'solve_failed');
});

test('CTC greedy decode: argmax per step, repeats collapse, blank 0 separates', () => {
  // 6 steps × 4 classes (blank, a, b, c): a a _ a b b → "aab"
  const steps = [1, 1, 0, 1, 2, 2];
  const logits = new Float32Array(steps.length * 4);
  steps.forEach((c, t) => (logits[t * 4 + c] = 5));
  assert.equal(ctcGreedyDecode(logits, steps.length, 4), 'aab');
  // A tie goes to the first class, as numpy's argmax does.
  assert.equal(ctcGreedyDecode(new Float32Array([0, 1, 1, 0]), 1, 4), 'a');
});
