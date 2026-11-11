import { findAccount, recordSync, resolvePassword, type UserDoc } from './db/users';
import { getLatestSnapshot, saveFullSnapshot, termKey, toClientSnapshot, type ClientSnapshot, type SnapshotDoc } from './db/snapshots';
import { withLock } from './db/locks';
import { clearErpSession, loadErpSession, saveErpSession } from './db/erp-session';
import { autoLogin, coded, pullAll, ErpRateLimited, ErpTimeout, isSessionExpiredError, type AuthedSession } from './erp/full-sync';
import { termFromIds, termCandidates } from './terms';

/** Cloud data younger than this is served as-is; older data triggers a sync (~5.5 min). */
export const FRESH_MS = 330_000;
/** A crashed sync releases its lock after this long. */
const LOCK_MS = 150_000;
/**
 * The manual sync button promises an answer within five seconds. Everything it
 * asks the ERP runs against this budget; past it the sync stops and says why
 * instead of leaving the button spinning.
 */
export const MANUAL_BUDGET_MS = 4_500;
/** The captcha solver gets this much of a manual sync (a cold free-tier wake is longer). */
const MANUAL_SOLVER_MS = 3_500;

export type SyncCode =
  | 'synced'
  | 'fresh'
  | 'busy'
  | 'needs_password'
  | 'bad_credentials'
  | 'bad_captcha'
  | 'rate_limited'
  | 'solver_unavailable'
  | 'erp_slow'
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
  erp_slow: 'The ERP is slow right now. Attenly kept the numbers it has and will try again on the next sync.',
  erp_unreachable: 'Attenly could not reach the ERP. Try again in a moment.',
  no_account: 'No ERP account is linked yet.',
  failed: 'The sync stopped partway. Try again in a moment.',
};

function classify(e: unknown): Exclude<SyncCode, 'synced' | 'fresh' | 'busy' | 'no_account'> {
  if (e instanceof ErpRateLimited) return 'rate_limited';
  if (e instanceof ErpTimeout) return 'erp_slow';
  const code = (e as { code?: string })?.code;
  if (code === 'bad_credentials') return 'bad_credentials';
  if (code === 'bad_captcha') return 'bad_captcha';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'erp_slow') return 'erp_slow';
  if (code === 'no_solver' || code === 'solve_failed') return 'solver_unavailable';
  if (code === 'erp_unreachable') return 'erp_unreachable';
  if (isSessionExpiredError(e)) return 'failed';
  // fetch() network failures surface as TypeError("fetch failed") or AbortError.
  if (e instanceof TypeError || (e as { name?: string })?.name === 'AbortError' || (e as { name?: string })?.name === 'TimeoutError') {
    return 'erp_unreachable';
  }
  return 'failed';
}

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

/** The datasets whose failure means the ERP answered nothing usable at all. */
const CORE_DATASETS = ['attendance', 'timetable', 'internals', 'results', 'cgpa'] as const;

/**
 * The term to reuse instead of probing: the previous snapshot's term when it is
 * still the newest one the ERP offers and it had courses. Probing costs one
 * attendance fetch per candidate term, so skipping it is most of the saving.
 */
function reusableTerm(previous: SnapshotDoc | null, session: { termOptions?: { years: { id: string; label: string }[]; semesters: { id: string; label: string }[] } }): ReturnType<typeof termCandidates>[number] | undefined {
  if (!previous || (previous.attendance?.length ?? 0) === 0 || !session.termOptions) return undefined;
  const newest = termCandidates(session.termOptions)[0];
  if (!newest) return undefined;
  return termKey(newest) === termKey(previous.term) ? newest : undefined;
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
        autoLogin(universityId, creds.password, opts.manual ? { solverBudgetMs: MANUAL_SOLVER_MS } : {});
      // The button reuses the saved ERP session, so a click skips the captcha
      // solve and the login. Background syncs keep logging in: that is what
      // notices a password changed on the ERP and pauses the account.
      let session: AuthedSession = (opts.manual ? await loadErpSession(universityId) : null) ?? (await withDeadline(login(), deadline));

      // A term picked in Settings wins; otherwise the previous term is reused
      // when it is still the newest, so no time goes on probing older terms.
      const pulled = (s: AuthedSession) => {
        const picked = account.term ? termFromIds(account.term, s.termOptions) : undefined;
        // Course registers (History) are one request each: never on the button.
        return pullAll(s, picked ?? reusableTerm(previous, s), { registers: !opts.manual });
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
