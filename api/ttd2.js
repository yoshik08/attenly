// api/ttd2.js — TEMPORARY. structural probe of the timetable individuals page.
// DELETE AFTER USE. Returns only table dimensions + header-row labels,
// never cell contents.
const A = require('./_auth');
const E = require('./_erp');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const authH = req.headers.authorization || '';
  const keyQ = (req.query && req.query.key) || '';
  if (!(secret && (authH === 'Bearer ' + secret || keyQ === secret)))
    return res.status(401).json({ error: 'nope' });
  try {
    const sub = String((req.query && req.query.sub) || '');
    const year = String((req.query && req.query.year) || '29');
    const sem = String((req.query && req.query.sem) || '1');
    const act = String((req.query && req.query.act) || 'individuals');
    const method = String((req.query && req.query.m) || 'GET').toUpperCase();
    const d = await A.db();
    const doc = await d.collection('users').findOne({ sub });
    if (!doc) return res.status(404).json({ error: 'no such user' });
    let erpUid = doc.erpUid, erpPass = doc.erpPass;
    if ((!erpUid || !erpPass) && doc.blob) {
      try { const c = A.decObj(doc.blob); erpUid = c.erpUid; erpPass = c.erpPass; } catch (e) {}
    }
    if (!erpUid || !erpPass) return res.status(400).json({ error: 'no readable creds' });
    const { cookies } = await E.erpLogin(erpUid, erpPass);
    const mode = String((req.query && req.query.mode) || 'probe');
    if (mode === 'search') {
      const pg = await E.erpFetch(E.KNOWN_URLS.timetable, { jar: cookies });
      const html = pg.buf.toString('utf8');
      const low = html.toLowerCase();
      const indivCtx = [];
      let idx = 0;
      while (true) {
        idx = low.indexOf('individuals', idx);
        if (idx < 0 || indivCtx.length >= 15) break;
        indivCtx.push(html.slice(Math.max(0, idx - 200), idx + 160).replace(/\s+/g, ' '));
        idx += 11;
      }
      // also: any JS submit/pjax handlers tied to #w0
      const w0js = [];
      for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const js = m[1];
        if (/#w0\b|w0['"]?\s*\)|beforeSubmit/.test(js))
          w0js.push(js.replace(/\s+/g, ' ').slice(0, 1200));
        if (w0js.length >= 6) break;
      }
      const formTag = (html.match(/<form\b[^>]*id="w0"[^>]*>/i) || [])[0] || '';
      const hiddens = [...html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)]
        .map(m => m[0].replace(/\s+/g, ' ').slice(0, 220)).slice(0, 10);
      return res.json({ status: pg.status, len: html.length, indivCtx, w0js, formTag, hiddens });
    }
    const u = E.ERP_BASE + '/index.php?r=' + encodeURIComponent('timetables/universitymasteracademictimetableview/' + act)
      + '&' + encodeURIComponent('UniversityMasterAcademicTimetableView[academicyear]') + '=' + encodeURIComponent(year)
      + '&' + encodeURIComponent('UniversityMasterAcademicTimetableView[semesterid]') + '=' + encodeURIComponent(sem);
    const params = new URLSearchParams();
    params.set('UniversityMasterAcademicTimetableView[academicyear]', year);
    params.set('UniversityMasterAcademicTimetableView[semesterid]', sem);
    const r = method === 'POST'
      ? await E.erpFetch(u.split('?')[0] + '?r=' + encodeURIComponent('timetables/universitymasteracademictimetableview/' + act),
          { jar: cookies, method: 'POST', body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      : await E.erpFetch(u, { jar: cookies });
    const html = r.buf.toString('utf8');
    const tables = [];
    for (const m of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
      const t = m[1];
      const rows = [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      const firstCells = rows.length
        ? [...rows[0][1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
            .map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 10)
        : [];
      // first column of every row = the day labels (structural, not personal)
      const dayCol = rows.map(rr => {
        const c = (rr[1].match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i) || [])[1] || '';
        return c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
      }).slice(0, 10);
      const txt = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      tables.push({ rows: rows.length, firstRow: firstCells, dayCol, textHead: txt });
      if (tables.length >= 12) break;
    }
    const noTableText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // every occurrence of "individuals" with context: how is the target actually used?
    const indivCtx = [];
    const low = html.toLowerCase();
    let idx = 0;
    while (true) {
      idx = low.indexOf('individuals', idx);
      if (idx < 0 || indivCtx.length >= 15) break;
      indivCtx.push(html.slice(Math.max(0, idx - 160), idx + 120).replace(/\s+/g, ' '));
      idx += 11;
    }
    res.json({
      status: r.status, len: html.length, loginForm: /id="login-form"/.test(html),
      indivCtx,
      tables, tableCount: tables.length,
      hasMon: /monday/i.test(html), hasTue: /tuesday/i.test(html),
      hasMonAbbr: /\bmon\b/i.test(noTableText),
      hasDayWord: /day\s*[1-6]/i.test(noTableText),
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
};
