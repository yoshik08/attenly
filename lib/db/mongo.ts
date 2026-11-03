import { Db, MongoClient } from 'mongodb';

/** The live data has always lived in this database; keep it. */
const DB_NAME = 'skipwise';

declare global {
  var __attenlyMongo: Promise<MongoClient> | undefined;
}

/**
 * One shared connection per server instance. The promise is cached (not the
 * client) so concurrent first requests share a single connect, and a failed
 * connect is forgotten so the next request retries instead of failing forever.
 */
function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(new Error('MONGODB_URI is not set.'));
  }
  if (!globalThis.__attenlyMongo) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    globalThis.__attenlyMongo = client.connect().catch((e: unknown) => {
      globalThis.__attenlyMongo = undefined;
      throw e;
    });
  }
  return globalThis.__attenlyMongo;
}

export async function getDb(): Promise<Db> {
  const client = await connect();
  return client.db(DB_NAME);
}

export function isMongoMisconfigured(e: unknown): boolean {
  return e instanceof Error && e.message.includes('MONGODB_URI is not set');
}
