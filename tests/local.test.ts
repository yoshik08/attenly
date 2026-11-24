/**
 * Signing in without Google: the /api/local routes against the mock ERP (real captchas,
 * read by the built-in reader). No MongoDB here at all: MONGODB_URI is unset, so any
 * route that touched the database would fail these tests.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ClientSnapshot } from '../lib/db/snapshots';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4198;
const MOCK = `http://localhost:${PORT}`;
const A = '9900000001';
const PASS = 'kl-test-pass';
const HEADER = 'X-Attenly-Erp';

let mock: ChildProcess;
let local: typeof import('../lib/local');
let snap: typeof import('../lib/local-snapshot');
let erp: typeof import('../lib/erp/client');
let captcha: typeof import('../lib/erp/autocaptcha');
let login: typeof import('../app/api/local/login/route');
let sync: typeof import('../app/api/local/sync/route');
let records: typeof import('../app/api/local/records/route');
let receipt: typeof import('../app/api/local/fee-receipt/route');
let booklet: typeof import('../app/api/local/booklet/route');
let circular: typeof import('../app/api/local/circular/route');

async function control(body: unknown) {
  const r = await fetch(`${MOCK}/__mock/control`, { method: 'POST', body: JSON.stringify(body) });
  return (await r.json()) as { counters: { logins: number; captchas: number } };
}
const counters = async () => (await control({})).counters;

const json = (body: unknown) =>
  new Request('http://localhost/attenly/api/local/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const form = (fields: Record<string, string>) =>
  new Request('http://localhost/attenly/api/local/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

/** One real sign-in through the route, as the form does it: a captcha read in-process, then the login. */
async function signIn(password = PASS) {
  const c = await captcha.fetchSolvedCaptcha();
  const res = await login.POST(json({ universityId: A, password, captchaText: c.solution, sessionToken: c.sessionToken }));
  return { res, d: (await res.json()) as { ok: boolean; code?: string; key?: string; snapshot?: ClientSnapshot; failed?: string[] } };
}

let key = '';
let erpToken = '';
let first: ClientSnapshot;

