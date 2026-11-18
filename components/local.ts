/**
 * Signed in without Google: everything Attenly knows about the account lives here, in
 * this browser's localStorage, under one key. The server keeps nothing (lib/local.ts).
 *
 *   key  the University ID and password, sealed by the server: this browser can hand it
 *        back to sync but can't read it
 *   erp  the sealed ERP session of the last answer, so the next request usually skips
 *        the captcha and the login
 *
 * Every write reads the stored copy first, so a records request that refreshed `erp`
 * and a sync finishing later never undo each other.
 */
import { api } from '@/lib/api';
import type { ClientSnapshot } from '@/lib/db/snapshots';
import type { AccountView } from '@/lib/db/users';
import { LOCAL_ERP_HEADER, type TermIds } from '@/lib/local-snapshot';

export const LOCAL_KEY = 'attenly:local:v1';

export interface LocalAccount {
  universityId: string;
  key: string;
  erp: string | null;
  /** The year and semester picked in Settings, or null for the newest with attendance. */
  term: TermIds | null;
  snapshot: ClientSnapshot | null;
  /** Forecast's last instruction day (YYYY-MM-DD), or null for month end. */
  lastInstructionDay: string | null;
  needsPassword: boolean;
  lastError: { code: string; message: string; at: string } | null;
}

export function readLocalAccount(): LocalAccount | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<LocalAccount> | null;
    if (!a || typeof a.universityId !== 'string' || !/^[A-Za-z0-9]+$/.test(a.universityId) || typeof a.key !== 'string' || !a.key) return null;
    return {
      universityId: a.universityId,
      key: a.key,
      erp: typeof a.erp === 'string' ? a.erp : null,
      term: a.term ?? null,
      snapshot: a.snapshot ?? null,
      lastInstructionDay: typeof a.lastInstructionDay === 'string' ? a.lastInstructionDay : null,
      needsPassword: Boolean(a.needsPassword),
      lastError: a.lastError ?? null,
    };
  } catch {
    return null;
  }
}

/** Saves the account, or forgets it with null. Returns false when the browser refused (storage full or blocked). */
export function writeLocalAccount(account: LocalAccount | null): boolean {
  try {
    if (account) localStorage.setItem(LOCAL_KEY, JSON.stringify(account));
    else localStorage.removeItem(LOCAL_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Changes some fields of the stored account; null when there is none. */
export function patchLocalAccount(patch: Partial<LocalAccount>): LocalAccount | null {
  const current = readLocalAccount();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeLocalAccount(next);
  return next;
}

/** The account as the rest of the app sees every account. */
export function localAccountView(a: LocalAccount): AccountView {
  return {
    universityId: a.universityId,
    label: null,
    primary: true,
    needsPassword: a.needsPassword,
    lastError: a.lastError,
    lastSyncAt: a.snapshot?.syncedAt ?? null,
    term: a.term,
  };
}

/**
 * POSTs to a /api/local route with this browser's sealed login and ERP session, and
 * keeps the ERP session the answer hands back. Throws when no one is signed in here.
 */
export async function localPost(path: string, body: Record<string, unknown>): Promise<Response> {
  const account = readLocalAccount();
  if (!account) throw new Error('Not signed in on this device.');
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, key: account.key, erp: account.erp }),
    cache: 'no-store',
  });
  const erp = res.headers.get(LOCAL_ERP_HEADER);
  if (erp) patchLocalAccount({ erp });
  return res;
}

/**
 * Opens an ERP document (a booklet scan, a circular) in a new tab. A form post rather
 * than a link, so the sealed login never sits in an address bar or a server log.
 * Call it from a click: the new tab needs the gesture.
 */
export function openLocalDocument(path: string, fields: Record<string, string>): void {
  const account = readLocalAccount();
  if (!account) return;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = api(path);
  form.target = '_blank';
  form.setAttribute('rel', 'noopener');
  form.hidden = true;
  for (const [name, value] of Object.entries({ ...fields, key: account.key, erp: account.erp ?? '' })) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
