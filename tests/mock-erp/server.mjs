/**
 * A local stand-in for newerp.kluniversity.in and the captcha solver, for
 * tests only. It mirrors the real login flow (302 to /index.php, Yii2 form
 * with per-field .help-block errors, CSRF + PHPSESSID cookies, session-bound
 * captcha) and serves the attendance / timetable / internals / results /
 * CGPA pages in the shapes Attenly's parsers read.
 *
 * Students and their numbers below are synthetic test data.
 *
 *   node tests/mock-erp/server.mjs [port]
 *   POST /__mock/control  { ...knobs }   adjust behaviour from tests
 *   POST /solve           { image }      the "solver": reads the SVG captcha
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] ?? process.env.MOCK_ERP_PORT ?? 4100);

const knobs = {
  solverWrong: 0, // next N solves return a wrong answer
  solverDown: false,
  rateLimitLogins: false,
  failDatasets: [], // e.g. ['timetable']
  loginDelayMs: 0,
  // The course list answers 500 for a term with rows unless the request comes from the filter page.
  strictReferer: false,
  // Like the real ERP on 3 Nov 2026: the course list crashes in its database (a
  // missing view behind a per-course stored procedure) for any term with courses.
  attendanceDbDown: false,
};

const students = new Map(
  Object.entries({
    '9900000001': { password: 'kl-test-pass', ...studentA() },
    '9900000002': { password: 'other-pass-2', ...studentB() },
  }),
);

const sessions = new Map(); // PHPSESSID -> { csrf, captcha, user }
const counters = { logins: 0, captchas: 0, solves: 0 };

// Academic years use internal ids like the real ERP ("30" = 2026-2027), listed oldest first.
const YEARS = [
  ['29', '2025-2026'],
  ['30', '2026-2027'],
];
const SEMESTERS = [
  ['1', 'Odd Sem'],
  ['2', 'Even Sem'],
];

// Student A: the current term is Even Sem 2026-2027 (30:2); an older Odd Sem 2025-2026 (29:1) too.
function studentA() {
  return {
    terms: { '30:2': currentA(), '29:1': olderA() },
    grades: gradesA(),
  };
}

function olderA() {
  return {
    courses: [
      { code: '24CS1205', title: 'Computer Organization', L: [40, 44], P: [20, 22] },
      { code: '24MT1105', title: 'Numerical Methods', L: [36, 42], T: [12, 12] },
    ],
    timetable: {
      Monday: ['24CS1205-L', '24MT1105-L', '', ''],
      Thursday: ['24MT1105-T', '24CS1205-P', '24CS1205-P', ''],
    },
  };
}

function currentA() {
  return {
    courses: [
      { code: '24CS2201', title: 'Design and Analysis of Algorithms', L: [34, 40], T: [10, 12], P: [18, 22] },
      { code: '24CS2202', title: 'Database Management Systems', L: [36, 38], P: [20, 22] },
      { code: '24CS2203', title: 'Operating Systems', L: [29, 38], T: [9, 11] },
      { code: '24CS2204', title: 'Computer Networks', L: [25, 36], P: [12, 18] },
      { code: '24MT2005', title: 'Probability and Statistics', L: [33, 36], T: [11, 12] },
      { code: '24UC2203', title: 'Technical Skills for Engineers', S: [14, 16] },
    ],
    timetable: {
      Monday: ['24CS2201-L', '24CS2202-L', '24MT2005-L', '', '24CS2204-P', '24CS2204-P'],
      Tuesday: ['24CS2203-L', '24CS2201-T', '24CS2202-P', '24CS2202-P', '24MT2005-T', ''],
      Wednesday: ['24CS2204-L', '24CS2201-L', '24CS2203-L', '', '24UC2203-S', '24UC2203-S'],
      Thursday: ['24MT2005-L', '24CS2203-T', '24CS2201-P', '24CS2201-P', '24CS2204-L', ''],
      Friday: ['24CS2202-L', '24CS2201-L', '24CS2203-L', '24MT2005-L', '', ''],
      Saturday: ['24CS2204-L', '24CS2202-L', '', '', '', ''],
    },
  };
}

function gradesA() {
  return [
      ['2024-2025', 'Odd Sem', '24CS1101', 'Problem Solving with C', 'A+', 9, 4],
      ['2024-2025', 'Odd Sem', '24MT1001', 'Linear Algebra and Calculus', 'A', 8, 4],
      ['2024-2025', 'Odd Sem', '24EC1101', 'Digital Logic Design', 'O', 10, 3],
      ['2024-2025', 'Even Sem', '24CS1202', 'Data Structures', 'A', 8, 4],
      ['2024-2025', 'Even Sem', '24CS1203', 'Object Oriented Programming', 'A+', 9, 4],
      ['2024-2025', 'Even Sem', '24MT1102', 'Discrete Mathematics', 'B+', 7, 3],
  ];
}

// Student B: only Odd Sem 2026-2027 has attendance; even of the newest year is empty.
function studentB() {
  return {
    terms: { '30:1': currentB() },
    grades: [],
  };
}

function currentB() {
  return {
    courses: [
      { code: '24EE2101', title: 'Electrical Machines', L: [30, 34], P: [14, 16] },
      { code: '24EE2102', title: 'Signals and Systems', L: [31, 36], T: [10, 12] },
    ],
    timetable: {
      Monday: ['24EE2101-L', '24EE2102-L', '', ''],
      Wednesday: ['24EE2102-T', '24EE2101-P', '24EE2101-P', ''],
      Friday: ['24EE2101-L', '24EE2102-L', '', ''],
    },
  };
}

const PERIODS = ['P1 (09:00-09:50)', 'P2 (09:50-10:40)', 'P3 (11:00-11:50)', 'P4 (11:50-12:40)', 'P5 (1:40-2:30)', 'P6 (2:30-3:20)'];
const ROOMS = { L: 'C-301', T: 'C-214', P: 'Lab-4', S: 'R&D-2' };

const page = (body) => `<!DOCTYPE html><html><head><meta name="csrf-token" content="x"></head><body>${body}
<script>var ajaxRateLimitMessage = "Too many requests. Please try again in one minute.";</script></body></html>`;

function loginPage(s, errors = {}) {
  const block = (field, msg) =>
    `<div class="help-block">${msg ?? ''}</div>`;
  return page(`<div class="site-login"><form id="login-form" action="/index.php?r=site%2Flogin" method="post">
<input type="hidden" name="_csrf" value="${s.csrf}">
<div class="form-group"><div class="floating-label field-loginFormUserNameID required"><input type="text" id="loginFormUserNameID" name="LoginForm[username]">${block('u')}</div></div>
<div class="form-group"><div class="floating-label field-loginFormPasswordID required${errors.password ? ' has-error' : ''}"><input type="password" id="loginFormPasswordID" name="LoginForm[password]">${block('p', errors.password)}</div></div>
<div class="form-group field-loginFormCaptcha${errors.captcha ? ' has-error' : ''}"><img id="loginFormCaptcha-image" src="/index.php?r=site%2Fcaptcha&amp;v=${randomBytes(6).toString('hex')}" alt=""><input type="text" id="loginFormCaptcha" name="LoginForm[captcha]">${block('c', errors.captcha)}</div>
<div class="form-group field-loginFormQRCodeID"><input type="text" id="loginFormQRCodeID" name="LoginForm[qr_code]" style="visibility:hidden"><div class="help-block"></div></div>
<button type="submit" name="login-button">Login</button></form></div>`);
}

function captchaSvg(text) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50" data-answer="${text}"><text x="10" y="34" font-family="Georgia" font-size="28" font-weight="700" fill="#ea4c89" letter-spacing="2">${text}</text></svg>`;
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function session(req, res) {
  let id = cookies(req).PHPSESSID;
  if (!id || !sessions.has(id)) {
    id = randomBytes(12).toString('hex');
    sessions.set(id, { csrf: randomBytes(16).toString('hex'), captcha: null, user: null, fails: 0 });
    res.setHeader('Set-Cookie', [`SERVERID=mock1; Path=/`, `PHPSESSID=${id}; Path=/; HttpOnly`, `_csrf=${randomBytes(8).toString('hex')}; Path=/; HttpOnly`]);
  }
  return sessions.get(id);
}

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=UTF-8', ...headers });
  res.end(html);
}

const COURSELIST_HEAD = '<thead><tr><th>#</th><th>Coursecode</th><th>Coursedesc</th><th>Ltps</th><th>Section</th><th>Total Conducted</th><th>Total Attended</th><th>Percentage</th><th>Attendance Register</th></tr></thead>';

// A term without attendance gets Yii's empty grid, headers and all.
function attendanceTable(term) {
  if (!term) return '<table class="table">' + COURSELIST_HEAD + '<tbody><tr><td colspan="9"><div class="empty">No results found.</div></td></tr></tbody></table>';
  let rows = '';
  let n = 1;
  for (const c of term.courses) {
    for (const k of ['L', 'T', 'P', 'S']) {
      if (!c[k]) continue;
      const [att, cond] = c[k];
      // The register link carries what the register page needs: course, component, counts.
      const id = encodeURIComponent(`${c.code}-${k}-${att}-${cond}`);
      rows += `<tr data-key="${n}"><td>${n++}</td><td>${c.code}</td><td>${c.title}</td><td>${k}</td><td>S-12</td><td>${cond}</td><td>${att}</td><td>${Math.ceil((att / cond) * 100)}</td><td><a href="/index.php?r=studentattendance%2Fstudentdailyattendance%2Fgetindicregister&amp;id=${id}">Register</a></td></tr>`;
    }
  }
  return `<table class="table">${COURSELIST_HEAD}<tbody>${rows}</tbody></table>`;
}

/** Class days for a register, weekdays only, oldest first: "03/08/26 H 1". */
function classDays(n) {
  const out = [];
  const d = new Date(Date.UTC(2026, 7, 3)); // Mon 3 Aug 2026
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yy = String(d.getUTCFullYear()).slice(2);
      out.push(`${dd}/${mm}/${yy} H ${(out.length % 8) + 1}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A course's attendance register: fixed columns, then one column per class (P / A). */
function registerTable(id) {
  const m = /^(.+)-([LTPS])-(\d+)-(\d+)$/.exec(id ?? '');
  if (!m) return page('<p>No register.</p>');
  const [, code, k, attRaw, condRaw] = m;
  const att = Number(attRaw);
  const cond = Number(condRaw);
  const cols = classDays(cond);
  const marks = cols.map((_, i) => (i < cond - att ? 'A' : 'P'));
  const fixed = [
    ['Coursecode', code],
    ['Coursedesc', `${code} (test course)`],
    ['Student Uni Id', '9900000001'],
    ['Student Name', 'TEST STUDENT'],
    ['Ltps', k],
    ['Section', 'S-12'],
    ['Year', '2026-2027'],
    ['Semester', 'Even Sem'],
    ['Fr Date', 'N'],
    ['Total Conducted', String(cond)],
    ['Total Attended', String(att)],
    ['Total Absent', String(cond - att)],
    ['Tcbr', '0'],
    ['Percentage', `${Math.ceil((att / cond) * 100)}%`],
    ['Weighted Percentage', '50%'],
  ];
  const head = fixed.map(([h]) => `<th>${h}</th>`).join('') + cols.map((c) => `<th>${c}</th>`).join('');
  const cells = fixed.map(([, v]) => `<td>${v}</td>`).join('') + marks.map((v) => `<td>${v}</td>`).join('');
  return page(
    `<h4 class="redflag">Course Attendance register</h4><div class="card"><div class="card-header">Course Code: <strong>${code} (test course)</strong> - <strong>${k}</strong></div>` +
      `<table class="table table-striped table-bordered"><thead><tr>${head}</tr></thead><tbody><tr data-key="0">${cells}</tr></tbody></table></div>`,
  );
}

function timetableTable(term) {
  if (!term) return '<table class="table"><tbody><tr><td colspan="7"><div class="empty">No results found.</div></td></tr></tbody></table>';
  const head = `<tr><th>Day</th>${PERIODS.map((p) => `<th>${p}</th>`).join('')}</tr>`;
  const body = Object.entries(term.timetable)
    .map(([day, cells]) => {
      const tds = PERIODS.map((_, i) => {
        const c = cells[i] ?? '';
        if (!c) return '<td>-</td>';
        const [code, k] = c.split('-');
        return `<td>${code}-${k} - S-12 -RoomNo-${ROOMS[k]}</td>`;
      }).join('');
      return `<tr><td>${day}</td>${tds}</tr>`;
    })
    .join('');
  return `<table class="table table-bordered">${head}${body}</table>`;
}

function cgpaTable(st) {
  const rows = st.grades
    .map((g, i) => `<tr><td>${i + 1}</td><td>KLU</td><td>B.Tech</td><td>${g[2]}</td><td>${g[3]}</td><td>${g[4]}</td><td>${g[5]}</td><td>${g[6]}</td><td>P</td><td>${g[0]}</td><td>${g[1]}</td></tr>`)
    .join('');
  return `<table class="table"><thead><tr><th>#</th><th>University</th><th>Program</th><th>Course Code</th><th>Course Name</th><th>Grade</th><th>Grade Point</th><th>Credits</th><th>Status</th><th>Academic Year</th><th>Semester</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function internalsTable(term) {
  if (!term) return '<table class="table"><tbody></tbody></table>';
  const rows = term.courses
    .map((c, i) => `<tr><td>${i + 1}</td><td>2026-2027</td><td>Odd Sem</td><td>${c.code}</td><td>${c.title}</td><td>${18 + (i % 5)}</td><td>${8 + (i % 3)}</td></tr>`)
    .join('');
  return `<table class="table"><thead><tr><th>#</th><th>Academic Year</th><th>Semester</th><th>Course Code</th><th>Course Name</th><th>Mid Term</th><th>Assignment</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Synthetic online fee orders, in the ERP's column order. */
const FEE_ORDERS = [
  {
    id: 'ord-1',
    no: 'SBI:P-96539:T-1793586750',
    year: '2026-2027',
    sem: 'Even Sem',
    head: 'TUITION FEE',
    sub: 'Semester-2 Tuition Fee',
    gateway: 'ePay',
    amount: 45000,
    date: '2026-11-02',
    status: 'success',
    ref: '0255910414',
  },
  {
    id: 'ord-2',
    no: 'HDF:P-96539:T-1793586629',
    year: '2026-2027',
    sem: 'Even Sem',
    head: 'TUITION FEE',
    sub: 'Semester-2 Tuition Fee',
    gateway: 'CCAVENUE',
    amount: 100000,
    date: '2026-11-02',
    status: 'success',
    ref: '114958766236',
  },
  {
    id: 'ord-3',
    no: 'HDF:P-96539:T-1791714022',
    year: '2026-2027',
    sem: 'Odd Sem',
    head: 'End Sem Exam Fee',
    sub: 'Regular Exam Fee',
    gateway: 'CCAVENUE',
    amount: 1500,
    date: '2026-10-21',
    status: 'pending',
    ref: '',
  },
];

function feeOrdersTable() {
  const head =
    '<thead><tr><th>#</th><th>Order Number</th><th>Academic Year</th><th>Semester</th><th>Pay-Study Year</th><th>Head</th><th>Sub Head</th><th>Gateway Name</th><th>Currency</th><th>Amount</th><th>Order date</th><th>Pay Status</th><th>Gateway Ref No</th><th></th></tr></thead>';
  const rows = FEE_ORDERS.map(
    (o, i) =>
      `<tr data-key="${3000000 + i}"><td>${i + 1}</td><td>${o.no}</td><td>${o.year}</td><td>${o.sem}</td><td>2</td><td>${o.head}</td><td>${o.sub}</td><td>${o.gateway}</td><td>INR</td><td>${o.amount}</td><td>${o.date}</td><td>${o.status}</td><td>${o.ref}</td><td><a href="/index.php?r=feepayments%2Fstudentfeeorderdetailsinfo%2Fview&amp;id=${o.id}">View</a> <a href="/index.php?r=feepayments%2Fstudentfeeorderdetailsinfo%2Ffee_receipt&amp;id=${o.id}">Receipt</a></td></tr>`,
  ).join('');
  return page(`<table class="table table-striped table-bordered">${head}<tbody>${rows}</tbody></table>`);
}

/** The ERP's "Online Payment Receipt" popup, in its own table layout. */
function feeReceiptPage(id) {
  const o = FEE_ORDERS.find((x) => x.id === id);
  if (!o) return page('<p>No receipt.</p>');
  return page(
    `<div class="card"><div id="printTable"><div class="card-header"><h5 class="redflag"> Online Payment Receipt </h5></div><div class="card-body overflow-auto">` +
      `<table class="table" id="t1"><tr><td><p>Univ.Reg.Number :  <b> 9900000001 </b></p><p>Name Of Candidate : <b>TEST STUDENT</b></p></td>` +
      `<td><p>Program : <b>Btech CSE</b></p><p>Mobile No : <b>9000000000</b></p></td></tr></table>` +
      `<table id="t2" class="table"><tr><th class="text-start">Receipt No : ${o.no}</th><th class="text-end">Date : ${o.date.split('-').reverse().join('-')}</th></tr></table>` +
      `<table id="t3" class="table"><tr><th>S.NO</th><th>Account Head </th><th>Amount (INR)</th></tr>` +
      `<tr><td>1</td><td>${o.head}-${o.sub}</td><td class="text-end pe-3">${o.amount}</td></tr>` +
      `<tr><td colspan="3" class="text-end pe-3"> <b> Total : ${o.amount} </b></td></tr></table>` +
      `<table id="t4" width="100%"><tr><td class="alert alert-primary">In Words : *** TEST AMOUNT RUPEES ONLY ***.</td></tr>` +
      `<tr><td>This is a Computer Generated Receipt. No signature is Required . Generated On . 2026-11-12 02:11:42</td></tr></table>` +
      `</div></div><div class="card-footer text-center"><button id="printbtn" class="btn btn-primary">Print</button></div></div>`,
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const r = url.searchParams.get('r') ?? '';

  // ---- test controls -------------------------------------------------
  if (url.pathname === '/__mock/control') {
    const b = JSON.parse((await body(req)) || '{}');
    Object.assign(knobs, b.knobs ?? {});
    if (b.bump) {
      // { bump: { id, code, k, attended: +n, conducted: +n } }
      const st = students.get(b.bump.id);
      const c = st && Object.values(st.terms)[0].courses.find((x) => x.code === b.bump.code);
      if (c && c[b.bump.k]) c[b.bump.k] = [c[b.bump.k][0] + (b.bump.attended ?? 0), c[b.bump.k][1] + (b.bump.conducted ?? 0)];
    }
    if (b.password) students.get(b.password.id).password = b.password.value;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, knobs, counters }));
  }
  if (url.pathname === '/__mock/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ knobs, counters }));
  }

  // ---- the "solver" --------------------------------------------------
  if (url.pathname === '/solve' && req.method === 'POST') {
    counters.solves++;
    if (knobs.solverDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end('{"detail":"model not loaded"}');
    }
    const { image } = JSON.parse(await body(req));
    const svg = Buffer.from(String(image).split(',')[1] ?? '', 'base64').toString('utf8');
    let text = svg.match(/data-answer="([a-z]+)"/)?.[1] ?? '';
    if (knobs.solverWrong > 0) {
      knobs.solverWrong--;
      text = text.split('').reverse().join('') + 'x';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ text }));
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // ---- the ERP -------------------------------------------------------
  if (url.pathname !== '/index.php') return send(res, 404, 'Not found');
  const s = session(req, res);

  if (r === 'site/login' && req.method === 'GET') {
    return send(res, 302, '', { Location: '/index.php' });
  }
  if (!r && req.method === 'GET') {
    if (s.user) return send(res, 200, page('<h1>Dashboard</h1>'));
    return send(res, 200, loginPage(s));
  }
  if (r === 'site/captcha') {
    counters.captchas++;
    s.captcha = randomBytes(4).toString('hex').replace(/[0-9]/g, (d) => 'abcdefghij'[d]).slice(0, 6);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(captchaSvg(s.captcha));
  }
  if (r === 'site/login' && req.method === 'POST') {
    counters.logins++;
    if (knobs.loginDelayMs) await new Promise((ok) => setTimeout(ok, knobs.loginDelayMs));
    if (knobs.rateLimitLogins) return send(res, 429, page('<p>Too many requests. Please try again in one minute.</p>'));
    const f = new URLSearchParams(await body(req));
    if (f.get('_csrf') !== s.csrf) return send(res, 400, page('<p>Bad Request: Unable to verify your data submission.</p>'));
    const st = students.get(f.get('LoginForm[username]') ?? '');
    const credsOk = Boolean(st && st.password === f.get('LoginForm[password]'));
    const captchaOk = Boolean(s.captcha && (f.get('LoginForm[captcha]') ?? '').toLowerCase() === s.captcha);
    if (credsOk && captchaOk) {
      s.user = f.get('LoginForm[username]');
      return send(res, 302, '', { Location: '/index.php?r=site%2Findex' });
    }
    return send(
      res,
      200,
      loginPage(s, {
        password: credsOk ? null : 'Incorrect username or password.',
        captcha: captchaOk ? null : 'The verification code is incorrect.',
      }),
    );
  }

  // Everything below needs a logged-in session.
  if (!s.user) return send(res, 302, '', { Location: '/index.php?r=site%2Flogin' });
  const st = students.get(s.user);
  const failing = (name) => knobs.failDatasets.includes(name);

  if (r === 'site/index') return send(res, 200, page('<h1>Dashboard</h1>'));
  if (r === 'studentattendance/studentdailyattendance/searchgetinput') {
    return send(
      res,
      200,
      page(`<form><input type="hidden" name="_csrf" value="${s.csrf}">
<select name="DynamicModel[academicyear]" id="dynamicmodel-academicyear"><option value="">Select Academic Year</option>${YEARS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
<select name="DynamicModel[semesterid]" id="dynamicmodel-semesterid"><option value="">Select Semester</option>${SEMESTERS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></form>`),
    );
  }
  if (r === 'studentattendance/studentdailyattendance/courselist') {
    if (failing('attendance')) return send(res, 500, 'Internal Server Error');
    const form = new URLSearchParams(await body(req));
    counters.courselists = (counters.courselists ?? 0) + 1;
    const term = st.terms[`${form.get('DynamicModel[academicyear]')}:${form.get('DynamicModel[semesterid]')}`];
    if (knobs.attendanceDbDown && term) {
      return send(
        res,
        500,
        String.raw`Exception (Database Exception) 'yii\db\Exception' with message 'SQLSTATE[42S02]: Base table or view not found: 1146 Table 'klerp_v2.student_daily_attendance_view' doesn't exist` +
          `\nThe SQL being executed was: CALL student_course_attendance_register( 1,2,10)'`,
      );
    }
    if (knobs.strictReferer && term && !String(req.headers.referer ?? '').includes('searchgetinput')) {
      return send(res, 500, '<html><head><title>Internal Server Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
    return send(res, 200, attendanceTable(term));
  }
  if (r === 'timetables/universitymasteracademictimetableview/individualstudenttimetableget') {
    if (failing('timetable')) return send(res, 500, 'Internal Server Error');
    const key = `${url.searchParams.get('UniversityMasterAcademicTimetableView[academicyear]')}:${url.searchParams.get('UniversityMasterAcademicTimetableView[semesterid]')}`;
    return send(res, 200, page(timetableTable(st.terms[key])));
  }
  if (r === 'studentinfo/studentendexamresult/getstudentinternalmarks') {
    if (failing('internals')) return send(res, 500, 'Internal Server Error');
    const form = new URLSearchParams(await body(req));
    return send(res, 200, internalsTable(st.terms[`${form.get('DynamicModel[academicyear]')}:${form.get('DynamicModel[semester]')}`]));
  }
  if (r === 'studentinfo/studentendexamresult/semendresult') {
    if (failing('results')) return send(res, 500, 'Internal Server Error');
    return send(res, 200, '<table><tbody></tbody></table>');
  }
  if (r === 'studentinfo/studentendexamresult/searchgetmycgpa') {
    if (failing('cgpa')) return send(res, 500, 'Internal Server Error');
    return send(res, 200, page(cgpaTable(st)));
  }
  if (r === 'studentattendance/studentdailyattendance/getindicregister') {
    if (failing('registers')) return send(res, 500, 'Internal Server Error');
    return send(res, 200, registerTable(url.searchParams.get('id')));
  }
  if (r === 'feepayments/studentfeeorderdetailsinfo/my_fee_orders') {
    if (failing('fees')) return send(res, 500, 'Internal Server Error');
    return send(res, 200, feeOrdersTable());
  }
  if (r === 'feepayments/studentfeeorderdetailsinfo/fee_receipt') {
    if (failing('fees')) return send(res, 500, 'Internal Server Error');
    return send(res, 200, feeReceiptPage(url.searchParams.get('id')));
  }
  return send(res, 404, page('<p>Page not found.</p>'));
});

server.listen(PORT, () => console.log(`mock ERP + solver on http://localhost:${PORT}`));
