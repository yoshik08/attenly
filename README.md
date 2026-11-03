# Attenly

Your KL University attendance without the ERP. Attenly signs into `newerp.kluniversity.in` for you (the captcha is
read by a CRNN model), keeps attendance, timetable and CGPA synced, and shows how many classes of each type you can
still skip before 85% (or must attend to get back above it).

> Unofficial student project, not affiliated with KL University.

Live at [yoshik.xyz/attenly](https://yoshik.xyz/attenly) (canonical) and [attenly-pi.vercel.app](https://attenly-pi.vercel.app).

## How it works

- **Sign-in:** Google (NextAuth v4). Google only returns to `NEXTAUTH_URL` (yoshik.xyz), so sign-in started on another
  host hops there first.
- **ERP accounts:** linked once per Google user (several allowed). University ID and password are stored as typed —
  `erpUid` / `erpPass` for the primary account and `accounts[].erpPass` for each — in MongoDB `skipwise.users`.
- **Sync:** one routine (`lib/sync.ts`) behind the sync button, the app's own refresh (whenever the cloud copy is older
  than ~5.5 minutes and the app is open) and the GitHub Actions job. A rejected password pauses that account instead of
  retrying; a misread captcha is retried with a fresh one; a failing ERP page keeps the previous data.
- **Maths:** weighted LTPS (lecture 100, tutorial 100, practical 50, skilling 25), rounded up like the ERP; 85% cruise
  line, 75% floor. Every "spare" or "attend N" figure is derived from the same rounded number the app shows.

## Env

See `.env.example`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server (needs a real `.env.local`) |
| `npm run stack` | Local stack with no real secrets: in-memory MongoDB, mock ERP + solver, Next dev on :3100 |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm test` | Parser, maths, insight and sync-integration tests |
| `npm run test:e2e` | Browser tests of every screen (headless Chromium, its own stack; `E2E_PROD=1` after `next build`) |
