// api/sync.js — cloud sync engine.
// Hits every user's ERP account: plain creds -> auto-captcha login ->
// attendance + timetable fetch -> parse -> store in Atlas.
// (Credential storage is plaintext per Yoshik's explicit call 2026-09-30;
// legacy encrypted `blob` docs are migrated to plain fields when readable.)
//
// Auth:  Authorization: Bearer <CRON_SECRET>   (github actions 5-min cron)
//   or   POST {idToken}                        (per-user force sync from the app)
//
// GET /api/sync?key=<CRON_SECRET> also works for simple cron pings.
// Response: {ok, results:[{sub,email,ok,syncedAt|error}], ms}

const A = require('./_auth');
const E = require('./_erp');

async function syncOne(doc, d) {
  const t0 = Date.now();
  const rec = { sub: doc.sub, email: doc.email, ok: false };
  try {
    let erpUid = doc.erpUid, erpPass = doc.erpPass;
    // one-time migration: decrypt legacy blob into plain fields when readable
    if ((!erpUid || !erpPass) && doc.blob) {
      try {
        const c = A.decObj(doc.blob);
        erpUid = c.erpUid; erpPass = c.erpPass;
        await d.collection('users').updateOne({ sub: doc.sub },
          { $set: { erpUid, erpPass, updatedAt: new Date() }, $unset: { blob: 1 } });
      } catch (e) { /* unreadable legacy blob: falls through to re-enter */ }
    }
    if (!erpUid || !erpPass)
      throw new Error('no erp login saved — re-enter your erp id and password in the app');
    const { cookies } = await E.erpLogin(erpUid, erpPass);    let attendance = null, timetableHtml = null, attErr = null, ttErr = null;
    try {
      const a = await E.fetchAttendanceTable(cookies);
      attendance = E.parseAttendanceTable(a.html);
    } catch (e) { attErr = e.message; }
    try {
      const t = await E.fetchTimetableTable(cookies);
      timetableHtml = t.html;
    } catch (e) { ttErr = e.message; }
    if (!attendance && !timetableHtml) throw new Error(attErr || ttErr || 'nothing fetched');
    await d.collection('sync').updateOne(
      { sub: doc.sub },
      { $set: { sub: doc.sub, email: doc.email, attendance, timetableHtml,
                attErr, ttErr, syncedAt: new Date() } },
      { upsert: true }
    );
    rec.ok = true; rec.subjects = attendance ? attendance.length : 0;
    rec.warnings = [attErr, ttErr].filter(Boolean);
  } catch (e) {
    rec.error = String(e.message || e).slice(0, 200);
    await d.collection('sync').updateOne(
      { sub: doc.sub },
      { $set: { sub: doc.sub, email: doc.email, lastError: rec.error, attemptedAt: new Date() } },
      { upsert: true }
    );
  }
  rec.ms = Date.now() - t0;
  return rec;
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const secret = process.env.CRON_SECRET || '';
  try {
    const d = await A.db();
    const users = d.collection('users');

    // cron path: bearer secret or ?key=
    const authH = req.headers.authorization || '';
    const keyQ = (req.query && req.query.key) || '';
    const isCron = secret && (authH === 'Bearer ' + secret || keyQ === secret);

    let docs;
    if (isCron) {
      docs = await users.find({ $or: [{ erpUid: { $exists: true } }, { blob: { $exists: true } }] }).toArray();
    } else {
      // force sync path: one user, verified google token
      const body = A.parseBody(req);
      const me = await A.verifyGoogleToken(body.idToken || '');
      const doc = await users.findOne({ sub: me.sub });
      if (!doc || (!doc.erpUid && !doc.blob)) return res.status(404).json({ error: 'no erp credentials saved, complete setup first' });
      docs = [doc];
    }

    const results = [];
    for (const doc of docs) results.push(await syncOne(doc, d));

    return res.json({ ok: true, cron: isCron, users: docs.length,
      results, ms: Date.now() - t0 });
  } catch (e) {
    const msg = String(e.message || e);
    if (/token|signature|expired|issuer|GOOGLE_CLIENT_ID/i.test(msg))
      return res.status(401).json({ error: 'login failed: ' + msg });
    return res.status(500).json({ error: 'sync error: ' + msg });
  }
};
