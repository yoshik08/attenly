# Skipwise

An unofficial KL University attendance planner — **attendance only**.
Sync your timetable and attendance from the university ERP (`newerp.kluniversity.in`)
and see what every class is worth before you skip it.

> Unofficial student project, not affiliated with KL University.
> Attendance numbers are estimates — always verify against the official ERP.

## Features

- **Plan** — weekly timetable grid (Mon–Sat) with per-class impact badges
  (`+X%` = what attending this class adds to the subject's weighted %),
  current-vs-projected percentage with policy-band labels, per-subject cards
  with "Can skip N classes" guidance and LTPS breakdowns.
- **History** — term totals, attendance streaks, this-week progress,
  month calendar with per-day status, manual per-class tracking,
  by-subject table with trend sparklines, by-week table.
- **Sync** — ERP login (ID + password + the ERP's own captcha, passed straight
  through), term picker, and a sample-data mode that works without login.
- **Settings** — editable "Safe at" / "Condonation from" lines, LTPS weights,
  light/dark/system theme, clear-data and ERP logout.

## Attendance math

- Weighted % per subject = Σ(attended × weight) / Σ(conducted × weight)
  over Lecture / Tutorial / Practical / Skilling (default weights 100/25/50/25).
- Per-class impact = recompute the % as if this one class were attended (+X%)
  or missed (−X%).
- "Can skip N" = max additional misses before the weighted % drops below the
  "Safe at" line (and, separately, below the condonation line).
- Policy bands: ≥ Safe at → Safe; ≥ Condonation from → Condonation zone;
  below → condonation needed.

## Why a backend proxy

The ERP sends no CORS headers and its captcha/session cookies must be managed
server-side, so all ERP traffic goes through Next.js API routes
(`app/api/erp/*`). The browser never talks to the ERP directly. See
[ERP_PROTOCOL.md](ERP_PROTOCOL.md) for the exact protocol.

## Run locally

```bash
npm install
cp .env.example .env   # optional; set SESSION_SECRET for persistent sessions
npm run dev             # http://localhost:3000
```

Generate a session secret with `openssl rand -hex 32`. Without one, the dev
server uses an ephemeral key (sessions won't survive restarts).

## Expo demo (MongoDB snapshots)

Show the judges that synced ERP data lands in MongoDB:

```bash
# 1. Start Mongo (or use a free MongoDB Atlas cluster)
docker run -d -p 27017:27017 --name mongo mongo

# 2. Point the app at it
cp .env.example .env   # MONGODB_URI is already set to mongodb://localhost:27017/skipwise

# 3. Run the app and sync
npm run dev            # http://localhost:3000/sync — log in, pick a term, "Fetch my data"
```

After fetching, the sync page shows **"Saved to MongoDB ✓ \<time\>"**.
Then open **MongoDB Compass** → connect to `mongodb://localhost:27017` →
database `skipwise` → collection `snapshots` — the document is there, keyed by
`{ universityId, termKey }`, holding `term`, `syncedAt`, `attendance`, and
`timetable`.

Demo talking point: *"The password is used once for the ERP login request and
never stored — only the attendance and timetable data is persisted. The API
even strips any credential field defensively before writing."*

If MongoDB isn't reachable, the snapshot is skipped gracefully and the app
keeps working with in-browser data.

## Tests

```bash
npm test   # parser + math unit tests (tsx --test)
```

## Deploy to Vercel

1. Push this directory to a Git repo.
2. Import it in Vercel (Framework Preset: Next.js).
3. Set environment variable `SESSION_SECRET` (32 bytes, hex or base64) —
   required so login sessions survive across serverless invocations.
4. (Optional, for MongoDB snapshots) set `MONGODB_URI` to a MongoDB Atlas
   connection string — without it, snapshots are skipped gracefully.
5. Deploy. No other config needed (standard API routes, no custom server).

## Privacy

- Your ERP password is used only for the login request — never stored, never logged.
- The ERP session lives in an httpOnly, AES-256-GCM-encrypted cookie.
- Synced attendance/timetable data is kept in the browser's localStorage, and —
  when `MONGODB_URI` is set — a copy is saved to the `snapshots` collection
  (attendance + timetable only; the API strips any credential field defensively
  before writing, so no password can ever land in MongoDB).

