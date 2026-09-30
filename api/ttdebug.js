// api/ttdebug.js — TEMPORARY. timetable endpoint discovery debugger.
// DELETE AFTER USE.
//
// Auth: Authorization: Bearer <CRON_SECRET>  (or ?key=)
// Usage: /api/ttdebug?sub=<google-sub>&key=<CRON_SECRET>
//
// Logs into ERP as that user, fetches ONLY the generic timetable search
// form page, and returns its structural elements (forms, scripts,
// data-urls). It NEVER requests personal timetable data.

const A = require('./_auth');
const E = require('./_erp');

function selectsOf(html) {
  const out = [];
  const w0 = (html.match(/<form\b[^>]*id="w0"[^>]*>([\s\S]*?)<\/form>/i) || [])[1] || '';
  for (const m of w0.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const opts = [];
    for (const o of m[2].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/gi))
      opts.push({ v: o[1], t: o[2].replace(/\s+/g, ' ').trim().slice(0, 50) });
    out.push({ name: m[1], options: opts.slice(0, 30) });
  }
  return out;
}

function formsOf(html) {
  const out = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1], inner = m[2];
    const g = (s, re) => { const mm = s.match(re); return mm ? mm[1] : ''; };
    const inputs = [...inner.matchAll(/<(input|select|button)\b([^>]*)>/gi)].map(x => ({
      tag: x[1], type: g(x[2], /type="([^"]*)"/i),
      name: g(x[2], /name="([^"]*)"/i),
      value: g(x[2], /value="([^"]*)"/i).slice(0, 60),
    }));
    out.push({ action: g(attrs, /action="([^"]*)"/i), method: g(attrs, /method="([^"]*)"/i),
               id: g(attrs, /id="([^"]*)"/i), inputs: inputs.slice(0, 30) });
  }
  return out;
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const authH = req.headers.authorization || '';
  const keyQ = (req.query && req.query.key) || '';
  if (!(secret && (authH === 'Bearer ' + secret || keyQ === secret)))
    return res.status(401).json({ error: 'nope' });
  try {
    const sub = String((req.query && req.query.sub) || '');
    if (!sub) return res.status(400).json({ error: 'need ?sub=' });
    const d = await A.db();
    const doc = await d.collection('users').findOne({ sub });
    if (!doc) return res.status(404).json({ error: 'no such user' });
    let erpUid = doc.erpUid, erpPass = doc.erpPass;
    if ((!erpUid || !erpPass) && doc.blob) {
      try { const c = A.decObj(doc.blob); erpUid = c.erpUid; erpPass = c.erpPass; } catch (e) {}
    }
    if (!erpUid || !erpPass) return res.status(400).json({ error: 'no readable creds for sub' });
    const { cookies } = await E.erpLogin(erpUid, erpPass);
    const page = await E.erpFetch(E.KNOWN_URLS.timetable, { jar: cookies });
    const html = page.buf.toString('utf8');
    const scripts = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const srcm = m[1].match(/src="([^"]+)"/i);
      scripts.push(srcm ? { src: srcm[1] } : { inline: m[2].replace(/\s+/g, ' ').slice(0, 1500) });
      if (scripts.length >= 40) break;
    }
    const dataUrls = [...new Set([...html.matchAll(/data-url\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]))];
    const links = [...new Set([...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)].map(m => m[1]))]
      .filter(h => /timetable|time-table/i.test(h)).slice(0, 20);
    const only = String((req.query && req.query.only) || '');
    if (only === 'selects') return res.json({ selects: selectsOf(html) });
    res.json({
      url: E.KNOWN_URLS.timetable, status: page.status, len: html.length,
      title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '',
      loginForm: /id="login-form"/.test(html),
      forms: formsOf(html), scripts: scripts.slice(0, 12), dataUrls, links,
      selects: selectsOf(html),
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
};
