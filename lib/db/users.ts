import { getDb, isMongoMisconfigured } from './mongo';

export const dynamic = 'force-dynamic';

/**
 * Attenly user — keyed by Google account. The ERP password is stored ONLY as
 * an AES-256-GCM sealed blob (`creds`), same as snapshots. Never plaintext.
 */
export interface UserDoc {
  googleId: string;
  email: string;
  name?: string;
  universityId?: string;
  creds?: string;
  updatedAt: Date;
}

export async function getUserByGoogleId(googleId: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>('users').findOne({ googleId });
}

/** Create/update the user row and attach freshly sealed ERP credentials. */
export async function upsertUserCreds(input: {
  googleId: string;
  email: string;
  name?: string;
  universityId: string;
  creds: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection<UserDoc>('users').updateOne(
    { googleId: input.googleId },
    {
      $set: {
        email: input.email,
        name: input.name,
        universityId: input.universityId,
        creds: input.creds,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export { isMongoMisconfigured };
