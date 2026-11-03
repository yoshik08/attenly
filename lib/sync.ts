import { findAccount, recordSync, resolvePassword, type UserDoc } from './db/users';
import { getLatestSnapshot, saveFullSnapshot, toClientSnapshot, type ClientSnapshot } from './db/snapshots';
import { withLock } from './db/locks';
import { autoLogin, coded, pullAll, ErpRateLimited, isSessionExpiredError } from './erp/full-sync';
import { termFromIds } from './terms';

/** Cloud data younger than this is served as-is; older data triggers a sync (~5.5 min). */
export const FRESH_MS = 330_000;
/** A crashed sync releases its lock after this long. */
const LOCK_MS = 150_000;

export type SyncCode =
  | 'synced'
  | 'fresh'
  | 'busy'
  | 'needs_password'
  | 'bad_credentials'
  | 'bad_captcha'
  | 'rate_limited'
  | 'solver_unavailable'
  | 'erp_unreachable'
  | 'no_account'
  | 'failed';

export interface SyncResult {
  ok: boolean;
  code: SyncCode;
  message?: string;
  snapshot: ClientSnapshot | null;
}

const MESSAGES: Record<Exclude<SyncCode, 'synced' | 'fresh'>, string> = {
  busy: 'A sync for this account is already running.',
  needs_password: 'Enter your ERP password once to resume syncing.',
  bad_credentials: 'The ERP rejected the saved password. Enter your current ERP password.',
  bad_captcha: 'The captcha solver misread the ERP captcha. Try again in a moment.',
  rate_limited: 'The ERP is rate-limiting logins. Try again in a minute.',
  solver_unavailable: 'The captcha solver did not answer. Try again in a moment.',
  erp_unreachable: 'Attenly could not reach the ERP. Try again in a moment.',
  no_account: 'No ERP account is linked yet.',
  failed: 'The sync stopped partway. Try again in a moment.',
};

function classify(e: unknown): Exclude<SyncCode, 'synced' | 'fresh' | 'busy' | 'no_account'> {
  if (e instanceof ErpRateLimited) return 'rate_limited';
  const code = (e as { code?: string })?.code;
  if (code === 'bad_credentials') return 'bad_credentials';
  if (code === 'bad_captcha') return 'bad_captcha';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'no_solver' || code === 'solve_failed') return 'solver_unavailable';
  if (code === 'erp_unreachable') return 'erp_unreachable';
  if (isSessionExpiredError(e)) return 'failed';
  // fetch() network failures surface as TypeError("fetch failed") or AbortError.
  if (e instanceof TypeError || (e as { name?: string })?.name === 'AbortError' || (e as { name?: string })?.name === 'TimeoutError') {
    return 'erp_unreachable';
  }
  return 'failed';
}

/**
 * Sync one ERP account of a Google user.
 *  - not forced and the latest snapshot is fresh → returned as-is, no ERP traffic
 *  - the saved password is missing or was rejected → stops until it is re-entered
 *  - a legacy sealed password this server can open is converted to plaintext
 */
export async function syncAccount(opts: {
  user: UserDoc;
  universityId?: string | null;
  force?: boolean;
}): Promise<SyncResult> {
  const { user } = opts;
  const account = findAccount(user, opts.universityId);
  if (!account) return { ok: false, code: 'no_account', message: MESSAGES.no_account, snapshot: null };
  const { universityId } = account;

  const previous = await getLatestSnapshot(user.googleId, universityId);
  const prevView = previous ? toClientSnapshot(previous) : null;
  if (!opts.force && previous && Date.now() - new Date(previous.syncedAt).getTime() < FRESH_MS) {
    return { ok: true, code: 'fresh', snapshot: prevView };
  }

  if (account.needsPassword) {
    return { ok: false, code: 'needs_password', message: account.lastError?.message ?? MESSAGES.needs_password, snapshot: prevView };
  }
  const creds = resolvePassword(account);
  if (!creds) {
    const message = account.creds
      ? 'Your ERP password was saved by an older version of Attenly and can’t be read here. Enter it once.'
      : MESSAGES.needs_password;
    await recordSync(user.googleId, universityId, { ok: false, code: 'needs_password', message, needsPassword: true });
    return { ok: false, code: 'needs_password', message, snapshot: prevView };
  }

  try {
    const run = await withLock(`sync:${universityId}`, LOCK_MS, async () => {
      const session = await autoLogin(universityId, creds.password);
      // The term the person picked in Settings, else the newest with courses.
      const data = await pullAll(session, account.term ? termFromIds(account.term, session.termOptions) : undefined);
      if (data.failed.length === 5) throw coded(MESSAGES.erp_unreachable, 'erp_unreachable');
      const saved = await saveFullSnapshot({
        universityId,
        googleId: user.googleId,
        data,
        previous,
        termOptions: session.termOptions,
      });
      await recordSync(user.googleId, universityId, {
        ok: true,
        ...(creds.migrated ? { plainPassword: creds.password } : {}),
      });
      return saved;
    });
    if (!run.acquired) return { ok: false, code: 'busy', message: MESSAGES.busy, snapshot: prevView };
    return { ok: true, code: 'synced', snapshot: toClientSnapshot(run.value) };
  } catch (e) {
    const code = classify(e);
    const message = MESSAGES[code];
    console.error(`[sync] …${universityId.slice(-3)} ${code}:`, e instanceof Error ? e.message : e);
    await recordSync(user.googleId, universityId, {
      ok: false,
      code,
      message,
      needsPassword: code === 'bad_credentials',
    }).catch(() => undefined);
    return { ok: false, code, message, snapshot: prevView };
  }
}
