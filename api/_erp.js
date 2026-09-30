// api/_erp.js — shared ERP client (required by api/erp.js and api/sync.js).
// Login with auto-captcha, attendance table fetch, timetable fetch,
// server-side attendance parsing. No request handling here.

const ERP_BASE = 'https://newerp.kluniversity.in';
const ERP_LOGIN_PAGE = ERP_BASE + '/';
const ERP_LOGIN_POST = ERP_BASE + '/index.php?r=site/login';
const ERP_CAPTCHA_REFRESH = ERP_BASE + '/index.php?r=site/captcha&refresh=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const KNOWN_URLS = {
  attendance: ERP_BASE + '/index.php?r=studentattendance%2Fstudentdailyattendance%2Fsearchgetinput',
  attendanceList: ERP_BASE + '/index.php?r=studentattendance%2Fstudentdailyattendance%2Fcourselist',
  timetable: ERP_BASE + '/index.php?r=timetables%2Funiversitymasteracademictimetableview%2Findexstudentindisearch',
};

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
async function fetchCaptchaImage(capUrl, jar) {
  const c = await erpFetch(capUrl, { jar });
  if (c.netError || c.status !== 200) return { error: 'captcha fetch failed' };
  return {
    captchaB64: c.buf.toString('base64'),
    captchaMime: c.headers.get('content-type') || 'image/png',
    cookies: c.jar,
  };
}

