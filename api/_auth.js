// api/_auth.js — Google ID token verification + server-side AES-256-GCM
// encryption for stored ERP creds + shared Mongo helper.
// NOTE: background sync requires the server to decrypt ERP creds on its own,
// so they are encrypted with VAULT_KEY (env), not a user PIN. The old
// PIN-based vault (uidHash-keyed) is left untouched for migration.

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

let client = null;
async function db() {
  if (!client) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    const c = new MongoClient(process.env.MONGODB_URI);
    try { await c.connect(); } catch (e) { throw new Error('mongo connect failed: ' + e.message); }
    client = c;
  }
  return client.db('klu_attendance');
}

// ---- server-side encryption (VAULT_KEY = base64 32 bytes) ----
function vaultKey() {
  const k = Buffer.from(process.env.VAULT_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('VAULT_KEY missing or invalid (need base64 32 bytes)');
  return k;
}
function encObj(obj) {
  const key = vaultKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function decObj({ iv, ct, tag }) {
  const key = vaultKey();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// ---- Google ID token verification (no client secret needed) ----
let certCache = null, certTs = 0;
async function googleCerts() {
  if (certCache && Date.now() - certTs < 3600e3) return certCache;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const j = await r.json();
  certCache = j.keys; certTs = Date.now();
  return certCache;
}
function b64url(b) { return Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
async function verifyGoogleToken(idToken) {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) throw new Error('GOOGLE_CLIENT_ID not set');
  const [hB, pB, sB] = idToken.split('.');
  if (!hB || !pB || !sB) throw new Error('bad token format');
  const header = JSON.parse(b64url(hB).toString('utf8'));
  const payload = JSON.parse(b64url(pB).toString('utf8'));
  const keys = await googleCerts();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(hB + '.' + pB), key, b64url(sB));
  if (!ok) throw new Error('bad token signature');
  if (payload.aud !== cid) throw new Error('token not for this app');
  if (payload.exp * 1000 < Date.now()) throw new Error('token expired');
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com')
    throw new Error('bad issuer');
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

module.exports = { db, encObj, decObj, verifyGoogleToken, parseBody };
