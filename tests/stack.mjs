/**
 * Local test stack: in-memory MongoDB + mock ERP/solver + Next.js, wired
 * together with throwaway secrets. Nothing here touches production.
 *
 *   node tests/stack.mjs [--prod]     (--prod serves `next build` output)
 *
 * Prints READY with the URLs, and writes tests/.stack.json for the browser
 * tests (app URL, mock URL, session cookies for two synthetic Google users).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { encode } from 'next-auth/jwt';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');
const APP_PORT = Number(process.env.APP_PORT ?? 3100);
const MOCK_PORT = Number(process.env.MOCK_ERP_PORT ?? 4100);

process.env.MONGOMS_VERSION ??= '7.0.24';
const mongo = await MongoMemoryServer.create();
const mongoUri = mongo.getUri();

const mock = spawn(process.execPath, [join(root, 'tests/mock-erp/server.mjs'), String(MOCK_PORT)], { stdio: 'inherit' });

const secrets = {
  NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
};
const env = {
  ...process.env,
  ...secrets,
  MONGODB_URI: mongoUri,
  ERP_BASE: `http://localhost:${MOCK_PORT}`,
  SOLVER_URL: `http://localhost:${MOCK_PORT}`,
  NEXTAUTH_URL: `http://localhost:${APP_PORT}/attenly/api/auth`,
  GOOGLE_CLIENT_ID: 'local-test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'local-test-secret',
  CRON_SECRET: randomBytes(16).toString('hex'),
  NEXT_TELEMETRY_DISABLED: '1',
};

const nextBin = join(root, 'node_modules/next/dist/bin/next');
const app = spawn(process.execPath, [nextBin, prod ? 'start' : 'dev', '-p', String(APP_PORT)], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
});

async function session(sub, name, email) {
  return encode({ token: { sub, name, email, picture: null }, secret: secrets.NEXTAUTH_SECRET });
}

const state = {
  app: `http://localhost:${APP_PORT}/attenly`,
  mock: `http://localhost:${MOCK_PORT}`,
  mongoUri,
  cronSecret: env.CRON_SECRET,
  sessionSecret: secrets.SESSION_SECRET,
  cookieName: 'next-auth.session-token',
  users: {
    main: { sub: 'google-test-1', cookie: await session('google-test-1', 'Test Student', 'student@example.com') },
    fresh: { sub: 'google-test-2', cookie: await session('google-test-2', 'New Student', 'new@example.com') },
  },
};
writeFileSync(join(root, 'tests/.stack.json'), JSON.stringify(state, null, 2));

let ready = false;
app.stdout.on('data', (b) => {
  const s = b.toString();
  process.stdout.write(s);
  if (!ready && /Ready in|✓ Ready|started server/i.test(s)) {
    ready = true;
    console.log(`READY app=${state.app} mock=${state.mock}`);
  }
});

const stop = async () => {
  app.kill();
  mock.kill();
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', (code) => {
  console.log(`next exited ${code}`);
  void stop();
});
