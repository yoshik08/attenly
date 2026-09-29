// api/dbdiag.js — TEMPORARY diagnostic. Is TLS broken Vercel-wide or Atlas-only?
const tls = require('tls');
const https = require('https');

function rawTls(host, port, servername) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, servername: servername || host,
      rejectUnauthorized: false, timeout: 8000 }, () => {
      resolve('OK proto=' + s.getProtocol());
      s.end();
    });
    s.on('timeout', () => { s.destroy(); resolve('timeout'); });
    s.on('error', (e) => resolve('ERR ' + String(e.message).split('\n')[0].slice(0, 120)));
  });
}

function httpsGet(host) {
  return new Promise((resolve) => {
    const r = https.get({ host, timeout: 8000, rejectUnauthorized: false }, (res) => {
      resolve('OK status=' + res.statusCode); res.resume();
    });
    r.on('timeout', () => { r.destroy(); resolve('timeout'); });
    r.on('error', (e) => resolve('ERR ' + String(e.message).split('\n')[0].slice(0, 120)));
  });
}

module.exports = async (req, res) => {
  const out = { node: process.version };
  const uri = process.env.MONGODB_URI || '';
  const host = (((uri.split('@')[1] || '').split('?')[0]).split(',')[0] || '').split(':')[0];
  out.atlasTls = await rawTls(host, 27017, host);
  out.googleTls = await rawTls('google.com', 443, 'google.com');
  out.atlasCloudTls = await rawTls('cloud.mongodb.com', 443, 'cloud.mongodb.com');
  out.atlasCloudHttps = await httpsGet('cloud.mongodb.com');
  out.googleHttps = await httpsGet('google.com');
  res.json(out);
};
