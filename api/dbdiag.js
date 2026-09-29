// api/dbdiag.js — TEMPORARY diagnostic. Tries Mongo connect strategies and
// reports DNS + TLS level detail. Never leaks credentials.
const dns = require('dns').promises;
const { MongoClient } = require('mongodb');

module.exports = async (req, res) => {
  const out = { node: process.version, driver: require('mongodb/package.json').version };
  const uri = process.env.MONGODB_URI || '';
  out.uriScheme = uri.split('://')[0] || null;
  const afterAt = (uri.split('@')[1] || '').split('?')[0];
  out.uriHostPart = afterAt.slice(0, 80) || null;

  // 1. SRV resolution (what +srv:// depends on)
  try {
    const m = uri.match(/mongodb\+srv:\/\/[^@]+@([^\/\?]+)/);
    out.srvTarget = m ? m[1] : null;
    if (m) out.srv = await dns.resolveSrv('_mongodb._tcp.' + m[1]);
  } catch (e) { out.srvError = String(e && e.message || e).slice(0, 200); }

  // 2. plain TCP to 27017 on first SRV host (is it even reachable?)
  try {
    const host = (out.srv && out.srv[0] && out.srv[0].name) || null;
    out.tcpHost = host;
    if (host) {
      const net = require('net');
      await new Promise((resolve, reject) => {
        const s = net.connect(27017, host);
        s.setTimeout(6000);
        s.on('connect', () => { s.end(); resolve(); });
        s.on('timeout', () => { s.destroy(); reject(new Error('tcp timeout')); });
        s.on('error', reject);
      });
      out.tcp = 'OK';
    }
  } catch (e) { out.tcp = String(e && e.message || e).slice(0, 200); }

  // 3. driver connect attempts
  for (const [name, opts] of [['default', {}], ['ipv4', { family: 4 }]]) {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 9000, ...opts });
    try {
      await c.connect();
      await c.db('klu_attendance').listCollections().toArray();
      out[name] = 'OK';
    } catch (e) { out[name] = String(e && e.message || e).split('\n')[0].slice(0, 300); }
    finally { try { await c.close(); } catch {} }
  }
  res.json(out);
};
