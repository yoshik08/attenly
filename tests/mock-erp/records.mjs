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
/**
 * Components per course: [name, kind, column labels, marks per column (null = not marked yet), max, weight].
 * Like the real ERP, a negative mark means the question wasn't written; 0 is a scored 0.
 */
const COMPONENTS = [
  ['Mid-Term Examination (Descriptive)', 'summative', ['1 A', '1 B', '1 C', '2 A', '2 B', '2 C', '3 A', '3 B', '3 C'], [4, 5, 0, 3, 2, 1, 5, -2, 4], 45, 20],
  ['Practical Continuous Evaluation', 'formative', ['Co1', 'Co2', 'Co3', 'Co4', 'Co5', 'Co6'], [15, 16, 14, 17, 15, 16], 100, 15],
  ['MOOCs Evaluation (Certificate + Test)', 'summative', ['1', '2', '3', '4', '5', '6'], null, 100, 20],
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
  const [name, kind, labels, parts, max, weight] = COMPONENTS[Number(k)] ?? COMPONENTS[0];
  const headers = ['Sno', 'Coursecode', 'Coursedesc', 'Remarks', 'Student Uniid', ...labels, 'Max Marks', 'Weight', 'Total Marks', 'Weighted Marks'];
  const title = `<h4>Student ${name} ${kind === 'summative' ? 'Qp Wise' : ''} Marks</h4>`;
  if (!parts) return title + grid(headers, []);
  // The ERP's total counts an unwritten (negative) question as 0.
  const total = parts.reduce((a, b) => a + Math.max(0, b), 0);
  return title + grid(headers, [[1, code, 'COURSE', '', user, ...parts, max, weight, total, ((total / max) * weight).toFixed(3)]]);
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
    // Operating Systems: 2.B not written (the ERP's negative mark).
    ['2.B', 7, code === '24CS2203' ? -2 : 5],
  ];
  // The real page loads the scan with pdf.js from this address; a paper without a scan has none.
  const scan =
    code === '24CS2201'
      ? `<script>var url ="index.php?r=studentinfo/studentendexamresult/download_script_frompath&id=${Buffer.from(`mock|question_paper/${code}/scan.pdf`).toString('base64')}";</script>`
      : '';
  return `${scan}<div id="marktable"><table class="table"><thead><tr><th>Question No's</th><th>Max. Marks</th><th>Obtained Marks</th><th>Remarks Marks</th><th>Evaluator Name</th><th>Evaluator Uniid</th></tr></thead><tbody>${q
    .map(([n, m, g]) => `<tr><td>${n}</td><td>${m}</td><td>${g}</td><td></td><td>EVALUATOR</td><td>1000</td></tr>`)
    .join('')}</tbody></table></div>`;
}

/** The profile's Courses tab: a class per row (course × L/T/P/S), Title Case faculty, CAPS titles. */
const COURSE_CLASSES = [
  // Year 2 · 2026-2027 · Even Sem (the synced term)
  [2, '2026-2027', 'Even Sem', '24CS2201', 'DESIGN AND ANALYSIS OF ALGORITHMS', 'L', 'S-12', 'Ravi Kumar'],
  [2, '2026-2027', 'Even Sem', '24CS2201', 'DESIGN AND ANALYSIS OF ALGORITHMS', 'T', 'S-12', 'Ravi Kumar'],
  [2, '2026-2027', 'Even Sem', '24CS2201', 'DESIGN AND ANALYSIS OF ALGORITHMS', 'P', 'S-12-A', 'Sita Lakshmi'],
  [2, '2026-2027', 'Even Sem', '24CS2202', 'DATABASE MANAGEMENT SYSTEMS', 'L', 'S-12', 'Anil Varma'],
  [2, '2026-2027', 'Even Sem', '24CS2202', 'DATABASE MANAGEMENT SYSTEMS', 'P', 'S-12-B', 'Anil Varma'],
  [2, '2026-2027', 'Even Sem', '24CS2203', 'OPERATING SYSTEMS', 'L', 'S-12', 'Meena Rao'],
  [2, '2026-2027', 'Even Sem', '24CS2203', 'OPERATING SYSTEMS', 'T', 'S-12', 'Meena Rao'],
  [2, '2026-2027', 'Even Sem', '24UC2203', 'TECHNICAL SKILLS FOR ENGINEERS', 'S', 'S-12', 'Kiran Babu'],
  // Year 1 · 2025-2026 · Odd Sem
  [1, '2025-2026', 'Odd Sem', '24CS1101', 'PROBLEM SOLVING WITH C', 'L', 'S-30', 'Lakshmi Prasad'],
  [1, '2025-2026', 'Odd Sem', '24CS1101', 'PROBLEM SOLVING WITH C', 'P', 'S-30-A', 'Lakshmi Prasad'],
  [1, '2025-2026', 'Odd Sem', '24MT1001', 'LINEAR ALGEBRA AND CALCULUS', 'L', 'S-30', 'Suresh Naidu'],
  [1, '2025-2026', 'Odd Sem', '24MT1001', 'LINEAR ALGEBRA AND CALCULUS', 'T', 'S-30', 'Suresh Naidu'],
  [1, '2025-2026', 'Odd Sem', '24EC1101', 'DIGITAL LOGIC DESIGN', 'L', 'S-30', 'Padma Devi'],
];

