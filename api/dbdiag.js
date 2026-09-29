// api/dbdiag.js — TEMPORARY diagnostic. Raw TLS vs driver TLS comparison.
const { MongoClient } = require('mongodb');
const tls = require('tls');
const net = require('net');

function rawTls(host, servername) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 27017, servername,
      rejectUnauthorized: false, timeout: 8000 }, () => {
      const cert = s.getPeerCertificate();
      resolve('OK proto=' + s.getProtocol() + ' cn=' +
        ((cert && cert.subject && cert.subject.CN) || '?'));
      s.end();
    });
    s.on('timeout', () => { s.destroy(); resolve('tcp/tls timeout'); });
    s.on('error', (e) => resolve('ERR ' + String(e.message).split('\n')[0].slice(0, 160)));
  });
}

function tcp(host) {
  return new Promise((resolve) => {
    const s = net.connect(27017, host);
    s.setTimeout(6000);
    s.on('connect', () => { s.end(); resolve('OK'); });
    s.on('timeout', () => { s.destroy(); resolve('timeout'); });
    s.on('error', (e) => resolve('ERR ' + e.message.slice(0, 120)));
  });
}

module.exports = async (req, res) => {
  const out = { node: process.version };
  const uri = process.env.MONGODB_URI || '';
  out.uriScheme = uri.split('://')[0] || null;
  const hosts = ((uri.split('@')[1] || '').split('?')[0]).split(',');
  const host = (hosts[0] || '').split(':')[0] || null;
  out.host = host;

  out.tcp = host ? await tcp(host) : 'no host';
  out.tlsWithSNI = host ? await rawTls(host, host) : 'no host';
  out.tlsNoSNI = host ? await rawTls(host, undefined) : 'no host';

  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 9000 });
  try {
    await c.connect();
    out.driver = 'OK';
  } catch (e) { out.driver = String(e && e.message || e).split('\n')[0].slice(0, 200); }
  finally { try { await c.close(); } catch {} }
  res.json(out);
};
