import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';
import { upsertUserCreds } from '@/lib/db/users';
import { sealSession } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';

/**
 * Snapshot document shape. Credentials are stored ONLY as an AES-256-GCM
 * encrypted blob (`creds`) sealed with the server's SESSION_SECRET — never
 * plaintext. The blob never leaves the server (GET responses exclude it);
 * it exists solely so the server can re-authenticate for one-tap re-link.
 */
export interface SnapshotDoc {
  universityId: string;
  term: { academicyear: string; semesterid: string; semester: string };
  termKey: string;
  syncedAt: Date;
  attendance: unknown[];
  timetable: unknown[];
  creds?: string;
}

/** Field names that must never be persisted, matched case-insensitively. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'pass',
  'credential',
  'credentials',
  'secret',
  'secrets',
  'sessiontoken',
  'authtoken',
  'accesstoken',
  'refreshtoken',
]);

/**
 * Deep-clones `value` while dropping any forbidden credential-ish keys.
 * Returns the cleaned value and whether anything was stripped.
 */
function stripCredentials(value: unknown): { cleaned: unknown; stripped: boolean } {
  let stripped = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
          stripped = true;
          continue;
        }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return { cleaned: walk(value), stripped };
}

export function termKey(term: { academicyear?: string; semesterid?: string; semester?: string }): string {
  return [term.academicyear ?? '', term.semesterid ?? '', term.semester ?? ''].join('::');
}

/**
 * POST /api/snapshots
 * Body: { universityId, term: { academicyear, semesterid, semester }, attendance, timetable, password? }
 * Upserts into `snapshots` keyed by { universityId, termKey }. When `password`
 * is supplied it is sealed (AES-256-GCM, SESSION_SECRET) into `creds` — the
 * plaintext never touches the database.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Pull the password out before the credential-stripper runs, then seal it.
  // Anything else credential-shaped is still dropped loudly below.
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const rawPassword = typeof rawObj.password === 'string' ? rawObj.password : '';
  delete rawObj.password;
  let creds: string | undefined;
  if (rawPassword) {
    try {
      creds = sealSession({ pw: rawPassword });
    } catch {
      return Response.json({ error: 'Could not secure the credentials.' }, { status: 500 });
    }
  }

  const { cleaned, stripped } = stripCredentials(rawObj);
  if (stripped) {
    // Defense in depth: the client never sends credentials, but if one ever
    // arrives, drop it loudly rather than persisting it.
    console.warn('[api/snapshots] Stripped credential field(s) from request body — passwords are never stored.');
  }
  const body = (cleaned ?? {}) as Record<string, unknown>;

  const universityId = typeof body.universityId === 'string' ? body.universityId.trim() : '';
  const term = (body.term ?? {}) as Record<string, unknown>;
  const academicyear = typeof term.academicyear === 'string' ? term.academicyear : '';
  const semesterid = typeof term.semesterid === 'string' ? term.semesterid : '';
  const semester = typeof term.semester === 'string' ? term.semester : '';
  if (!universityId || !academicyear) {
    return Response.json(
      { error: 'universityId and term.academicyear are required.' },
      { status: 400 },
    );
  }

  const doc: SnapshotDoc = {
    universityId,
    term: { academicyear, semesterid, semester },
    termKey: termKey({ academicyear, semesterid, semester }),
    syncedAt: new Date(),
    attendance: Array.isArray(body.attendance) ? body.attendance : [],
    timetable: Array.isArray(body.timetable) ? body.timetable : [],
    ...(creds ? { creds } : {}),
  };

  try {
    const db = await getDb();
    await db
      .collection<SnapshotDoc>('snapshots')
      .updateOne(
        { universityId: doc.universityId, termKey: doc.termKey },
        { $set: doc },
        { upsert: true },
      );
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json(
        { error: 'MongoDB is not configured. Set MONGODB_URI to enable snapshots.', code: 'mongo_not_configured' },
        { status: 503 },
      );
    }
    console.error('[api/snapshots] POST failed:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not save the snapshot.' }, { status: 502 });
  }

  // If the user is signed in with Google and we sealed fresh credentials,
  // remember them against the Google account for one-tap re-link.
  if (creds) {
    try {
      const gsession = await getServerSession(authOptions);
      const googleId = (gsession?.user as { id?: string } | undefined)?.id;
      if (googleId) {
        await upsertUserCreds({
          googleId,
          email: gsession?.user?.email ?? '',
          name: gsession?.user?.name ?? undefined,
          universityId,
          creds,
        });
      }
    } catch (e) {
      // Non-fatal: the snapshot itself is saved; the Google link just didn't stick.
      console.warn('[api/snapshots] user link skipped:', e instanceof Error ? e.message : e);
    }
  }

  return Response.json({ ok: true, savedAt: doc.syncedAt.toISOString() });
}

/**
 * GET /api/snapshots?universityId=&termKey=
 * Returns the latest snapshot for the student (optionally for one term).
 * Handy for reloading last-synced data and for demo resilience.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const universityId = (sp.get('universityId') ?? '').trim();
  const tk = (sp.get('termKey') ?? '').trim();
  if (!universityId) {
    return Response.json({ error: 'universityId is required.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const filter: Record<string, string> = tk ? { universityId, termKey: tk } : { universityId };
    const snapshot = await db
      .collection<SnapshotDoc>('snapshots')
      .find(filter, { projection: { creds: 0 } })
      .sort({ syncedAt: -1 })
      .limit(1)
      .next();
    if (!snapshot) {
      return Response.json({ error: 'No snapshot found.', code: 'not_found' }, { status: 404 });
    }
    return Response.json({ snapshot });
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json(
        { error: 'MongoDB is not configured. Set MONGODB_URI to enable snapshots.', code: 'mongo_not_configured' },
        { status: 503 },
      );
    }
    console.error('[api/snapshots] GET failed:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not load the snapshot.' }, { status: 502 });
  }
}
