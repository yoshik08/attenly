/**
 * What a sync can answer, in words and HTTP statuses. Shared by the cloud sync
 * (lib/sync.ts) and the no-Google one (/api/local/sync); no database here.
 */
import { ErpRateLimited, ErpTimeout, isSessionExpiredError } from './erp/full-sync';

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

export const SYNC_MESSAGES: Record<Exclude<SyncCode, 'synced' | 'fresh'>, string> = {
  busy: 'A sync for this account is already running.',
  needs_password: 'Enter your ERP password once to resume syncing.',
  bad_credentials: 'The ERP rejected the saved password. Enter your current ERP password.',
  bad_captcha: 'The captcha solver misread the ERP captcha. Try again in a moment.',
  rate_limited: 'The ERP is rate-limiting logins. Try again in a minute.',
  solver_unavailable: 'Attenly could not read the ERP captcha. Try again in a moment.',
  erp_slow: 'The ERP is slow right now. Attenly kept the numbers it has and will try again on the next sync.',
  erp_unreachable: 'Attenly could not reach the ERP. Try again in a moment.',
  no_account: 'No ERP account is linked yet.',
  failed: 'The sync stopped partway. Try again in a moment.',
};

/** The HTTP status each failed sync answers with. */
export const SYNC_STATUS: Partial<Record<SyncCode, number>> = {
  busy: 409,
  needs_password: 409,
  bad_credentials: 409,
  no_account: 404,
  rate_limited: 429,
  bad_captcha: 502,
  solver_unavailable: 502,
  erp_slow: 504,
  erp_unreachable: 502,
  failed: 502,
};

/** The sync code for an error thrown while logging in or pulling from the ERP. */
export function classifySyncError(e: unknown): Exclude<SyncCode, 'synced' | 'fresh' | 'busy' | 'no_account'> {
  if (e instanceof ErpRateLimited) return 'rate_limited';
  if (e instanceof ErpTimeout) return 'erp_slow';
  const code = (e as { code?: string })?.code;
  if (code === 'bad_credentials') return 'bad_credentials';
  if (code === 'bad_captcha') return 'bad_captcha';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'erp_slow') return 'erp_slow';
  if (code === 'solve_failed') return 'solver_unavailable';
  if (code === 'erp_unreachable') return 'erp_unreachable';
  if (isSessionExpiredError(e)) return 'failed';
  // fetch() network failures surface as TypeError("fetch failed") or AbortError.
  if (e instanceof TypeError || (e as { name?: string })?.name === 'AbortError' || (e as { name?: string })?.name === 'TimeoutError') {
    return 'erp_unreachable';
  }
  return 'failed';
}

/** The datasets whose failure means the ERP answered nothing usable at all. */
export const CORE_DATASETS = ['attendance', 'timetable', 'cgpa'] as const;
