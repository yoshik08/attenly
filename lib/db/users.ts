import type { WithId } from 'mongodb';
import { getDb } from './mongo';
import { unsealSession } from '../erp/client';

/**
 * Attenly user, keyed by Google account id.
 *
 * ERP credentials are stored as-is (plaintext) — the owner's explicit call
 * ("i want normies"): a key rotation must never lock anyone out of their own
 * sync again. The primary account is mirrored at the top level as
 * erpUid / erpPass; every linked account (primary included) lives in
 * `accounts` with its own erpPass.
 *
 * `creds` (top level or per account) is the AES-sealed password written by the
 * Oct 2026 build. It is only ever read to convert it to erpPass.
 */
export interface SyncErrorInfo {
  code: string;
  message: string;
  at: Date;
}

export interface ErpAccount {
  universityId: string;
  erpPass?: string;
  creds?: string;
  label?: string;
  addedAt: Date;
  /** The saved password is missing, unreadable or was rejected; syncing waits for it. */
  needsPassword?: boolean;
  lastError?: SyncErrorInfo | null;
  lastSyncAt?: Date | null;
  /** Year and semester (ERP ids) to sync; unset means the newest term with attendance. */
  term?: { academicyear: string; semesterid: string } | null;
}

export interface UserDoc {
  googleId: string;
  email: string;
  name?: string;
  erpUid?: string;
  erpPass?: string;
  universityId?: string;
  creds?: string;
  accounts?: ErpAccount[];
  /** Last day attendance is taken, YYYY-MM-DD. Per user, shown on Forecast. */
  lastInstructionDay?: string | null;
  createdAt?: Date;
  updatedAt: Date;
}

const usersCol = async () => (await getDb()).collection<UserDoc>('users');

export async function getUser(googleId: string): Promise<WithId<UserDoc> | null> {
  return (await usersCol()).findOne({ googleId });
}

/** Linked accounts, primary first. A legacy single-account document reads as one account. */
export function accountsOf(user: UserDoc): ErpAccount[] {
  if (user.accounts && user.accounts.length > 0) return user.accounts;
  const universityId = user.erpUid ?? user.universityId;
  if (!universityId) return [];
  return [
    {
      universityId,
      ...(user.erpPass ? { erpPass: user.erpPass } : {}),
      ...(user.creds ? { creds: user.creds } : {}),
      addedAt: user.updatedAt,
    },
  ];
}

export function findAccount(user: UserDoc, universityId?: string | null): ErpAccount | null {
  const list = accountsOf(user);
  if (universityId) return list.find((a) => a.universityId === universityId) ?? null;
  return list[0] ?? null;
}

/**
 * The password to log in with: the stored plaintext, or the legacy sealed copy
 * when this server can still open it (`migrated` tells the caller to persist it
 * as plaintext). Null when neither is usable.
 */
export function resolvePassword(account: ErpAccount): { password: string; migrated: boolean } | null {
  if (account.erpPass) return { password: account.erpPass, migrated: false };
  if (account.creds) {
    const opened = unsealSession<{ pw?: string }>(account.creds);
    if (opened?.pw) return { password: opened.pw, migrated: true };
  }
  return null;
}

/** Public view of an account; never includes a password. */
export interface AccountView {
  universityId: string;
  label: string | null;
  primary: boolean;
  needsPassword: boolean;
  lastError: { code: string; message: string; at: string } | null;
  lastSyncAt: string | null;
  term: { academicyear: string; semesterid: string } | null;
}

export function viewAccounts(user: UserDoc): AccountView[] {
  return accountsOf(user).map((a, i) => ({
    universityId: a.universityId,
    label: a.label ?? null,
    primary: i === 0,
    needsPassword: Boolean(a.needsPassword) || (!a.erpPass && !a.creds),
    lastError: a.lastError ? { code: a.lastError.code, message: a.lastError.message, at: new Date(a.lastError.at).toISOString() } : null,
    lastSyncAt: a.lastSyncAt ? new Date(a.lastSyncAt).toISOString() : null,
    term: a.term ? { academicyear: a.term.academicyear, semesterid: a.term.semesterid } : null,
  }));
}

function cleanAccount(a: ErpAccount): ErpAccount {
  const out: ErpAccount = { ...a };
  if (out.erpPass) delete out.creds;
  return out;
}

/** Top-level mirror of the primary account, plus the fields that must go. */
function mirror(accounts: ErpAccount[]): { set: Partial<UserDoc>; unset: Record<string, ''> } {
  const p = accounts[0];
  if (!p) return { set: {}, unset: { erpUid: '', erpPass: '', universityId: '', creds: '' } };
  const set: Partial<UserDoc> = { erpUid: p.universityId, universityId: p.universityId };
  const unset: Record<string, ''> = {};
  if (p.erpPass) {
    set.erpPass = p.erpPass;
    unset.creds = '';
  } else {
    unset.erpPass = '';
    if (p.creds) set.creds = p.creds;
    else unset.creds = '';
  }
  return { set, unset };
}

/**
 * Read-modify-write of the accounts list with an optimistic check on
 * updatedAt, so a background sync and a link from the browser can't silently
 * overwrite each other. `change` returns the new list, or null for no change.
 */
