/**
 * Parsers for the on-demand ERP pages (lib/erp/records-parse.ts), on synthetic HTML
 * in the shapes the real ERP serves (header quirks included: "Due Payment",
 * "Semester Name", a shifted counselling header, "Co1" columns, "<b>69</b> items").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  circularDocumentHref,
  feeLedgerHref,
  parseBusSeats,
  parseCirculars,
  parseComponentMarks,
  parseCounselling,
  parseDues,
  parseFeeLedger,
  parseFormTerms,
  parseIdentity,
  parseInternalLinks,
  parsePaperQuestions,
  parseProfile,
  parseReceiptList,
  parseSeating,
} from '../lib/erp/records-parse';

const grid = (headers: string[], rows: (string | number)[][]) =>
  `<table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.length
      ? rows.map((r) => `<tr data-key="0">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${headers.length}"><div class="empty">No results found.</div></td></tr>`
  }</tbody></table>`;

const TOPBAR = `<ul class="navbar-nav"><li><div><b>NAME: </b></div><div>ASHA RANI</div><hr></li><li><div><b>Roll No: </b></div><div> 2500000001</div></li><li><div><b>Department: </b></div><div>1073 - KLBCH - Department of computer science and Engineering -1</div></li><li><form action="/index.php?r=site%2Flogout"></form></li></ul>`;

test('identity comes from the top bar; the department loses its codes', () => {
  assert.deepEqual(parseIdentity(TOPBAR), { name: 'ASHA RANI', universityId: '2500000001', department: 'Computer Science and Engineering' });
});

test('profile keeps academic fields and leaves personal ones out', () => {
  const html = `${TOPBAR}<table><tbody><tr><td> Admission Date </td><td><label>: 04-08-2025</label></td></tr><tr><td> Date Of Birth </td><td><label>: 01-01-2007</label></td></tr><tr><td> Regulation</td><td><label>: R25</label></td></tr><tr><td> Program </td><td><label>: UG</label></td></tr></tbody></table>`;
  const p = parseProfile(html);
  assert.equal(p.admissionDate, '04-08-2025');
  assert.equal(p.regulation, 'R25');
  assert.equal(p.program, 'UG');
  assert.equal(p.name, 'ASHA RANI');
  assert.equal(JSON.stringify(p).includes('2007'), false);
});

test('bus seats by header', () => {
  const html = grid(
    ['#', 'Ref.No', 'Campus', 'Academic Year', 'Semester', 'University Id', 'Name', 'Bus Name', 'Bus Desc', 'Seat No', 'Bus Shift', 'Route-Stage', 'Total Bus/Stage Fee', 'Fee Collection Type'],
    [[1, 22, 'KLBCH', '2026-2027', 'Odd Sem', 'x', 'y', '408', 'B CAMPUS ROUTE NO 8', '47', 'General Shift', 'B CAMPUS ROUTE NO 8 (MOTI NAGAR) - MOTI NAGAR', 'Rs.50000', 'Yearly(10 Months)']],
  );
  const [b] = parseBusSeats(html);
  assert.equal(b.bus, '408');
  assert.equal(b.seat, '47');
  assert.equal(b.fee, 50000);
  assert.equal(b.academicYear, '2026-2027');
});

test('counselling diary: shifted headers, newest first, "-" problems dropped', () => {
  const html = grid(
    ['#', 'Ref.No', 'Academic Year', 'Semester Name', 'Employee Name', 'Teacher Mobileno', 'Employee Id', 'University Id', 'Student Year Of Study', 'Counselling Category', 'Interaction With', 'Student / Parent Problem if any', 'Counsellor Remarks', 'Date of Counselling'],
    [
      [1, 1, '2026-2027', 'Odd Sem', 'A TEACHER', '', 1, 'x', 2, 'Academic', 'Student', '-', 'Older note.', '2026-09-11'],
      [2, 2, '2026-2027', 'Even Sem', 'A TEACHER', '', 1, 'x', 2, 'Academic', 'Parent', 'Low attendance', 'Called home.', '2026-11-13'],
    ],
  );
  const notes = parseCounselling(html);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].date, '2026-11-13');
  assert.equal(notes[0].with, 'Parent');
  assert.equal(notes[0].semester, 'Even Sem');
  assert.equal(notes[0].counsellor, 'A TEACHER');
  assert.equal(notes[0].problem, 'Low attendance');
  assert.equal(notes[1].problem, '');
});

test('fee ledger: "Due Payment" column, multi-part receipt numbers, overpayment as negative due', () => {
  const html = grid(
    ['#', 'Academic Year', 'Year Of Study', 'Semester', 'Total Amount Without Concession', 'Total Concession Amount', 'To Pay', 'Paid', 'Due Payment', 'Receipt Details'],
    [[2, '2025-2026', 1, 2, 155000, 10000, 145000, 150000, -5000, 'Order Date:2025-12-27::Receipt No:HDF:P-96539:T-1766822044::Transaction Amount:1<br>,Order Date:2025-12-27::Receipt No:SBI:P-96539:T-1766822167::Transaction Amount:144999']],
  );
  const [row] = parseFeeLedger(html);
  assert.equal(row.toPay, 145000);
  assert.equal(row.paid, 150000);
  assert.equal(row.due, -5000);
  assert.deepEqual(row.receipts.map((r) => r.receiptNo), ['HDF:P-96539:T-1766822044', 'SBI:P-96539:T-1766822167']);
  assert.deepEqual(row.receipts.map((r) => r.amount), [1, 144999]);
});

test('receipt lists split on each order', () => {
  assert.equal(parseReceiptList('Order Date:2025-08-04::Receipt No:KL-2505322:1754313349::Transaction Amount:95000').length, 1);
  assert.equal(parseReceiptList('').length, 0);
});

test('dues keep only what is owed', () => {
  const head = ['#', 'Sem Fee Due', 'Hostel Fee Due', 'Transport Fee Due', 'Fine Due'];
  assert.deepEqual(parseDues(grid(head, [[1, 0, 0, 0, -45000]])), []);
  assert.deepEqual(parseDues(grid(head, [[1, 45000, 0, 1200, -5]])), [
    { label: 'Sem Fee', amount: 45000 },
    { label: 'Transport Fee', amount: 1200 },
  ]);
});

test('the fee ledger link comes from the menu, with or without &amp;', () => {
  assert.equal(feeLedgerHref('<a href="/index.php?r=feepayments%2Ffeereports%2Fstudent_fee_dues&id=ab%2Fc">x</a>'), '/index.php?r=feepayments%2Ffeereports%2Fstudent_fee_dues&id=ab%2Fc');
  assert.equal(feeLedgerHref('<a href="/index.php?r=feepayments%2Ffeereports%2Fstudent_fee_dues&amp;id=z">x</a>'), '/index.php?r=feepayments%2Ffeereports%2Fstudent_fee_dues&id=z');
  assert.equal(feeLedgerHref('<p>none</p>'), null);
});

test('circulars: total from the summary, documents by id', () => {
  const html = `<div class="summary">Showing <b>1-2</b> of <b>69</b> items.</div>${grid(
    ['#', 'CircularID', 'Circular Subject', 'Circular Note', 'Createon', ''],
    [
      [1, '38296', 'Workshop – Reg.', '', '2026-11-17 12:52:29', '<a href="/index.php?r=registraroffice%2Fregistrarofficecircularsvisibilitylistinfo%2Fcircular_documents&amp;id=k1">v</a>'],
      [2, '38286', 'Webinar – Reg.', '', '2026-11-13 16:23:07', ''],
    ],
  )}`;
  const { circulars, total } = parseCirculars(html);
  assert.equal(total, 69);
  assert.deepEqual(circulars.map((c) => [c.id, c.hasDocument]), [['38296', true], ['38286', false]]);
  assert.equal(circularDocumentHref(html, '38296'), '/index.php?r=registraroffice%2Fregistrarofficecircularsvisibilitylistinfo%2Fcircular_documents&id=k1');
  assert.equal(circularDocumentHref(html, '38286'), null);
});

test('exam rooms; an empty grid is no rooms', () => {
  const head = ['#', 'Ref.Id', 'Exam Date', 'Exam Type', 'Exam Slot', 'Student University Id', 'Course Code', 'Room No', 'Createon'];
  assert.deepEqual(parseSeating(grid(head, [])), []);
  assert.deepEqual(parseSeating(grid(head, [[1, 1, '2026-11-24', 'Mid-Term', 'FN', 'x', '24CS2201', 'C-204', '']])), [
    { date: '2026-11-24', examType: 'Mid-Term', slot: 'FN', courseCode: '24CS2201', room: 'C-204' },
  ]);
});

test('internals: component links per course, then each component\'s marks', () => {
  const list = grid(
    ['#', 'Academic Year', 'Semester', 'Course Code', 'course Name', 'Evaluation Components'],
    [[1, '2026-2027', 'Odd Sem', '25CS2103E', 'DATA STRUCTURES', '<br><a class="crudjax3" href="/index.php?r=examsection%2Fexamstudentcourseinternalsummativeqpwisemarksinfo%2Findex_student_marks&amp;id=a">Mid-Term Examination (Descriptive)</a><br><a href="/index.php?r=examsection%2Fexamstudentcourseinternalformativecowisemarksinfo%2Findex_student_marks&amp;id=b">Project Continuous Evaluation</a>']],
  );
  const [c] = parseInternalLinks(list);
  assert.equal(c.code, '25CS2103E');
  assert.deepEqual(c.components.map((x) => x.name), ['Mid-Term Examination (Descriptive)', 'Project Continuous Evaluation']);
  assert.match(c.components[1].href, /formativecowise.*id=b$/);

  const head = (parts: string[]) => ['Sno', 'Coursecode', 'Coursedesc', 'Remarks', 'Student Uniid', ...parts, 'Max Marks', 'Weight', 'Total Marks', 'Weighted Marks'];
  const summative = parseComponentMarks(grid(head(['1', '2']), [[1, 'x', 'y', '', 'z', 12, 13, 100, 20, 82, 16.4]]));
  assert.deepEqual(summative, { total: 82, max: 100, weight: 20, weighted: 16.4, parts: [{ label: '1', marks: 12 }, { label: '2', marks: 13 }], remarks: '' });
  const formative = parseComponentMarks(grid(head(['Co1']), [[1, 'x', 'y', '', 'z', 13, 100, 20, 84, 16.8]]));
  assert.equal(formative?.parts[0].label, 'CO1');
  assert.equal(parseComponentMarks(grid(head(['1']), [])), null);
});

test('a paper\'s questions in order, evaluators left out', () => {
  const html = `<table><thead><tr><th>Question No's</th><th>Max. Marks</th><th>Obtained Marks</th><th>Remarks Marks</th><th>Evaluator Name</th><th>Evaluator Uniid</th></tr></thead><tbody><tr><td>2.A</td><td>5</td><td>2.5</td><td></td><td>SOMEONE</td><td>1</td></tr><tr><td>1.B</td><td>7</td><td>6.5</td><td></td><td>SOMEONE</td><td>2</td></tr><tr><td>10.A</td><td>3</td><td>1</td><td></td><td>X</td><td>3</td></tr></tbody></table>`;
  const qs = parsePaperQuestions(html);
  assert.deepEqual(qs.map((q) => q.question), ['1.B', '2.A', '10.A']);
  assert.equal(qs[0].got, 6.5);
  assert.equal(JSON.stringify(qs).includes('SOMEONE'), false);
});

test('a search form\'s terms, newest first', () => {
  const html = `<select name="DynamicModel[academicyear]"><option value="">Select</option><option value="19">2025-2026</option><option value="29">2026-2027</option></select><select name="DynamicModel[semester]"><option value="">Select</option><option value="1">Odd Sem</option><option value="2">Even Sem</option></select>`;
  assert.deepEqual(
    parseFormTerms(html).map((t) => `${t.academicyear}:${t.semesterid}`),
    ['29:2', '29:1', '19:2', '19:1'],
  );
});
