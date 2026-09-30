// api/data.js — instant load for the app: latest cloud-synced attendance +
// timetable for the logged-in Google user. No ERP round-trip here.
//
// POST {idToken} -> {syncedAt, attendance:[...], timetableHtml, warnings, hasCreds}

const A = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = A.parseBody(req);
  try {
    const me = await A.verifyGoogleToken(body.idToken || '');
    const d = await A.db();
    const user = await d.collection('users').findOne({ sub: me.sub }, { projection: { blob: 1 } });
    const sync = await d.collection('sync').findOne({ sub: me.sub }, { projection: { _id: 0 } });
    return res.json({
      email: me.email, name: me.name,
      hasCreds: !!(user && user.blob),
      syncedAt: sync ? sync.syncedAt : null,
      attendance: (sync && sync.attendance) || null,
      timetableHtml: (sync && sync.timetableHtml) || null,
      warnings: [sync && sync.attErr, sync && sync.ttErr].filter(Boolean),
      lastError: (sync && sync.lastError) || null,
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (/token|signature|expired|issuer|GOOGLE_CLIENT_ID/i.test(msg))
      return res.status(401).json({ error: 'login failed: ' + msg });
    return res.status(500).json({ error: 'data error: ' + msg });
  }
};
