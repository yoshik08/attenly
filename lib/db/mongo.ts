import { Db, MongoClient } from 'mongodb';

const DB_NAME = 'skipwise';

declare global {
  var __skipwiseMongoClient: MongoClient | undefined;
}

/**
 * Returns a cached MongoClient, reusing the same client across hot reloads
 * (dev) and warm serverless invocations. Never stores credentials — this is
 * only the database connection.
 */
async function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env (see .env.example) to enable MongoDB snapshots.',
    );
  }
  if (!globalThis.__skipwiseMongoClient) {
    const client = new MongoClient(uri);
    await client.connect();
    globalThis.__skipwiseMongoClient = client;
  }
  return globalThis.__skipwiseMongoClient;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(DB_NAME);
}

export function isMongoMisconfigured(e: unknown): boolean {
  return e instanceof Error && e.message.includes('MONGODB_URI is not set');
}