before(async () => {
  delete process.env.MONGODB_URI;
  process.env.ERP_BASE = MOCK;
  process.env.SESSION_SECRET = 'c'.repeat(64);
  mock = spawn(process.execPath, [join(root, 'tests/mock-erp/server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(mock.stdout!, 'data');
  local = await import('../lib/local');
  snap = await import('../lib/local-snapshot');
  erp = await import('../lib/erp/client');
  captcha = await import('../lib/erp/autocaptcha');
  login = await import('../app/api/local/login/route');
  sync = await import('../app/api/local/sync/route');
  records = await import('../app/api/local/records/route');
  receipt = await import('../app/api/local/fee-receipt/route');
  booklet = await import('../app/api/local/booklet/route');
  circular = await import('../app/api/local/circular/route');
});

after(() => {
  mock?.kill();
});

test('a sealed login opens only as a login: not a captcha token, not an ERP session, not tampered', () => {
  const sealed = local.sealLogin(A, PASS);
  assert.deepEqual(local.openLogin(sealed), { universityId: A, password: PASS });
  assert.ok(!sealed.includes(PASS), 'the password is not readable in the sealed login');
  const captchaToken = erp.sealSession({ jar: { a: 'b' }, csrf: 'x', exp: Date.now() + 60_000 });
  assert.equal(local.openLogin(captchaToken), null);
  assert.equal(local.openLogin(local.sealErp(A, { jar: { a: 'b' }, csrf: 'x', exp: 0 })), null);
  assert.equal(local.openLogin(sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA')), null);
  assert.equal(local.openLogin(undefined), null);
  assert.equal(local.openLogin({ u: A }), null);
});

test('a sealed ERP session belongs to one University ID and expires', () => {
  const s = local.sealErp(A, { jar: { PHPSESSID: 'abc' }, csrf: 'tok', exp: 0, termOptions: { years: [], semesters: [] } });
  const opened = local.openErp(s, A);
  assert.deepEqual(opened?.jar, { PHPSESSID: 'abc' });
  assert.equal(opened?.csrf, 'tok');
  assert.equal(local.openErp(s, '9900000002'), null, 'someone else’s session');
  assert.equal(local.openErp(local.sealLogin(A, PASS), A), null, 'a login is not a session');
  const old = erp.sealSession({ t: 'erp', u: A, jar: { PHPSESSID: 'abc' }, csrf: 'tok', exp: Date.now() - 1 });
  assert.equal(local.openErp(old, A), null, 'expired');
});

test('the request body reads as JSON or as a form, and anything else as empty', async () => {
  assert.deepEqual(await local.localBody(json({ a: '1' })), { a: '1' });
  assert.deepEqual(await local.localBody(form({ a: '1', b: '2' })), { a: '1', b: '2' });
  assert.deepEqual(await local.localBody(json([1, 2])), {});
  assert.deepEqual(await local.localBody(new Request('http://localhost/', { method: 'POST', body: 'x' })), {});
});

test('signing in returns the snapshot, the sealed login and the sealed ERP session, and stores nothing', async () => {
  const { res, d } = await signIn();
  assert.equal(res.status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.snapshot?.universityId, A);
  assert.equal(d.snapshot?.attendance.length, 6);
  assert.equal(d.snapshot?.cgpa, 8.5);
  assert.ok((d.snapshot?.classes.length ?? 0) > 0, 'registers pulled (History)');
  assert.deepEqual(d.snapshot?.term, { academicyear: '30', semesterid: '2', semester: 'Even Sem', yearLabel: '2026-2027' });
  assert.deepEqual(local.openLogin(d.key), { universityId: A, password: PASS });
  const header = res.headers.get(HEADER);
  assert.ok(header && local.openErp(header, A), 'a usable sealed ERP session');
  key = d.key!;
  erpToken = header!;
  first = d.snapshot!;
});

test('a wrong password is the ERP’s verdict; a misread captcha says so', async () => {
  const wrong = await signIn('nope');
  assert.equal(wrong.res.status, 401);
  assert.equal(wrong.d.code, 'bad_credentials');
  const c = await captcha.fetchSolvedCaptcha();
  const res = await login.POST(json({ universityId: A, password: PASS, captchaText: 'zzzzzz', sessionToken: c.sessionToken }));
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { code: string }).code, 'bad_captcha');
});

test('a sync reuses the sealed ERP session: no captcha, no login', async () => {
  const before = await counters();
  const res = await sync.POST(json({ key, erp: erpToken, reuse: { academicyear: first.term.academicyear, semesterid: first.term.semesterid } }));
  const d = (await res.json()) as { ok: boolean; code: string; snapshot: ClientSnapshot; failed: string[] };
  assert.equal(res.status, 200);
  assert.equal(d.code, 'synced');
  assert.equal(d.snapshot.attendance.length, 6);
  const after = await counters();
  assert.equal(after.logins, before.logins, 'no new login');
  assert.equal(after.captchas, before.captchas, 'no captcha read');
  assert.ok(res.headers.get(HEADER), 'the session is handed back');
});

test('without a session, or with one the ERP dropped, a sync logs in again reading the captcha itself', async () => {
  for (const stale of [null, local.sealErp(A, { jar: { PHPSESSID: 'gone' }, csrf: 'x', exp: 0 })]) {
    const before = await counters();
    const res = await sync.POST(json({ key, erp: stale }));
    assert.equal(res.status, 200, 'synced');
    const after = await counters();
    assert.equal(after.logins, before.logins + 1, 'one login');
    assert.ok(after.captchas > before.captchas, 'a captcha was read');
  }
});

test('a chosen semester is pulled instead of the newest', async () => {
  const res = await sync.POST(json({ key, erp: erpToken, term: { academicyear: '30', semesterid: '1' } }));
  const d = (await res.json()) as { snapshot: ClientSnapshot };
  assert.equal(d.snapshot.term.semesterid, '1');
  assert.equal(d.snapshot.term.semester, 'Odd Sem');
});

test('an unreadable login asks for the password again; a password changed on the ERP is reported', async () => {
  const bad = await sync.POST(json({ key: 'not-a-sealed-login', erp: erpToken }));
  assert.equal(bad.status, 401);
  assert.equal(((await bad.json()) as { code: string }).code, 'needs_password');
  await control({ password: { id: A, value: 'changed-pass' } });
  try {
    const res = await sync.POST(json({ key }));
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, 'bad_credentials');
  } finally {
    await control({ password: { id: A, value: PASS } });
  }
});

test('records, a fee receipt, a booklet scan and a circular are read for a sealed login', async () => {
  const marks = await records.POST(json({ key, erp: erpToken, set: 'marks' }));
  assert.equal(marks.status, 200);
  const m = (await marks.json()) as { ok: boolean; data: { courses: unknown[] } };
  assert.ok(m.ok && m.data.courses.length > 0);
  assert.equal((await records.POST(json({ key, erp: erpToken, set: 'everything' }))).status, 400);

  const order = first.feeOrders.find((o) => o.receiptHref)!;
  const r = await receipt.POST(json({ key, erp: erpToken, href: order.receiptHref }));
  assert.equal(r.status, 200);
  assert.ok(((await r.json()) as { receipt?: unknown }).receipt);
  const offErp = await receipt.POST(json({ key, erp: erpToken, href: 'https://evil.example/index.php?r=feepayments%2Ffee_receipt' }));
  assert.equal(offErp.status, 400, 'a link off the ERP is refused');

  const papers = (await (await records.POST(json({ key, erp: erpToken, set: 'papers' }))).json()) as {
    data: { papers: { courseCode: string; exam: string; academicYear: string; semester: string; hasScan: boolean }[] };
  };
  const p = papers.data.papers.find((x) => x.hasScan)!;
  const scan = await booklet.POST(form({ key, erp: erpToken, code: p.courseCode, exam: p.exam, ay: p.academicYear, sem: p.semester }));
  assert.equal(scan.status, 200);
  assert.equal(scan.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await scan.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

  const circs = (await (await records.POST(json({ key, erp: erpToken, set: 'circulars' }))).json()) as {
    data: { circulars: { id: string; hasDocument: boolean }[] };
  };
  const c = circs.data.circulars.find((x) => x.hasDocument)!;
  const doc = await circular.POST(form({ key, erp: erpToken, id: c.id }));
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-type'), 'application/pdf');

  const noLogin = await booklet.POST(form({ key: 'x', code: p.courseCode, exam: p.exam, ay: p.academicYear, sem: p.semester }));
  assert.equal(noLogin.status, 401);
});

test('a failed dataset keeps the previous copy for the same term, never for another', () => {
  const next: ClientSnapshot = { ...first, syncedAt: new Date(Date.now() + 60_000).toISOString(), attendance: [], timetable: [], attendanceSyncedAt: null };
  const kept = snap.keepFailed(first, next, ['attendance']);
  assert.equal(kept.attendance, first.attendance, 'attendance kept');
  assert.equal(kept.attendanceSyncedAt, first.attendanceSyncedAt, 'dated by the sync that read it');
  assert.equal(kept.timetable.length, 0, 'a dataset that did not fail is taken as pulled');
  assert.equal(kept.syncedAt, next.syncedAt);
  const otherTerm = { ...next, term: { ...next.term, semesterid: '1' } };
  assert.equal(snap.keepFailed(first, otherTerm, ['attendance']).attendance.length, 0, 'another term starts clean');
  assert.equal(snap.keepFailed(null, next, ['attendance']), next);
});

test('CGPA and fee orders belong to the account: a failed read keeps them across a term change', () => {
  assert.ok(first.cgpaRows.length > 0 && first.feeOrders.length > 0, 'the fixture has both');
  const otherTerm: ClientSnapshot = { ...first, term: { ...first.term, semesterid: '1' }, cgpaRows: [], cgpa: null, sgpaTerms: [], feeOrders: [], attendance: [] };
  const kept = snap.keepFailed(first, otherTerm, ['cgpa', 'fees']);
  assert.equal(kept.cgpaRows, first.cgpaRows);
  assert.equal(kept.cgpa, first.cgpa);
  assert.equal(kept.feeOrders, first.feeOrders);
  assert.equal(kept.attendance.length, 0, 'term data still starts clean');
  assert.equal(snap.keepFailed(first, otherTerm, []).feeOrders.length, 0, 'what was read is taken as read');
});
