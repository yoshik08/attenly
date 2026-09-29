// api/dbdiag.js — TEMPORARY diagnostic. Plaintext MongoDB probe (no TLS).
const { MongoClient } = require('mongodb');

module.exports = async (req, res) => {
  const out = {};
  const uri = process.env.MONGODB_URI || '';
  const m = uri.match(/mongodb:\/\/([^@]+)@([^\/\?]+)/);
  if (!m) { res.json({ err: 'no uri' }); return; }
  const creds = m[1], hosts = m[2].split(',');
  for (const h of hosts) {
    const u = `mongodb://${creds}@${h}/?tls=false&directConnection=true&serverSelectionTimeoutMS=8000`;
    const c = new MongoClient(u);
    try {
      await c.connect();
      out[h] = 'CONNECTED(no tls!)';
    } catch (e) {
      out[h] = String(e && e.message || e).split('\n')[0].slice(0, 160);
    } finally { try { await c.close(); } catch {} }
  }
  res.json(out);
};
