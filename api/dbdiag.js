// api/dbdiag.js — TEMPORARY diagnostic. ClientHello bisection.
const tls = require('tls');

function t(host, opts, label) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 27017, servername: host,
      rejectUnauthorized: false, timeout: 8000, ...opts }, () => {
      resolve(label + ': OK ' + s.getProtocol()); s.end();
    });
    s.on('timeout', () => { s.destroy(); resolve(label + ': timeout'); });
    s.on('error', (e) => resolve(label + ': ' + String(e.message).split(':').pop().slice(0, 60).trim()));
  });
}

module.exports = async (req, res) => {
  const uri = process.env.MONGODB_URI || '';
  const host = (((uri.split('@')[1] || '').split('?')[0]).split(',')[0] || '').split(':')[0];
  const out = {};
  out.tls12only = await t(host, { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' }, 'tls12');
  out.tls13only = await t(host, { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, 'tls13');
  out.oneCipher = await t(host, { ciphers: 'ECDHE-RSA-AES128-GCM-SHA256' }, '1cipher');
  out.noSessTicket = await t(host, { session: undefined }, 'noticket');
  res.json(out);
};
