// api/vault.js — ERP credential store, keyed by Google sub.
// Plain storage per Yoshik's explicit call (2026-09-30): no encryption,
// erpUid/erpPass are saved as-is. Legacy encrypted `blob` docs are migrated
// to plain fields on next sync, or replaced on re-entry.
// Old PIN-based docs (uidHash-keyed) are left untouched.
//
// POST {idToken, action:"store", erpUid, erpPass} -> {ok}
// POST {idToken, action:"status"} -> {hasCreds, email}
// POST {idToken, action:"delete"} -> {ok}

const A = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = A.parseBody(req);
  try {
    const me = await A.verifyGoogleToken(body.idToken || '');
    const d = await A.db();
    const col = d.collection('users');

    if (body.action === 'store') {
      const erpUid = String(body.erpUid || '').trim();
      const erpPass = String(body.erpPass || '');
      if (!erpUid || !erpPass) return res.status(400).json({ error: 'erp id and password required' });
      await col.updateOne(
        { sub: me.sub },
        { $set: { sub: me.sub, email: me.email, name: me.name, erpUid, erpPass, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
          $unset: { blob: 1 } },
        { upsert: true }
      );
      return res.json({ ok: true });
    }
    if (body.action === 'status') {
      const doc = await col.findOne({ sub: me.sub }, { projection: { erpUid: 1, blob: 1 } });
      return res.json({ hasCreds: !!(doc && (doc.erpUid || doc.blob)), email: me.email, name: me.name });
    }
    if (body.action === 'delete') {
      await col.deleteOne({ sub: me.sub });
      await d.collection('sync').deleteMany({ sub: me.sub });
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    const msg = String(e.message || e);
    if (/token|signature|expired|issuer|GOOGLE_CLIENT_ID/i.test(msg))
      return res.status(401).json({ error: 'login failed: ' + msg });
    return res.status(500).json({ error: 'vault error: ' + msg });
  }
};
