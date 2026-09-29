// api/erp.js — KLU NewERP proxy (Yii2), pinned to bom1 (Mumbai) via vercel.json.
// Verified 2026-09-29 against https://newerp.kluniversity.in/ :
//   login page  : GET /  (serves the login form)
//   login POST  : /index.php?r=site/login
//                 fields: _csrf, LoginForm[username], LoginForm[password],
//                         LoginForm[captcha], LoginForm[qr_code] (MFA, optional)
//   captcha img : <img id="loginFormCaptcha-image"
//                 src="/index.php?r=site%2Fcaptcha&v=<token>">  (120x50 transparent PNG)
//   captcha refresh: GET /index.php?r=site/captcha&refresh=1 -> {"url":"/index.php?r=site/captcha&v=..."}
//   success     : HTTP 302 redirect. failure: 200 with #login-form re-rendered.
// Stateless: session cookies travel back to the client tab and come back
// with each call. Never stores credentials.

const ERP_BASE = 'https://newerp.kluniversity.in';
const ERP_LOGIN_PAGE = ERP_BASE + '/';
const ERP_LOGIN_POST = ERP_BASE + '/index.php?r=site/login';
const ERP_CAPTCHA_REFRESH = ERP_BASE + '/index.php?r=site/captcha&refresh=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Cloud captcha solver: POST {image_b64} -> {text}. Set SOLVER_URL env var
// (the Render solver service). Empty string when unconfigured or on error;
// the frontend then falls back to manual captcha entry.
async function solveCloud(b64) {
  const url = (process.env.SOLVER_URL || '').replace(/\/$/, '');
  if (!url || !b64) return '';
  try {
    const r = await fetch(url + '/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64 }),
    });
    const j = await r.json().catch(() => ({}));
    return String(j.text || '').toLowerCase().replace(/[^a-z]/g, '');
  } catch (e) { return ''; }
}

function parseCookies(setCookieHeaders) {
  const jar = {};
  for (const h of setCookieHeaders || []) {
    const pair = h.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
function jarHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function erpFetch(url, { method = 'GET', jar = {}, body = null, headers = {} } = {}) {
  const h = { 'User-Agent': UA, ...headers };
  const cookieStr = jarHeader(jar);
  if (cookieStr) h['Cookie'] = cookieStr;
  let res;
  try {
    res = await fetch(url, { method, headers: h, body, redirect: 'manual' });
  } catch (e) {
    return { netError: 'erp unreachable from proxy: ' + e.message };
  }
  let newJar = { ...jar };
  if (typeof res.headers.getSetCookie === 'function') {
    Object.assign(newJar, parseCookies(res.headers.getSetCookie()));
  } else {
    const sc = res.headers.get('set-cookie');
    if (sc) Object.assign(newJar, parseCookies([sc]));
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, jar: newJar };
}

function absUrl(src) {
  src = src.replace(/&amp;/g, '&');
  if (src.startsWith('/')) return ERP_BASE + src;
  if (!src.startsWith('http')) return ERP_BASE + '/' + src;
  return src;
}
function extractCsrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/name="_csrf"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}
function extractCaptchaSrc(html) {
  let m = html.match(/<img[^>]+id="loginFormCaptcha-image"[^>]+src="([^"]+)"/)
       || html.match(/<img[^>]+src="([^"]+)"[^>]+id="loginFormCaptcha-image"/)
       || html.match(/<img[^>]+src="([^"]*site%2Fcaptcha[^"]*)"/)
       || html.match(/<img[^>]+src="([^"]*captcha[^"]*)"/i);
  return m ? absUrl(m[1]) : null;
}
function loginFailReason(html) {
  const h = html.toLowerCase();
  if (/verification code/.test(h)) return 'captcha';
  if (/incorrect username or password|invalid login/.test(h)) return 'creds';
  if (/qr_code|mfa|authenticator|otp/.test(h)) return 'mfa';
  return 'unknown';
}
function extractHrefs(html) {
  const out = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < 300) {
    let u = m[1].replace(/&amp;/g, '&');
    if (u.startsWith('/')) u = ERP_BASE + u;
    else if (!u.startsWith('http')) continue;
    if (u.includes(ERP_BASE.replace('https://', ''))) out.push(u);
  }
  return [...new Set(out)];
}
function scoreUrl(u, keywords) {
  const l = u.toLowerCase();
  let s = 0;
  for (const [kw, pts] of keywords) if (l.includes(kw)) s += pts;
  return s;
}
async function fetchCaptchaImage(capUrl, jar) {
  const c = await erpFetch(capUrl, { jar });
  if (c.netError || c.status !== 200) return { error: 'captcha fetch failed' };
  return {
    captchaB64: c.buf.toString('base64'),
    captchaMime: c.headers.get('content-type') || 'image/png',
    cookies: c.jar,
  };
}

