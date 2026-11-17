import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';

export const dynamic = 'force-dynamic';

const SOLVER_FILES = [
  path.join(process.cwd(), 'lib', 'erp', 'model', 'crnn.onnx'),
  path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm'),
];

/**
 * GET /api/health — is this deployment wired up? Reports whether MongoDB
 * answers (and how many Google users have an ERP account linked) and whether
 * the built-in captcha reader's files shipped. Never returns anyone's data.
 */
export async function GET() {
  const started = Date.now();
  let db: 'ok' | 'unreachable' | 'not_configured' = 'ok';
  let linkedUsers: number | null = null;
  try {
    const d = await getDb();
    await d.command({ ping: 1 });
    linkedUsers = await d
      .collection('users')
      .countDocuments({ $or: [{ 'accounts.0': { $exists: true } }, { erpUid: { $exists: true } }, { universityId: { $exists: true } }] });
  } catch (e) {
    db = isMongoMisconfigured(e) ? 'not_configured' : 'unreachable';
    console.error('[api/health] db', e instanceof Error ? e.message : e);
  }
  return Response.json(
    // The captcha reader is built in (lib/erp/solve.ts): this says its model and WASM runtime shipped.
    { ok: db === 'ok', db, linkedUsers, solver: SOLVER_FILES.every((f) => existsSync(f)), ms: Date.now() - started },
    { status: db === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
