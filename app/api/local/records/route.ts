import { readRecord, RECORD_SETS, type RecordSet } from '@/lib/erp/records';
import { localBody, localFailure, localJson, withLocalErp } from '@/lib/local';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ID = /^\d{1,4}$/;

/**
 * POST /api/local/records
 * Body: { key, erp?, set: marks|papers|profile|fees|circulars|courses, ay?, sem? }
 *
 * One screen's ERP data for a browser signed in without Google, read from the ERP
 * every time it is asked. Nothing is cached here: the browser keeps its own copy and
 * only asks again once that copy is old (components/records.tsx).
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  const set = body.set as RecordSet;
  if (!RECORD_SETS.includes(set)) return Response.json({ ok: false, error: 'Unknown set.' }, { status: 400 });
  const ay = typeof body.ay === 'string' && body.ay ? body.ay : undefined;
  const sem = typeof body.sem === 'string' && body.sem ? body.sem : undefined;
  if ((ay && !ID.test(ay)) || (sem && !ID.test(sem))) return Response.json({ ok: false, error: 'Bad term.' }, { status: 400 });

  try {
    const { value, erp } = await withLocalErp(body, (s) => readRecord(s, set, { ay, sem }));
    return localJson({ ok: true, data: value, fetchedAt: new Date().toISOString() }, erp);
  } catch (e) {
    console.error('[api/local/records]', set, e instanceof Error ? e.message : e);
    return localFailure(e, 'The ERP didn’t answer. Try again in a moment.');
  }
}
