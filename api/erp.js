// api/erp.js — KLU NewERP proxy (Yii2), pinned to bom1 (Mumbai) via vercel.json.
// Browser-facing actions: init / refresh / login / report.
// Shared ERP logic lives in api/_erp.js (also used by api/sync.js).

const E = require('./_erp');

module.exports = async (req, res) => {
  // probe: GET /api/erp?probe=1
  if (req.method === 'GET' && req.query && req.query.probe === '1') {
    const t0 = Date.now();
    const r = await E.erpFetch(E.ERP_BASE + '/');
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
      const r = await E.erpFetch(E.ERP_BASE + '/');
      if (r.netError) return res.status(502).json({ error: r.netError });
      const html = r.buf.toString('utf8');
      const capSrc = E.extractCaptchaSrc(html);
      const csrf = E.extractCsrf(html);
      let jar = r.jar, cap = { captchaB64: null };
      if (capSrc) {
        cap = await E.fetchCaptchaImage(capSrc, jar);
        if (cap.cookies) jar = cap.cookies;
      }
      return res.json({
        captchaB64: cap.captchaB64 || null, captchaMime: cap.captchaMime || 'image/png',
        csrf, cookies: jar, captchaError: cap.error || null,
        captchaText: await E.solveCloud(cap.captchaB64),
      });
    }

    // ---- refresh: new captcha without reloading the login page ----
    if (body.action === 'refresh') {
      const { cookies = {} } = body;
      const r = await E.erpFetch(E.ERP_BASE + '/index.php?r=site/captcha&refresh=1',
        { jar: cookies, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (r.netError) return res.status(502).json({ error: r.netError });
      let url = null;
      try { url = JSON.parse(r.buf.toString('utf8')).url; } catch {}
      if (url) {
        if (url.startsWith('/')) url = E.ERP_BASE + url;
        else if (!url.startsWith('http')) url = E.ERP_BASE + '/' + url;
      }
      if (!url) return res.status(502).json({ error: 'captcha refresh failed' });
      const cap = await E.fetchCaptchaImage(url, r.jar);
      if (cap.error) return res.status(502).json({ error: cap.error });
      return res.json({ captchaB64: cap.captchaB64, captchaMime: cap.captchaMime, cookies: cap.cookies,
        captchaText: await E.solveCloud(cap.captchaB64) });
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
      const r = await E.erpFetch(E.ERP_BASE + '/index.php?r=site/login', {
        method: 'POST', jar: cookies, body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': E.ERP_BASE + '/' },
      });
      if (r.netError) return res.status(502).json({ error: r.netError });
      if (r.status === 302 || r.status === 301) {
        return res.json({ ok: true, cookies: r.jar, redirect: r.headers.get('location') });
      }
      const html = r.buf.toString('utf8');
      const stillLogin = /id="login-form"/.test(html);
      if (!stillLogin) return res.json({ ok: true, cookies: r.jar });
      const reason = E.loginFailReason(html);
      return res.json({ ok: false, reason, cookies: r.jar, mfaRequired: reason === 'mfa' });
    }

    // ---- report: attendance or timetable html ----
    if (body.action === 'report') {
      const { cookies = {}, kind = 'attendance' } = body;
      try {
        if (kind === 'attendance') {
          const hit = await E.fetchAttendanceTable(cookies);
          return res.json({ ...hit, url: E.KNOWN_URLS.attendanceList });
        }
        const hit = await E.fetchTimetableTable(cookies);
        return res.json({ ...hit });
      } catch (e) {
        if (/logged out/i.test(e.message)) return res.json({ loggedOut: true });
        return res.json({ notFound: true, error: e.message });
      }
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'proxy error: ' + e.message });
  }
};
