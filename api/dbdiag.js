// api/dbdiag.js — TEMPORARY diagnostic. Real driver connect check.
const { MongoClient } = require('mongodb');
module.exports = async (req, res) => {
  const out = {};
  const uri = process.env.MONGODB_URI || '';
  out.scheme = uri.split('://')[0] || null;
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await c.connect();
    await c.db('klu_attendance').collection('vault').findOne({});
    out.driver = 'OK';
  } catch (e) { out.driver = String(e && e.message || e).split('\n')[0].slice(0, 200); }
  finally { try { await c.close(); } catch {} }
  res.json(out);
};