async function mutateAccounts(
  googleId: string,
  change: (accounts: ErpAccount[]) => ErpAccount[] | null,
  profile?: { email?: string; name?: string },
): Promise<void> {
  const col = await usersCol();
  for (let attempt = 0; attempt < 5; attempt++) {
    const user = await col.findOne({ googleId });
    const current = user ? accountsOf(user).map((a) => ({ ...a })) : [];
    const next = change(current);
    if (next === null) return;
    const accounts = next.map(cleanAccount);
    const now = new Date();
    const { set, unset } = mirror(accounts);
    const $set: Partial<UserDoc> = {
      ...set,
      accounts,
      updatedAt: now,
      ...(profile?.email ? { email: profile.email } : {}),
      ...(profile?.name ? { name: profile.name } : {}),
    };
    if (!user) {
      await col.updateOne(
        { googleId },
        { $set: { ...$set, email: profile?.email ?? '' }, $setOnInsert: { googleId, createdAt: now } },
        { upsert: true },
      );
      return;
    }
    const res = await col.updateOne(
      { _id: user._id, updatedAt: user.updatedAt },
      Object.keys(unset).length > 0 ? { $set, $unset: unset } : { $set },
    );
    if (res.matchedCount === 1) return;
  }
  throw new Error('Could not save the account change. Try again.');
}

/** Link (or re-link) an ERP account with a password the ERP just accepted. */
export async function linkAccount(input: {
  googleId: string;
  email: string;
  name?: string;
  universityId: string;
  password: string;
  label?: string;
}): Promise<void> {
  const now = new Date();
  await mutateAccounts(
    input.googleId,
    (accounts) => {
      const i = accounts.findIndex((a) => a.universityId === input.universityId);
      const prev = i >= 0 ? accounts[i] : null;
      const account: ErpAccount = {
        universityId: input.universityId,
        erpPass: input.password,
        label: input.label?.trim() || prev?.label,
        addedAt: prev?.addedAt ?? now,
        needsPassword: false,
        lastError: null,
        lastSyncAt: now,
        ...(prev?.term ? { term: prev.term } : {}),
      };
      if (i >= 0) accounts[i] = account;
      else accounts.push(account);
      return accounts;
    },
    { email: input.email, name: input.name },
  );
}

export async function removeAccount(googleId: string, universityId: string): Promise<boolean> {
  let removed = false;
  await mutateAccounts(googleId, (accounts) => {
    const next = accounts.filter((a) => a.universityId !== universityId);
    removed = next.length !== accounts.length;
    return removed ? next : null;
  });
  return removed;
}

/** Make an account the primary one (first in the list, mirrored at top level). */
export async function makePrimary(googleId: string, universityId: string): Promise<boolean> {
  let found = false;
  await mutateAccounts(googleId, (accounts) => {
    const i = accounts.findIndex((a) => a.universityId === universityId);
    found = i >= 0;
    if (i <= 0) return null;
    const [a] = accounts.splice(i, 1);
    return [a, ...accounts];
  });
  return found;
}

/** Choose the year and semester an account syncs (null: the newest term with attendance). */
export async function setAccountTerm(
  googleId: string,
  universityId: string,
  term: { academicyear: string; semesterid: string } | null,
): Promise<boolean> {
  let found = false;
  await mutateAccounts(googleId, (accounts) => {
    const i = accounts.findIndex((a) => a.universityId === universityId);
    found = i >= 0;
    if (i < 0) return null;
    const a = { ...accounts[i] };
    if (term) a.term = { academicyear: term.academicyear, semesterid: term.semesterid };
    else delete a.term;
    accounts[i] = a;
    return accounts;
  });
  return found;
}

/** Record the outcome of a sync on the account. */
export async function recordSync(
  googleId: string,
  universityId: string,
  outcome:
    | { ok: true; plainPassword?: string }
    | { ok: false; code: string; message: string; needsPassword?: boolean },
): Promise<void> {
  await mutateAccounts(googleId, (accounts) => {
    const i = accounts.findIndex((a) => a.universityId === universityId);
    if (i < 0) return null;
    const a = { ...accounts[i] };
    if (outcome.ok) {
      a.lastSyncAt = new Date();
      a.lastError = null;
      a.needsPassword = false;
      if (outcome.plainPassword) a.erpPass = outcome.plainPassword;
    } else {
      a.lastError = { code: outcome.code, message: outcome.message, at: new Date() };
      if (outcome.needsPassword) a.needsPassword = true;
    }
    accounts[i] = a;
    return accounts;
  });
}

/** Every user with at least one linked account (for the backend sync). */
/** The last day attendance is taken (YYYY-MM-DD), or null to forecast to month end. */
export async function setLastInstructionDay(googleId: string, day: string | null): Promise<boolean> {
  const res = await (await usersCol()).updateOne(
    { googleId },
    { $set: { lastInstructionDay: day, updatedAt: new Date() } },
  );
  return res.matchedCount > 0;
}

export async function usersWithAccounts(): Promise<WithId<UserDoc>[]> {
  return (await usersCol())
    .find({ $or: [{ 'accounts.0': { $exists: true } }, { erpUid: { $exists: true } }, { universityId: { $exists: true } }] })
    .toArray();
}

export { usersCol };