// ---- login with automatic captcha solving (retries with fresh captchas) ----
async function erpLogin(uid, password, maxAttempts = 6) {
  if (!process.env.SOLVER_URL) throw new Error('captcha solver not configured');
  const init = await erpFetch(ERP_LOGIN_PAGE);
  if (init.netError) throw new Error(init.netError);
  let html = init.buf.toString('utf8');
  let csrf = extractCsrf(html);
  let jar = init.jar;
  for (let a = 0; a < maxAttempts; a++) {
    let captchaText = '';
    const capSrc = extractCaptchaSrc(html);
    if (capSrc) {
      const cap = await fetchCaptchaImage(capSrc, jar);
      if (cap.cookies) jar = cap.cookies;
      if (cap.captchaB64) captchaText = await solveCloud(cap.captchaB64);
    }
    if (!captchaText || captchaText.length < 4) {
      // solver missed: refresh captcha and solve the fresh image directly
      const rf = await erpFetch(ERP_CAPTCHA_REFRESH, { jar, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!rf.netError && rf.status === 200) {
        try {
          const u = absUrl(JSON.parse(rf.buf.toString('utf8')).url);
          const cap = await fetchCaptchaImage(u, rf.jar);
          if (cap.cookies) jar = cap.cookies;
          if (cap.captchaB64) captchaText = await solveCloud(cap.captchaB64);
        } catch {}
      }
    }
    if (!captchaText || captchaText.length < 4) {
      // still no usable guess: reload the login page and try again
      const re = await erpFetch(ERP_LOGIN_PAGE, { jar });
      if (!re.netError && re.status === 200) {
        html = re.buf.toString('utf8');
        csrf = extractCsrf(html) || csrf;
        jar = re.jar;
      }
      continue;
    }
    const params = new URLSearchParams({
      _csrf: csrf, 'LoginForm[username]': uid,
      'LoginForm[password]': password, 'LoginForm[captcha]': captchaText,
    });
    const r = await erpFetch(ERP_LOGIN_POST, { method: 'POST', jar, body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': ERP_LOGIN_PAGE } });
    if (r.netError) throw new Error(r.netError);
    jar = r.jar;
    if (r.status === 302) return { cookies: jar }; // success
    html = r.buf.toString('utf8');
    if (/id="login-form"/.test(html)) {
      const reason = loginFailReason(html);
      if (reason === 'creds') throw new Error('erp rejected id/password');
      if (reason === 'mfa') throw new Error('erp account needs mfa authenticator code');
      csrf = extractCsrf(html) || csrf; // wrong captcha guess -> retry fresh
      continue;
    }
    return { cookies: jar }; // landed past the login form
  }
  throw new Error('erp login failed after retries');
}

// ---- attendance: search page gives CSRF, courselist AJAX action gives the table ----
async function fetchAttendanceTable(cookies) {
  const page = await erpFetch(KNOWN_URLS.attendance, { jar: cookies });
  if (page.netError || page.status !== 200) throw new Error('attendance search page unreachable');
  let html = page.buf.toString('utf8');
  if (/id="login-form"/.test(html)) throw new Error('logged out');
  const csrf = extractCsrf(html);
  if (!csrf) throw new Error('no csrf on attendance page');
  const yearSel = (html.match(/name="DynamicModel\[academicyear\]"[\s\S]*?<\/select>/) || [''])[0];
  const yearVal = (yearSel.match(/<option value="(\d+)">/) || [])[1] || '29';
  const semSel = (html.match(/name="DynamicModel\[semesterid\]"[\s\S]*?<\/select>/) || [''])[0];
  const semVal = (semSel.match(/<option value="1">/) ? '1'
    : (semSel.match(/<option value="(\d+)">/) || [])[1]) || '1';
  const params = new URLSearchParams({
    _csrf: csrf, 'DynamicModel[academicyear]': yearVal, 'DynamicModel[semesterid]': semVal });
  const r = await erpFetch(KNOWN_URLS.attendanceList, { method: 'POST', jar: page.jar,
    body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': KNOWN_URLS.attendance, 'X-Requested-With': 'XMLHttpRequest' } });
  if (r.netError || r.status !== 200) throw new Error('courselist request failed');
  html = r.buf.toString('utf8');
  if (/id="login-form"/.test(html)) throw new Error('logged out');
  if (!/conducted/i.test(html)) throw new Error('no attendance data in response');
  return { html, cookies: r.jar };
}

// ---- timetable: discover the AJAX data action from the search page's scripts ----
function discoverAjaxUrls(searchHtml, hint) {
  const urls = new Set();
  for (const m of searchHtml.matchAll(/url\s*:\s*['"]([^'"]+)['"]/gi)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (!/^https?:/.test(u)) u = u.startsWith('/') ? ERP_BASE + u : ERP_BASE + '/' + u;
    if (u.includes('index.php?r=') && hint.test(u)) urls.add(u);
  }
  return [...urls];
}
async function fetchTimetableTable(cookies) {
  const page = await erpFetch(KNOWN_URLS.timetable, { jar: cookies });
  if (page.netError || page.status !== 200) throw new Error('timetable search page unreachable');
  let html = page.buf.toString('utf8');
  if (/id="login-form"/.test(html)) throw new Error('logged out');
  const csrf = extractCsrf(html);
  const cands = discoverAjaxUrls(html, /timetable/i);
  // also try posting back to the search page itself
  const targets = [...cands, KNOWN_URLS.timetable];
  const params = new URLSearchParams({ _csrf: csrf || '' });
  // include any select fields with their first real option selected
  for (const m of html.matchAll(/<select[^>]+name="([^"]+)"[\s\S]*?<\/select>/gi)) {
    const name = m[1], sel = m[0];
    const opt = sel.match(/<option value="(\d+)">/);
    if (opt) params.set(name, opt[1]);
  }
  for (const u of targets) {
    const r = await erpFetch(u, { method: 'POST', jar: page.jar, body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': KNOWN_URLS.timetable, 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.netError || r.status !== 200) continue;
    const rh = r.buf.toString('utf8');
    if (/id="login-form"/.test(rh)) throw new Error('logged out');
    if (/monday|tuesday|wednesday/i.test(rh) && /<table/i.test(rh))
      return { html: rh, cookies: r.jar, url: u };
  }
  throw new Error('timetable data endpoint not found');
}

// ---- server-side parse of the courselist table ----
// one row per course-component: Coursecode | Coursedesc | Ltps | ... |
// Total Conducted | Total Attended | ... | Tcbr | Percentage
function parseAttendanceTable(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  let best = null, bestScore = 0;
  for (const t of tables) {
    const txt = t.toLowerCase();
    let s = 0;
    if (/course\s*code/.test(txt)) s += 4;
    if (/\bltps\b/.test(txt)) s += 4;
    if (/total conducted/.test(txt)) s += 3;
    if (/total attended/.test(txt)) s += 3;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  if (!best || bestScore < 8) throw new Error('attendance table not found');
  const cellText = c => c.replace(/<[^>]+>/g, '').trim();
  const rows = [...best.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => cellText(x[1])));
  if (!rows.length) throw new Error('no rows in attendance table');
  const head = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ' '));
  const col = re => head.findIndex(h => re.test(h));
  const iCode = col(/course\s*code/), iDesc = col(/course\s*desc/),
        iLtps = col(/^ltps$/), iCond = col(/total conducted/),
        iAtt = col(/total attended/), iTcbr = col(/^tcbr$/), iPct = col(/percentage/);
  if (iCode < 0 || iLtps < 0 || iCond < 0 || iAtt < 0) throw new Error('attendance columns not recognized');
  const num = v => { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  const byCode = {};
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const code = cells[iCode] || '', lt = (cells[iLtps] || '').toUpperCase();
    if (!code || !/^[LTPS]$/.test(lt)) continue;
    const desc = iDesc >= 0 ? cells[iDesc] : '';
    if (!byCode[code]) byCode[code] = { code, name: desc,
      comp: { L: { cond: 0, att: 0 }, T: { cond: 0, att: 0 }, P: { cond: 0, att: 0 }, S: { cond: 0, att: 0 } },
      tcbr: 0, erp: {} };
    const s = byCode[code];
    s.comp[lt].cond += num(cells[iCond]);
    s.comp[lt].att += num(cells[iAtt]);
    if (iTcbr >= 0) s.tcbr = Math.max(s.tcbr, num(cells[iTcbr]));
    if (iPct >= 0) s.erp[lt] = num(cells[iPct]);
    if (desc && desc.length > s.name.length) s.name = desc;
  }
  const subs = Object.values(byCode).map(s => ({ code: s.code, name: s.name,
    tcbr: s.tcbr, erp: s.erp, comp: ['L', 'T', 'P', 'S'].map(k => s.comp[k]) }));
  if (!subs.length) throw new Error('no subject rows parsed');
  return subs;
}

module.exports = {
  ERP_BASE, KNOWN_URLS, erpFetch, erpLogin, solveCloud,
  fetchAttendanceTable, fetchTimetableTable, parseAttendanceTable,
  extractCsrf, extractCaptchaSrc, fetchCaptchaImage, loginFailReason,
};
