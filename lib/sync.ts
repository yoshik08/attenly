import { findAccount, recordSync, resolvePassword, type UserDoc } from './db/users';
import { getLatestSnapshot, saveFullSnapshot, toClientSnapshot, type ClientSnapshot, type SnapshotDoc } from './db/snapshots';
import { withLock } from './db/locks';
import { clearErpSession, loadErpSession, saveErpSession } from './db/erp-session';
import { autoLogin, coded, pullAll, isSessionExpiredError, type AuthedSession } from './erp/full-sync';
import { classifySyncError, CORE_DATASETS, SYNC_MESSAGES, type SyncCode } from './sync-codes';
import { termFromIds, termIsRunning, type Term } from './terms';

/** Cloud data younger than this is served as-is; older data triggers a sync (3 min). */
export const FRESH_MS = 180_000;
/** A crashed sync releases its lock after this long. */
const LOCK_MS = 150_000;
/**
 * The manual sync button promises an answer within five seconds. Everything it
 * asks the ERP runs against this budget; past it the sync stops and says why
 * instead of leaving the button spinning.
 */
export const MANUAL_BUDGET_MS = 4_500;
/** The app's background refresh logs in again once the saved session's login is this old. */
const REFRESH_LOGIN_MS = 30 * 60_000;

export type { SyncCode } from './sync-codes';

export interface SyncResult {
  ok: boolean;
  code: SyncCode;
  message?: string;
  snapshot: ClientSnapshot | null;
}

const MESSAGES = SYNC_MESSAGES;
const classify = classifySyncError;

/** Resolve `p`, or give up at `at` with a coded, readable timeout. */
function withDeadline<T>(p: Promise<T>, at: number): Promise<T> {
  const ms = Math.max(1, at - Date.now());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(coded('The ERP took longer than five seconds.', 'erp_slow')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * The term shown now, when it had courses: pulled straight away while only the terms
 * newer than it are checked alongside (lib/erp/full-sync.ts pullAll `hint`).
 */
function termHint(previous: SnapshotDoc | null): Term | undefined {
  if (!previous || (previous.attendance?.length ?? 0) === 0 || !previous.term) return undefined;
  return previous.term;
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
  /** The sync button: reuses the saved ERP session and answers within MANUAL_BUDGET_MS. */
  manual?: boolean;
  /**
   * Reuse the saved ERP session (the app's own background refresh). Only the backend
   * job logs in every time: that is what notices a password changed on the ERP.
   */
  reuseSession?: boolean;
}): Promise<SyncResult> {
  const { user } = opts;
  const account = findAccount(user, opts.universityId);
  if (!account) return { ok: false, code: 'no_account', message: MESSAGES.no_account, snapshot: null };
  const { universityId } = account;
  // Everything this run asks the ERP has to fit in the promise made to the button.
  const deadline = Date.now() + (opts.manual ? MANUAL_BUDGET_MS : LOCK_MS);

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
      // A saved ERP session skips the captcha solve and the login entirely;
      // that is the difference between a five-second sync and a twenty-second one.
      const login = async (): Promise<AuthedSession> =>
        autoLogin(universityId, creds.password);
      // The button and the app's own refresh reuse the saved ERP session, so they
      // skip the captcha solve and the login. The backend job keeps logging in: that
      // is what notices a password changed on the ERP and pauses the account.
      const reuse = opts.manual || opts.reuseSession;
      // The background refresh takes only a session logged in within REFRESH_LOGIN_MS, so
      // a password changed on the ERP still surfaces within that while the app is open.
      const kept = reuse ? await loadErpSession(universityId, opts.manual ? undefined : REFRESH_LOGIN_MS) : null;
      let session: AuthedSession = kept ?? (await withDeadline(login(), deadline));

      // A term picked in Settings wins; otherwise the term shown now is pulled at once
      // while only the newer terms are checked alongside.
      const pulled = (s: AuthedSession) => {
        const picked = account.term ? termFromIds(account.term, s.termOptions) : undefined;
        // Course registers (History) start as soon as the attendance page is in; on the
        // button, any still out shortly before its deadline keep their previous copy.
        return pullAll(s, picked, {
          registers: true,
          hint: termHint(previous),
          hintRunning: termIsRunning(previous?.classes),
          ...(opts.manual ? { registersBy: deadline - 500 } : {}),
        });
      };

      let data;
      try {
        data = await withDeadline(pulled(session), deadline);
      } catch (e) {
        if (!isSessionExpiredError(e) || Date.now() > deadline) throw e;
        // The saved session had gone stale on the ERP: log in once and retry.
        await clearErpSession(universityId);
        session = await withDeadline(login(), deadline);
        data = await withDeadline(pulled(session), deadline);
      }

      if (CORE_DATASETS.every((d) => data.failed.includes(d))) throw coded(MESSAGES.erp_unreachable, 'erp_unreachable');
      const saved = await saveFullSnapshot({
        universityId,
        googleId: user.googleId,
        data,
        previous,
        termOptions: session.termOptions,
      });
      await saveErpSession(universityId, session).catch(() => undefined);
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
    // A rejected password also invalidates the session we were reusing.
    if (code === 'bad_credentials') await clearErpSession(universityId);
    await recordSync(user.googleId, universityId, {
      ok: false,
      code,
      message,
      needsPassword: code === 'bad_credentials',
    }).catch(() => undefined);
    return { ok: false, code, message, snapshot: prevView };
  }
}
