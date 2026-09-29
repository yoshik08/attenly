// api/dbdiag.js — TEMPORARY diagnostic. DNS + per-shard TLS.
const tls = require('tls');
const dns = require('dns').promises;

function rawTls(host, servername) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 27017, servername,
      rejectUnauthorized: false, timeout: 8000 }, () => {
      resolve('OK proto=' + s.getProtocol()); s.end();
    });
    s.on('timeout', () => { s.destroy(); resolve('timeout'); });
    s.on('error', (e) => resolve('ERR ' + String(e.message).split('\n')[0].slice(0, 100)));
  });
}

module.exports = async (req, res) => {
  const out = {};
  const uri = process.env.MONGODB_URI || '';
  const hosts = ((uri.split('@')[1] || '').split('?')[0]).split(',').map(h => h.split(':')[0]);
  for (const h of hosts) {
    const r = { host: h };
    try { r.a = await dns.resolve4(h); } catch (e) { r.aErr = e.message.slice(0, 80); }
    try { r.aaaa = await dns.resolve6(h); } catch (e) { r.aaaaErr = e.message.slice(0, 80); }
    r.tlsSNI = await rawTls(h, h);
    out[h] = r;
  }
  res.json(out);
};
