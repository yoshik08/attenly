/**
 * Sync integration: the real sync code against the mock ERP + solver and an
 * in-memory MongoDB. No network beyond localhost.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const MOCK = `http://localhost:${PORT}`;

let mongo: MongoMemoryServer;
let mock: ChildProcess;
let client: MongoClient;
let db: Db;
let users: typeof import('../lib/db/users');
let snapshots: typeof import('../lib/db/snapshots');
let sync: typeof import('../lib/sync');
let erp: typeof import('../lib/erp/client');
let cron: typeof import('../app/api/cron/sync/route');

const G = 'google-sync-test';
const A = '9900000001';
const B = '9900000002';

async function control(body: unknown) {
  const r = await fetch(`${MOCK}/__mock/control`, { method: 'POST', body: JSON.stringify(body) });
  return (await r.json()) as { counters: { logins: number; captchas: number; solves: number } };
}
const counters = async () => (await control({})).counters;
async function resetKnobs() {
  await control({ knobs: { solverWrong: 0, solverDown: false, rateLimitLogins: false, failDatasets: [], loginDelayMs: 0 } });
}
const userDoc = () => db.collection('users').findOne({ googleId: G });
const latest = (id: string) => snapshots.getLatestSnapshot(G, id);

before(async () => {
  process.env.MONGOMS_VERSION ??= '7.0.24';
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.ERP_BASE = MOCK;
  process.env.SOLVER_URL = MOCK;
  process.env.SESSION_SECRET = 'b'.repeat(64);
  process.env.CRON_SECRET = 'cron-test-secret';
  mock = spawn(process.execPath, [join(root, 'tests/mock-erp/server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(mock.stdout!, 'data');
  users = await import('../lib/db/users');
  snapshots = await import('../lib/db/snapshots');
  sync = await import('../lib/sync');
  erp = await import('../lib/erp/client');
  cron = await import('../app/api/cron/sync/route');
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('skipwise');
});

after(async () => {
  await client?.close();
  const g = globalThis as { __attenlyMongo?: Promise<MongoClient> };
  await (await g.__attenlyMongo)?.close();
  mock?.kill();
  await mongo?.stop();
});

test('linking stores the password as typed, mirrored as erpUid / erpPass', async () => {
  await users.linkAccount({ googleId: G, email: 's@example.com', name: 'S', universityId: A, password: 'kl-test-pass' });
  const u = await userDoc();
  assert.equal(u?.erpUid, A);
  assert.equal(u?.erpPass, 'kl-test-pass');
  assert.equal(u?.accounts[0].erpPass, 'kl-test-pass');
  assert.equal(u?.creds, undefined);
});

test('sync pulls everything; a second auto sync inside 5.5 minutes stays off the ERP', async () => {
  const user = (await users.getUser(G))!;
  const first = await sync.syncAccount({ user, universityId: A, force: true });
  assert.equal(first.code, 'synced');
  assert.equal(first.snapshot?.attendance.length, 6);
  assert.equal(first.snapshot?.timetable.length, 6);
  assert.equal(first.snapshot?.cgpa, 8.5);
  const logins = (await counters()).logins;
  const second = await sync.syncAccount({ user, universityId: A, force: false });
  assert.equal(second.code, 'fresh');
  assert.equal((await counters()).logins, logins);
  assert.equal(await db.collection('locks').countDocuments(), 0, 'lock released');
});

test('a legacy sealed password this server can open is converted to plaintext', async () => {
  const sealed = erp.sealSession({ pw: 'kl-test-pass' });
  await db.collection('users').updateOne(
    { googleId: G },
    { $set: { creds: sealed, 'accounts.0.creds': sealed }, $unset: { erpPass: '', 'accounts.0.erpPass': '' } },
  );
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(r.code, 'synced');
  const u = await userDoc();
  assert.equal(u?.erpPass, 'kl-test-pass');
  assert.equal(u?.accounts[0].erpPass, 'kl-test-pass');
  assert.equal(u?.creds, undefined);
  assert.equal(u?.accounts[0].creds, undefined);
});

test('a sealed password from another server pauses the account without touching the ERP', async () => {
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'c'.repeat(64);
  const foreign = erp.sealSession({ pw: 'kl-test-pass' });
  process.env.SESSION_SECRET = saved;
  await db.collection('users').updateOne(
    { googleId: G },
    { $set: { 'accounts.0.creds': foreign, creds: foreign }, $unset: { erpPass: '', 'accounts.0.erpPass': '' } },
  );
  const before = (await counters()).logins;
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(r.code, 'needs_password');
  assert.ok(r.snapshot, 'still returns the last good data');
  assert.equal((await counters()).logins, before);
  const view = users.viewAccounts((await users.getUser(G))!)[0];
  assert.equal(view.needsPassword, true);
  // Re-entering the password (the link flow) resumes syncing.
  await users.linkAccount({ googleId: G, email: 's@example.com', universityId: A, password: 'kl-test-pass' });
  assert.equal(users.viewAccounts((await users.getUser(G))!)[0].needsPassword, false);
});

test('a password the ERP rejects pauses the account; the backend sync then leaves it alone', async () => {
  await control({ password: { id: A, value: 'changed-on-erp' } });
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(r.code, 'bad_credentials');
  assert.equal(users.viewAccounts((await users.getUser(G))!)[0].needsPassword, true);
  const loginsBefore = (await counters()).logins;
  await db.collection('snapshots').updateMany({}, { $set: { syncedAt: new Date(Date.now() - 3_600_000) } });
  const res = await cron.POST(new Request('http://x/api/cron/sync', { method: 'POST', headers: { Authorization: 'Bearer cron-test-secret' } }));
  const body = (await res.json()) as { results: { account: string; code: string }[] };
  assert.deepEqual(body.results, [{ account: '…001', code: 'needs_password' }]);
  assert.equal((await counters()).logins, loginsBefore, 'no login attempt with a known-bad password');
  await control({ password: { id: A, value: 'kl-test-pass' } });
  await users.linkAccount({ googleId: G, email: 's@example.com', universityId: A, password: 'kl-test-pass' });
});

test('captcha misreads are retried; three in a row is a captcha failure, not a password problem', async () => {
  await control({ knobs: { solverWrong: 2 } });
  const ok = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(ok.code, 'synced');
  await control({ knobs: { solverWrong: 3 } });
  const bad = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(bad.code, 'bad_captcha');
  assert.equal(users.viewAccounts((await users.getUser(G))!)[0].needsPassword, false);
  await resetKnobs();
});

test('one failing ERP page keeps the previous data for it', async () => {
  const prev = await latest(A);
  await control({ knobs: { failDatasets: ['timetable'] } });
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(r.code, 'synced');
  assert.equal(r.snapshot?.timetable.length, prev?.timetable.length);
  assert.ok((r.snapshot?.timetable.length ?? 0) > 0);
  await control({ knobs: { failDatasets: ['attendance', 'timetable', 'internals', 'results', 'cgpa'] } });
  const all = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(all.code, 'erp_unreachable');
  assert.equal(all.snapshot?.attendance.length, 6, 'last good data still served');
  await resetKnobs();
});

test('two syncs of one account at once: the second waits its turn', async () => {
  await control({ knobs: { loginDelayMs: 400 } });
  const user = (await users.getUser(G))!;
  const [a, b] = await Promise.all([
    sync.syncAccount({ user, universityId: A, force: true }),
    sync.syncAccount({ user, universityId: A, force: true }),
  ]);
  assert.deepEqual([a.code, b.code].sort(), ['busy', 'synced']);
  await resetKnobs();
});

test('a rate-limited ERP is reported and backed off', async () => {
  await control({ knobs: { rateLimitLogins: true } });
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: A, force: true });
  assert.equal(r.code, 'rate_limited');
  await resetKnobs();
});

test('multiple accounts: each syncs; removing one deletes its password and data', async () => {
  await users.linkAccount({ googleId: G, email: 's@example.com', universityId: B, password: 'other-pass-2' });
  const r = await sync.syncAccount({ user: (await users.getUser(G))!, universityId: B, force: true });
  assert.equal(r.code, 'synced');
  assert.equal(r.snapshot?.attendance.length, 2);
  assert.equal((await userDoc())?.erpUid, A, 'first account stays primary');
  assert.equal(await users.makePrimary(G, B), true);
  assert.equal((await userDoc())?.erpUid, B);
  assert.equal(await users.removeAccount(G, B), true);
  await snapshots.deleteSnapshots(G, B);
  const u = await userDoc();
  assert.equal(u?.erpUid, A);
  assert.equal(u?.erpPass, 'kl-test-pass');
  assert.equal(u?.accounts.length, 1);
  assert.equal(await latest(B), null);
});

test('backend sync: unauthorized callers are refused; results mask account ids', async () => {
  const no = await cron.POST(new Request('http://x/api/cron/sync', { method: 'POST' }));
  assert.equal(no.status, 401);
  await db.collection('snapshots').updateMany({}, { $set: { syncedAt: new Date(Date.now() - 3_600_000) } });
  const res = await cron.POST(new Request('http://x/api/cron/sync', { method: 'POST', headers: { Authorization: 'Bearer cron-test-secret' } }));
  const body = (await res.json()) as { synced: number; results: { account: string; code: string }[] };
  assert.equal(body.synced, 1);
  assert.deepEqual(body.results, [{ account: '…001', code: 'synced' }]);
  assert.ok(!JSON.stringify(body).includes(A));
});
