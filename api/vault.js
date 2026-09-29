// api/vault.js — stores PIN-encrypted ERP credential blobs in Atlas.
// The server NEVER sees the PIN or plaintext creds: the browser derives an
// AES-GCM key from the PIN via PBKDF2 and only ciphertext ever arrives here.
//
// POST {action:"store", uidHash, saltB64, ivB64, cipherB64}
// POST {action:"load",  uidHash} -> {saltB64, ivB64, cipherB64} | 404
//
// Env: MONGODB_URI (Atlas). DB: klu_attendance, collection: vault.

const { MongoClient } = require('mongodb');
let client = null;
async function db() {
  if (!client) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db('klu_attendance').collection('vault');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  try {
    const col = await db();
    if (body.action === 'store') {
      const { uidHash, saltB64, ivB64, cipherB64 } = body;
      if (!uidHash || !saltB64 || !ivB64 || !cipherB64)
        return res.status(400).json({ error: 'missing fields' });
      await col.updateOne(
        { uidHash },
        { $set: { saltB64, ivB64, cipherB64, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.json({ ok: true });
    }
    if (body.action === 'load') {
      const doc = await col.findOne({ uidHash: body.uidHash }, { projection: { _id: 0 } });
      if (!doc) return res.status(404).json({ error: 'no vault for this id' });
      return res.json(doc);
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'vault error: ' + e.message });
  }
};
