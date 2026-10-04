import { getDb, isMongoMisconfigured } from './mongo';

export const dynamic = 'force-dynamic';

/**
 * Attenly user — keyed by Google account. ERP passwords are stored ONLY as
 * AES-256-GCM sealed blobs, never plaintext. Supports multiple ERP accounts
 * per Google user via the `accounts` array.
 */
export interface ErpAccount {
  universityId: string;
  creds: string;
  label?: string;
  addedAt: Date;
}

export interface UserDoc {
  googleId: string;
  email: string;
  name?: string;
  universityId?: string;
  creds?: string;
  accounts?: ErpAccount[];
  updatedAt: Date;
}

export async function getUserByGoogleId(googleId: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>('users').findOne({ googleId });
}

/** Get all ERP accounts for a user, migrating legacy single-cred format. */
export function getAccounts(user: UserDoc): ErpAccount[] {
  if (user.accounts && user.accounts.length > 0) {
    return user.accounts;
  }
  // Legacy: single creds at top level
  if (user.universityId && user.creds) {
    return [{
      universityId: user.universityId,
      creds: user.creds,
      addedAt: user.updatedAt,
    }];
  }
  return [];
}

/** Create/update the user row and attach freshly sealed ERP credentials. */
export async function upsertUserCreds(input: {
  googleId: string;
  email: string;
  name?: string;
  universityId: string;
  creds: string;
  label?: string;
}): Promise<void> {
  const db = await getDb();
  const existing = await db.collection<UserDoc>('users').findOne({ googleId: input.googleId });
  const accounts = existing ? getAccounts(existing) : [];
  
  // Update existing or add new
  const idx = accounts.findIndex(a => a.universityId === input.universityId);
  const account: ErpAccount = {
    universityId: input.universityId,
    creds: input.creds,
    label: input.label,
    addedAt: new Date(),
  };
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }

  await db.collection<UserDoc>('users').updateOne(
    { googleId: input.googleId },
    {
      $set: {
        email: input.email,
        name: input.name,
        universityId: input.universityId,
        creds: input.creds,
        accounts,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

/** Get sealed creds for a specific universityId, or the default (first) account. */
export async function getCredsForAccount(
  googleId: string,
  universityId?: string
): Promise<{ universityId: string; creds: string } | null> {
  const user = await getUserByGoogleId(googleId);
  if (!user) return null;
  const accounts = getAccounts(user);
  if (accounts.length === 0) return null;
  
  if (universityId) {
    const acct = accounts.find(a => a.universityId === universityId);
    if (acct) return { universityId: acct.universityId, creds: acct.creds };
  }
  // Default to first account
  return { universityId: accounts[0].universityId, creds: accounts[0].creds };
}

export { isMongoMisconfigured };