/** Yii pagination: `page` (1-based) and `per-page`, capped at 5 here so readCourses walks several pages. */
function coursesTab(url) {
  const size = Math.min(5, Math.max(1, Number(url.searchParams.get('per-page')) || 20));
  const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const from = (pageNo - 1) * size;
  const slice = COURSE_CLASSES.slice(from, from + size);
  const rows = slice.map((r, i) => [from + i + 1, ...r]);
  const head = ['#', 'Year', 'AcademicYear', 'Semester', 'Coursecode', 'Coursedesc', 'LTPS', 'Section', 'FacultyName'];
  const table = grid(head, rows).replace(/<div class="summary">.*?<\/div>/, '');
  const summary = `<div class="summary">Showing <b>${slice.length ? from + 1 : 0}-${from + slice.length}</b> of <b>${COURSE_CLASSES.length}</b> items.</div>`;
  return summary + table;
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
 * Course feedback (Feedback → Submit): forms per faculty, each with five-point
 * questions. Filed answers are kept per student for the life of the mock; a filed form
 * answers with the real ERP's one-line refusal instead of the form.
 */
const FEEDBACK_FORMS = [
  { id: 'fb1', code: '24CS2201', title: 'DATA STRUCTURES', comp: 'L', sec: 'S-1', fac: 'Test Faculty  Alpha', facId: '701', qs: ['Faculty demonstrate a strong command of the subject matter.', 'Lectures are well-structured, organized, and easy to follow.'] },
  { id: 'fb2', code: '24CS2201', title: 'DATA STRUCTURES', comp: 'P', sec: 'S-1', fac: 'Test Faculty  Alpha', facId: '701', qs: ['How well is the teacher able to explain the practical problems to be solved?'] },
  { id: 'fb3', code: '24CS2202', title: 'DISCRETE MATHEMATICS', comp: 'L', sec: 'S-2', fac: 'Test Faculty  Beta', facId: '702', qs: ['Faculty demonstrate a strong command of the subject matter.'] },
  { id: 'fb4', code: '24CS2202', title: 'DISCRETE MATHEMATICS', comp: 'L', sec: 'S-2', fac: 'Test Faculty  Gamma', facId: '703', qs: ['Faculty demonstrate a strong command of the subject matter.'] },
];
const feedbackFiled = new Map(); // user -> [{ formId, code, fac, question, option }]
const OPTIONS = ['Excellent', 'Very good', 'Good', 'Satisfactory', 'Unsatisfactory'];

function feedbackList() {
  const rows = [];
  for (const f of FEEDBACK_FORMS) {
    // Real links carry encrypted binary ids; the mock keeps the form id at the end.
    const link = `<a class="crudjax2" href="/index.php?r=feedback%2Ffeedbackstudentresultinfo%2Fstudentfeedback&amp;id=%C2%0A${f.id}">${esc(f.fac)}</a>`;
    const last = rows[rows.length - 1];
    if (last && last.key === `${f.code}${f.comp}`) last.cells[9] += `<br/><br/>${link}`;
    else rows.push({ key: `${f.code}${f.comp}`, cells: [rows.length + 1, f.code, f.title, f.sec, 'MA', f.comp, '2026-2027', 'Even Sem', '2', link] });
  }
  return `<h4 class="redflag">Feedback Student Schedule Infos</h4>${grid(
    ['#', 'Course Code', 'Course Desc', 'Main Section', 'Associative Sectionno', 'Course Component', 'Academic Year', 'Semester', 'Offering Year', 'Click'],
    rows.map((r) => r.cells),
  )}`;
}

function feedbackForm(f, csrf, user) {
  const hidden = (i, k, v) =>
    `<div class="form-group field-feedbackstudentresultinfo-${i}-${k} required"><input type="hidden" id="feedbackstudentresultinfo-${i}-${k}" class="form-control" name="FeedbackStudentResultInfo[${i}][${k}]" value="${esc(v)}"><div class="help-block"></div></div>`;
  const qs = f.qs
    .map((q, i) => {
      const qid = `${f.id}${i}`;
      const radios = OPTIONS.map((o, n) => `<label><input type="radio" name="DynamicModel[${i}][fsri_student_questionaire_answer_option]" value="${qid}:::${n + 1}"> ${o}</label>`).join('\n');
      return `${hidden(i, 'fsri_student_profile_id', '96000')}${i + 1} ${esc(q)}${hidden(i, 'fsri_student_questionaire_info_id', qid)}<div class="form-group field-dynamicmodel-${i}-fsri_student_questionaire_answer_option required"><label class="control-label">Options</label><input type="hidden" name="DynamicModel[${i}][fsri_student_questionaire_answer_option]" value=""><div role="radiogroup">${radios}</div><div class="help-block"></div></div>${hidden(i, 'fsri_coursecode', f.code)}${hidden(i, 'fsri_fac_profileid', f.facId)}${hidden(i, 'fsri_course_del_comp', f.comp)}${hidden(i, 'createby', user)}`;
    })
    .join('');
  return `<div class="feedback-student-result-info-form"><form id="studentfeedbackform" action="/index.php?r=feedback%2Ffeedbackstudentresultinfo%2Fsavestudentfeedback" method="POST" data-pjax><input type="hidden" name="_csrf" value="${csrf}"><h5><b></b></h5>${qs}<div class="form-group text-center"><button type="submit" class="btn btn-success">Save</button></div></form></div>`;
}

function feedbackResults(user) {
  const rows = [...(feedbackFiled.get(user) ?? [])].reverse();
  return `<h4>Student Feedback</h4>${grid(
    ['#', 'Fsriid', 'Academic Year', 'Offering Year', 'Semester', 'Extension Name', 'Question', 'Answer Option', 'Course Code', 'Faculty Name'],
    rows.map((r, i) => [i + 1, 1000 + rows.length - i, '2026-2027', '2', 'Even Sem', 'Normal', esc(r.question), r.option, r.code, esc(r.fac)]),
  )}`;
}

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
  if (r === 'studentinfo/studentendexamresult/download_script_frompath') {
    // The real ERP labels scanned scripts text/html.
    return send(200, PDF, { 'Content-Type': 'text/html; charset=UTF-8' }), true;
  }
  if (r === 'studentinfo/studentcoursemappingmasterinfoview/tab_index_personal') return ok(coursesTab(url));
  if (r === 'studentinfo/studentprofileinfo/viewprofileindi') return ok(profilePage());
  if (r === 'transport/transport-bus-occupancy-info/student-bus-seat-info') return ok(busPage(user));
  if (r === 'studentinfo/studentcouncellingdairy/counselling_diary_stuview') return ok(counsellingPage(user));
  if (r === 'nodues/noduesstudentdocumentsinfo/my_dues_fines_student') return ok(duesPage());
  if (r === 'feepayments/feereports/student_fee_dues') return ok(ledgerPage());
  if (r === 'registraroffice/registrarofficecircularsvisibilitylistinfo/tab_index_personal') return ok(circularsPage());
  if (r.startsWith('feedback/feedbackstudentresultinfo/')) {
    if (failing('feedback')) return send(500, 'Internal Server Error'), true;
    const filed = feedbackFiled.get(user) ?? [];
    if (r.endsWith('/createstudentfeedback')) return ok(feedbackList());
    if (r.endsWith('/indexindi')) return ok(feedbackResults(user));
    if (r.endsWith('/studentfeedback')) {
      const id = (url.searchParams.get('id') ?? '').slice(-3);
      const f = FEEDBACK_FORMS.find((x) => x.id === id);
      if (!f) return send(404, 'Not found'), true;
      if (filed.some((x) => x.formId === f.id)) return send(200, 'Feedback is already taken for this subject vs faculty'), true;
      return send(200, feedbackForm(f, s.csrf, user)), true;
    }
    if (r.endsWith('/savestudentfeedback') && req.method === 'POST') {
      const form = new URLSearchParams(await readBody());
      const f = FEEDBACK_FORMS.find((x) => x.code === form.get('FeedbackStudentResultInfo[0][fsri_coursecode]') && x.facId === form.get('FeedbackStudentResultInfo[0][fsri_fac_profileid]') && x.comp === form.get('FeedbackStudentResultInfo[0][fsri_course_del_comp]'));
      if (!f || filed.some((x) => x.formId === f.id)) return send(200, 'Feedback is already taken for this subject vs faculty'), true;
      const rows = [];
      for (let i = 0; i < f.qs.length; i++) {
        const v = form.getAll(`DynamicModel[${i}][fsri_student_questionaire_answer_option]`).pop() ?? '';
        const option = v.split(':::')[1];
        if (!option) return ok('<div class="has-error"><div class="help-block">Fsri Student Questionaire Answer Option cannot be blank.</div></div>');
        rows.push({ formId: f.id, code: f.code, fac: f.fac, question: f.qs[i], option });
      }
      feedbackFiled.set(user, [...filed, ...rows]);
      return send(302, '', { Location: '/index.php?r=feedback%2Ffeedbackstudentresultinfo%2Findexindi' }), true;
    }
  }
  if (r === 'registraroffice/registrarofficecircularsvisibilitylistinfo/circular_documents') {
    return send(200, PDF, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="circular.pdf"' }), true;
  }
  return false;
}
