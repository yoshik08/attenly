// api/sync.js — cloud sync engine.
// Hits every user's ERP account: decrypt creds -> auto-captcha login ->
// attendance + timetable fetch -> parse -> store in Atlas.
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
    const creds = A.decObj(doc.blob);
    const { cookies } = await E.erpLogin(creds.erpUid, creds.erpPass);    let attendance = null, timetableHtml = null, attErr = null, ttErr = null;
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
    let msg = String(e.message || e).slice(0, 200);
    // AES-GCM auth-tag failure = blob was encrypted with a different VAULT_KEY
    if (/unable to authenticate data|unsupported state/i.test(msg))
      msg = 'saved erp login unreadable (encryption key changed) — re-enter your erp password in the app';
    rec.error = msg;
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
      docs = await users.find({ blob: { $exists: true } }).toArray();
    } else {
      // force sync path: one user, verified google token
      const body = A.parseBody(req);
      const me = await A.verifyGoogleToken(body.idToken || '');
      const doc = await users.findOne({ sub: me.sub });
      if (!doc || !doc.blob) return res.status(404).json({ error: 'no erp credentials saved, complete setup first' });
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
