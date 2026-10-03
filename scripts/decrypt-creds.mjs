#!/usr/bin/env node
/**
 * Decrypt the AES-256-GCM `creds` blob stored in a MongoDB snapshot.
 *
 * Usage:
 *   SESSION_SECRET=<your-secret> node scripts/decrypt-creds.mjs <creds-blob>
 *
 * Where to get the inputs:
 *   - creds blob: Atlas → attenly → snapshots → your document → copy the `creds` field
 *   - SESSION_SECRET: Vercel → attenly project → Settings → Environment Variables
 *
 * The blob layout is: base64url( iv[12] | authTag[16] | ciphertext ).
 * The plaintext is JSON like: {"pw":"..."}.
 */
import { createDecipheriv } from 'node:crypto';

const secret = process.env.SESSION_SECRET;
const blob = process.argv[2];

if (!secret) {
  console.error('error: SESSION_SECRET env var is required.');
  process.exit(1);
}
if (!blob) {
  console.error('usage: SESSION_SECRET=<secret> node scripts/decrypt-creds.mjs <creds-blob>');
  process.exit(1);
}

function sessionKey() {
  const hex = secret.replace(/[^0-9a-f]/gi, '');
  if (hex.length === 64) return Buffer.from(hex, 'hex');
  const b64 = Buffer.from(secret.replace(/\s/g, ''), 'base64');
  if (b64.length === 32) return b64;
  throw new Error('SESSION_SECRET must decode to 32 bytes (64 hex chars or base64)');
}

try {
  const key = sessionKey();
  const buf = Buffer.from(blob.trim(), 'base64url');
  if (buf.length < 12 + 16 + 1) throw new Error('blob too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  console.log(pt.toString('utf8'));
} catch (e) {
  console.error('decrypt failed:', e instanceof Error ? e.message : e);
  console.error('(wrong SESSION_SECRET or a corrupted/tampered blob also lands here)');
  process.exit(1);
}