module.exports = async (req, res) => {
  // probe: GET /api/erp?probe=1
  if (req.method === 'GET' && req.query && req.query.probe === '1') {
    const t0 = Date.now();
    const r = await erpFetch(ERP_LOGIN_PAGE);
    if (r.netError) return res.json({ reachable: false, error: r.netError, ms: Date.now() - t0, region: process.env.VERCEL_REGION || 'unknown' });
    const html = r.buf.toString('utf8');
    return res.json({
      reachable: true, httpStatus: r.status, ms: Date.now() - t0,
      pageBytes: html.length, hasCaptcha: /captcha/i.test(html),
      hasLoginForm: /id="login-form"/.test(html),
      region: process.env.VERCEL_REGION || 'unknown',
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  try {
    // ---- init: login page + csrf + captcha ----
    if (body.action === 'init') {
      const r = await erpFetch(ERP_LOGIN_PAGE);
      if (r.netError) return res.status(502).json({ error: r.netError });
      const html = r.buf.toString('utf8');
      const capSrc = extractCaptchaSrc(html);
      const csrf = extractCsrf(html);
      let jar = r.jar, cap = { captchaB64: null };
      if (capSrc) {
        cap = await fetchCaptchaImage(capSrc, jar);
        if (cap.cookies) jar = cap.cookies;
      }
      return res.json({
        captchaB64: cap.captchaB64 || null, captchaMime: cap.captchaMime || 'image/png',
        csrf, cookies: jar, captchaError: cap.error || null,
        captchaText: await solveCloud(cap.captchaB64),
      });
    }

    // ---- refresh: new captcha without reloading the login page ----
    if (body.action === 'refresh') {
      const { cookies = {} } = body;
      const r = await erpFetch(ERP_CAPTCHA_REFRESH, { jar: cookies, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (r.netError) return res.status(502).json({ error: r.netError });
      let url = null;
      try { url = absUrl(JSON.parse(r.buf.toString('utf8')).url); } catch {}
      if (!url) return res.status(502).json({ error: 'captcha refresh failed' });
      const cap = await fetchCaptchaImage(url, r.jar);
      if (cap.error) return res.status(502).json({ error: cap.error });
      return res.json({ captchaB64: cap.captchaB64, captchaMime: cap.captchaMime, cookies: cap.cookies,
        captchaText: await solveCloud(cap.captchaB64) });
    }

    // ---- login ----
    if (body.action === 'login') {
      const { uid, password, captchaText, qrCode = '', csrf, cookies = {} } = body;
      if (!uid || !password || !captchaText || !csrf)
        return res.status(400).json({ error: 'missing fields (uid/password/captcha/csrf)' });
      const params = new URLSearchParams({
        _csrf: csrf,
        'LoginForm[username]': uid,
        'LoginForm[password]': password,
        'LoginForm[captcha]': captchaText,
      });
      if (qrCode) params.set('LoginForm[qr_code]', qrCode);
      const r = await erpFetch(ERP_LOGIN_POST, {
        method: 'POST', jar: cookies, body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': ERP_LOGIN_PAGE },
      });
      if (r.netError) return res.status(502).json({ error: r.netError });
      // Yii2 redirects (302) on successful login.
      if (r.status === 302 || r.status === 301) {
        return res.json({ ok: true, cookies: r.jar, redirect: r.headers.get('location') });
      }
      const html = r.buf.toString('utf8');
      const stillLogin = /id="login-form"/.test(html);
      if (!stillLogin) return res.json({ ok: true, cookies: r.jar }); // landed somewhere else
      const reason = loginFailReason(html);
      return res.json({ ok: false, reason, cookies: r.jar, mfaRequired: reason === 'mfa' });
    }

    // ---- known ERP routes (verified 2026-09-29 against live dashboard) ----
    const KNOWN_URLS = {
      attendance: ERP_BASE + '/index.php?r=studentattendance%2Fstudentdailyattendance%2Fsearchgetinput',
      timetable: ERP_BASE + '/index.php?r=timetables%2Funiversitymasteracademictimetableview%2Findexstudentindisearch',
    };
    // attendance register is a search form: GET the page, pick latest academic
    // year + odd sem, POST it back. Returns the result HTML or null.
    async function fetchAttendanceTable(cookies) {
      const page = await erpFetch(KNOWN_URLS.attendance, { jar: cookies });
      if (page.netError || page.status !== 200) return null;
      let html = page.buf.toString('utf8');
      if (/id="login-form"/.test(html)) return { loggedOut: true };
      const csrf = (html.match(/id="student-attendance-register"[\s\S]*?name="_csrf" value="([^"]+)"/)
        || html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
      const yearSel = (html.match(/name="DynamicModel\[academicyear\]"[\s\S]*?<\/select>/) || [''])[0];
      const yearVal = (yearSel.match(/<option value="(\d+)">/) || [])[1];
      const semSel = (html.match(/name="DynamicModel\[semesterid\]"[\s\S]*?<\/select>/) || [''])[0];
      const semVal = (semSel.match(/<option value="1">/) ? '1'
        : (semSel.match(/<option value="(\d+)">/) || [])[1]);
      if (!csrf || !yearVal || !semVal) return null;
      const params = new URLSearchParams({
        _csrf: csrf, 'DynamicModel[academicyear]': yearVal, 'DynamicModel[semesterid]': semVal });
      const r = await erpFetch(KNOWN_URLS.attendance, { method: 'POST', jar: page.jar,
        body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': KNOWN_URLS.attendance } });
      if (r.netError || r.status !== 200) return null;
      html = r.buf.toString('utf8');
      if (/id="login-form"/.test(html)) return { loggedOut: true };
      if (!/conducted|\bcond\b/i.test(html)) return null;
      return { html, url: KNOWN_URLS.attendance, cookies: r.jar };
    }

    // ---- discover + fetch a report page (attendance / timetable) ----
    if (body.action === 'report') {
      const { cookies = {}, kind = 'attendance', url: urlOverride = null } = body;
      const knownUrl = urlOverride || KNOWN_URLS[kind];
      if (kind === 'attendance' && knownUrl) {
        const hit = await fetchAttendanceTable(cookies);
        if (hit && hit.html) return res.json({ ...hit });
        if (hit && hit.loggedOut) return res.json({ loggedOut: true });
      }
      const kw = kind === 'timetable'
        ? [['timetable', 3], ['time-table', 3], ['schedule', 1], ['class-time', 2]]
        : [['attendance', 3], ['attd', 2], ['attnd', 2]];
      const marker = kind === 'timetable'
        ? /monday|tuesday|wednesday/i
        : /conducted|\bcond\b/i;
      async function tryFetch(u, jar) {
        const r = await erpFetch(u, { jar });
        if (r.netError || r.status !== 200) return null;
        const html = r.buf.toString('utf8');
        if (/id="login-form"/.test(html)) return { loggedOut: true };
        if (!marker.test(html)) return null;
        return { html, url: u, cookies: r.jar };
      }
      if (knownUrl) {
        const hit = await tryFetch(knownUrl, cookies);
        if (hit) return res.json({ ...hit, cookies: hit.cookies || cookies });
      }
      // discover: dashboard -> scan links
      const dash = await erpFetch(ERP_LOGIN_PAGE, { jar: cookies });
      if (dash.netError) return res.status(502).json({ error: dash.netError });
      const dhtml = dash.buf.toString('utf8');
      if (/id="login-form"/.test(dhtml)) return res.json({ loggedOut: true });
      const cands = extractHrefs(dhtml)
        .map(u => ({ u, s: scoreUrl(u, kw) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);
      for (const { u } of cands) {
        const hit = await tryFetch(u, cookies);
        if (hit && hit.html) return res.json({ ...hit });
        if (hit && hit.loggedOut) return res.json({ loggedOut: true });
      }
      return res.json({ notFound: true, tried: cands.map(c => c.u) });
    }


    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'proxy error: ' + e.message });
  }
};
