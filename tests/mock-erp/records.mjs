/**
 * The mock ERP's on-demand pages: internals (form, list, per-component marks), exam
 * rooms, mid-term papers, profile, bus seat, counselling diary, dues, the semester fee
 * ledger and circulars. Shapes follow the real ERP's Yii2 GridViews (headers, links,
 * the top bar's NAME / Roll No / Department); every value is synthetic.
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The real ERP's top bar and menu, which every page carries. */
function chrome(user, name, body) {
  return `<!DOCTYPE html><html><head><meta name="csrf-token" content="x"></head><body>
<ul class="navbar-nav navbar-right nav"><li style="font-size:12px;"><div><b>NAME: </b></div><div>${esc(name)}</div></li><li><div><b>Roll No: </b></div><div> ${user}</div></li><li><div><b>Department: </b></div><div>1073 - KLVZA - Department of computer science and Engineering -1</div></li></ul>
<ul class="sidebar-menu"><li><a href="/index.php?r=feepayments%2Ffeereports%2Fstudent_fee_dues&id=ledger-${user}">&raquo; My SEM Fee Structure</a></li></ul>
<div class="content-wrapper">${body}</div></body></html>`;
}

function grid(headers, rows) {
  const head = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? rows.map((r, i) => `<tr data-key="${i}">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}"><div class="empty">No results found.</div></td></tr>`;
  return `<div class="summary">Showing <b>1-${rows.length}</b> of <b>${rows.length}</b> items.</div><table class="table table-striped table-bordered">${head}<tbody>${body}</tbody></table>`;
}

const NAMES = { '9900000001': 'TEST STUDENT ONE', '9900000002': 'TEST STUDENT TWO' };

/** Components per course: [name, kind, marks out of 100 or null for "not marked yet"]. */
const COMPONENTS = [
  ['Mid-Term Examination (Descriptive)', 'summative', [12, 14, 9, 13, 15, 11]],
  ['Practical Continuous Evaluation', 'formative', [15, 16, 14, 17, 15, 16]],
  ['MOOCs Evaluation (Certificate + Test)', 'summative', null],
];

function internalsForm(csrf, years, semesters) {
  return `<form id="acy_sem_form_stude" method="post"><input type="hidden" name="_csrf" value="${csrf}">
<select name="DynamicModel[academicyear]"><option value="">Select Academic Year</option>${years.map(([id, l]) => `<option value="${id}">${l}</option>`).join('')}</select>
<select name="DynamicModel[semester]"><option value="">Select Semester</option>${semesters.map(([id, l]) => `<option value="${id}">${l}</option>`).join('')}</select></form>`;
}

function internalsList(term, yearLabel, semLabel) {
  const rows = (term?.courses ?? []).map((c, i) => [
    i + 1,
    yearLabel,
    semLabel,
    c.code,
    c.title.toUpperCase(),
    COMPONENTS.map(
      ([name, kind], k) =>
        `<br><a class="crudjax3" href="/index.php?r=examsection%2Fexamstudentcourseinternal${kind}${kind === 'summative' ? 'qpwise' : 'cowise'}marksinfo%2Findex_student_marks&amp;id=${c.code}~${k}">${name}</a>`,
    ).join(''),
  ]);
  return grid(['#', 'Academic Year', 'Semester', 'Course Code', 'course Name', 'Evaluation Components'], rows);
}

function componentPage(id, user) {
  const [code, k] = String(id).split('~');
  const [name, kind, parts] = COMPONENTS[Number(k)] ?? COMPONENTS[0];
  const labels = parts ? parts.map((_, i) => (kind === 'formative' ? `Co${i + 1}` : String(i + 1))) : ['1', '2', '3', '4', '5', '6'];
  const headers = ['Sno', 'Coursecode', 'Coursedesc', 'Remarks', 'Student Uniid', ...labels, 'Max Marks', 'Weight', 'Total Marks', 'Weighted Marks'];
  const title = `<h4>Student ${name} ${kind === 'summative' ? 'Qp Wise' : ''} Marks</h4>`;
  if (!parts) return title + grid(headers, []);
  const total = parts.reduce((a, b) => a + b, 0) + 2 * Number(k);
  const weight = kind === 'summative' ? 20 : 15;
  return title + grid(headers, [[1, code, 'COURSE', '', user, ...parts, 100, weight, total, ((total * weight) / 100).toFixed(1)]]);
}

const PAPERS = [
  ['24CS2201', 'DESIGN AND ANALYSIS OF ALGORITHMS'],
  ['24CS2203', 'OPERATING SYSTEMS'],
];

function paperList() {
  const rows = PAPERS.map(([code, name], i) => [
    i + 1,
    code,
    name,
    '2026-2027',
    'Even Sem',
    2,
    'sem-in',
    'Mid-Term Examination (Descriptive)',
    1,
    `<a href="/index.php?r=studentinfo%2Fstudentendexamresult%2Fview_my_booklet&amp;id=${code}">Booklet</a>`,
  ]);
  return `<h4>SEM END COURSE RESULT</h4>${grid(['#', 'Course Code', 'COurse Name', 'Academic Year', 'Semester', 'Study Year', 'Type', 'Exam', 'Eval No', 'View Booklet'], rows)}`;
}

function bookletPage(code) {
  const q = [
    ['1.A', 5, code === '24CS2201' ? 4 : 3],
    ['1.B', 7, 6.5],
    ['2.A', 5, 2.5],
    ['2.B', 7, 5],
  ];
  return `<div id="marktable"><table class="table"><thead><tr><th>Question No's</th><th>Max. Marks</th><th>Obtained Marks</th><th>Remarks Marks</th><th>Evaluator Name</th><th>Evaluator Uniid</th></tr></thead><tbody>${q
    .map(([n, m, g]) => `<tr><td>${n}</td><td>${m}</td><td>${g}</td><td></td><td>EVALUATOR</td><td>1000</td></tr>`)
    .join('')}</tbody></table></div>`;
}

function profilePage() {
  const row = (k, v) => `<tr><td> ${k} </td><td><label>: ${v}</label></td></tr>`;
  return `<h4 class="redflag">Student Profile</h4><table class="table mb-1"><tbody>${row('Admission Date', '04-08-2024')}${row('Date Of Birth', '01-01-2006')}${row('Blood Group', 'B+ve')}${row('Regulation', 'R24')}${row('Program', 'UG')}</tbody></table>`;
}

function busPage(user) {
  return grid(
    ['#', 'Ref.No', 'Campus', 'Academic Year', 'Semester', 'University Id', 'Name', 'Bus Name', 'Bus Desc', 'Seat No', 'Bus Shift', 'Route-Stage', 'Total Bus/Stage Fee', 'Fee Collection Type'],
    [
      [1, 101, 'KLVZA', '2025-2026', 'Odd Sem', user, 'TEST', '212', 'CAMPUS ROUTE NO 3', '18', 'General Shift', 'CAMPUS ROUTE NO 3 (BENZ CIRCLE) - BENZ CIRCLE', 'Rs.42000', 'Yearly(10 Months)'],
      [2, 202, 'KLVZA', '2026-2027', 'Odd Sem', user, 'TEST', '214', 'CAMPUS ROUTE NO 3', '22', 'General Shift', 'CAMPUS ROUTE NO 3 (BENZ CIRCLE) - BENZ CIRCLE', 'Rs.46000', 'Yearly(10 Months)'],
    ],
  );
}

function counsellingPage(user) {
  return grid(
    ['#', 'Ref.No', 'Academic Year', 'Semester Name', 'Employee Name', 'Teacher Mobileno', 'Employee Id', 'University Id', 'Student Year Of Study', 'Counselling Category', 'Interaction With', 'Student / Parent Problem if any', 'Counsellor Remarks', 'Date of Counselling'],
    [
      [1, 9001, '2026-2027', 'Even Sem', 'TEST COUNSELLOR', '', 5001, user, 2, 'Academic', 'Student', '-', 'Discussed the mid-term plan and the lab record.', '2026-11-10'],
      [2, 9002, '2026-2027', 'Even Sem', 'TEST COUNSELLOR', '', 5001, user, 2, 'Academic', 'Parent', '-', 'Called a parent about attendance in Computer Networks.', '2026-11-12'],
    ],
  );
}

const DUES_HEAD = ['#', 'Sem Fee Due', 'Hostel Fee Due', 'Transport Fee Due', 'Reregistration Fee Due', 'Betterment Fee Due', 'Certification Fee Due', 'Detained Fee Due', 'Fine Due'];

function duesPage() {
  return `<h4>Student Dues/Fines Info</h4>${grid(DUES_HEAD, [[1, 0, 0, 0, 0, 0, 0, 0, 0]])}`;
}

function ledgerPage() {
  return `<h4>Student Sem Fee Due Details</h4>${grid(
    ['#', 'Academic Year', 'Year Of Study', 'Semester', 'Total Amount Without Concession', 'Total Concession Amount', 'To Pay', 'Paid', 'Due Payment', 'Receipt Details'],
    [
      [1, '2025-2026', 1, 1, 150000, 10000, 140000, 140000, 0, 'Order Date:2025-07-04::Receipt No:KL-1000:1::Transaction Amount:140000'],
      [2, '2026-2027', 2, 2, 150000, 5000, 145000, 100000, 45000, 'Order Date:2026-11-02::Receipt No:SBI:P-96539:T-1793500001::Transaction Amount:45000<br>,Order Date:2026-10-28::Receipt No:HDF:P-96539:T-1793500002::Transaction Amount:55000'],
    ],
  )}${grid(DUES_HEAD, [[1, 45000, 0, 0, 0, 0, 0, 0, -1000]])}`;
}

const CIRCULARS = [
  ['50003', 'Mid-term examination schedule for Even Sem 2026-27 – Reg.', '2026-11-16 10:12:00', true],
  ['50002', 'Campus closed on account of a public holiday – Reg.', '2026-11-11 09:30:00', false],
  ['50001', 'Hackathon registrations open – Reg.', '2026-10-29 17:05:00', true],
];

function circularsPage() {
  return grid(
    ['#', 'CircularID', 'Circular Subject', 'Circular Note', 'Createon', ''],
    CIRCULARS.map(([id, subject, at, doc], i) => [
      i + 1,
      id,
      subject,
      '',
      at,
      doc ? `<a href="/index.php?r=registraroffice%2Fregistrarofficecircularsvisibilitylistinfo%2Fcircular_documents&amp;id=${id}-${Math.random().toString(36).slice(2, 8)}">View</a>` : '',
    ]),
  );
}

/** The smallest valid one-page PDF. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

/**
 * Handles one of the on-demand routes, or returns false. `term(ay, sem)` gives the
 * student's term data; `years`/`semesters` are the form's option lists.
 */
export async function handleRecords({ r, req, url, s, user, st, readBody, send, failing, years, semesters }) {
  const name = NAMES[user] ?? 'TEST STUDENT';
  const ok = (html) => (send(200, chrome(user, name, html)), true);

  if (r === 'studentinfo/studentendexamresult/getstudentinternalmarks') {
    if (failing('internals')) return send(500, 'Internal Server Error'), true;
    if (req.method === 'GET') return ok(`<h4>Course Internals</h4>${internalsForm(s.csrf, years, semesters)}`);
    const form = new URLSearchParams(await readBody());
    const ay = form.get('DynamicModel[academicyear]');
    const sem = form.get('DynamicModel[semester]');
    const yl = years.find(([id]) => id === ay)?.[1] ?? '';
    const sl = semesters.find(([id]) => id === sem)?.[1] ?? '';
    return ok(internalsList(st.terms[`${ay}:${sem}`], yl, sl));
  }
  if (/^examsection\/examstudentcourseinternal(summative|formative)[a-z]*\/index_student_marks$/.test(r)) {
    return ok(componentPage(url.searchParams.get('id'), user));
  }
  if (r === 'examsection/exam-invigilator-student-room-allotment-info/stud_my_seating_plan') {
    return ok(
      `<h4>Exam Student Room Allotment</h4>${grid(
        ['#', 'Ref.Id', 'Exam Date', 'Exam Type', 'Exam Slot', 'Student University Id', 'Course Code', 'Room No', 'Createon'],
        user === '9900000001' ? [[1, 1, '2026-11-24', 'Mid-Term', 'FN', user, '24CS2201', 'C-204', '2026-11-15']] : [],
      )}`,
    );
  }
  if (r === 'studentinfo/studentendexamresult/view_my_answer_scripts') return ok(paperList());
  if (r === 'studentinfo/studentendexamresult/view_my_booklet') return send(200, bookletPage(url.searchParams.get('id'))), true;
  if (r === 'studentinfo/studentprofileinfo/viewprofileindi') return ok(profilePage());
  if (r === 'transport/transport-bus-occupancy-info/student-bus-seat-info') return ok(busPage(user));
  if (r === 'studentinfo/studentcouncellingdairy/counselling_diary_stuview') return ok(counsellingPage(user));
  if (r === 'nodues/noduesstudentdocumentsinfo/my_dues_fines_student') return ok(duesPage());
  if (r === 'feepayments/feereports/student_fee_dues') return ok(ledgerPage());
  if (r === 'registraroffice/registrarofficecircularsvisibilitylistinfo/tab_index_personal') return ok(circularsPage());
  if (r === 'registraroffice/registrarofficecircularsvisibilitylistinfo/circular_documents') {
    return send(200, PDF, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="circular.pdf"' }), true;
  }
  return false;
}
