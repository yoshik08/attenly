/** Recreated from the reported screenshot counts; contains no personal data. */
export function planLtpsData(now = Date.now()) {
  const syncedAt = new Date(now).toISOString();
  const universityId = '9900000015';
  const course = (code, title, counts) => ({
    code, title,
    components: Object.fromEntries(['L', 'T', 'P', 'S'].map((k) => [k, {
      attended: counts[k]?.[0] ?? 0, conducted: counts[k]?.[1] ?? 0,
    }])),
  });
  const period = (n, subjectCode, type) => ({
    period: `P${n}`, start: '', end: '', subjectCode, type,
    subjectTitle: '', room: 'H102', faculty: '',
  });
  return {
    signedIn: true,
    user: { name: 'Local fixture preview', email: null, image: null },
    accounts: [{ universityId, label: 'Screenshot regression fixture', primary: true, needsPassword: false, lastError: null, lastSyncAt: syncedAt, term: null }],
    active: universityId,
    freshMs: 330_000, serverNow: now, lastInstructionDay: null,
    snapshot: {
      universityId, syncedAt, attendanceSyncedAt: syncedAt,
      term: { academicyear: '2026-2027', semesterid: '1', semester: 'Odd Sem' },
      attendance: [
        course('AOOP', 'Advanced Object Oriented Programming', { P: [2, 2], S: [6, 6] }),
        course('CN', 'Computer Networks and Network Programming', { S: [6, 8] }),
        course('AI', 'Generative AI', { L: [4, 4], S: [6, 16] }),
        course('SDG', 'Insights to Sustainable Development Goals', { L: [2, 4] }),
        course('GL', 'Global Logic', { S: [11, 11] }),
      ],
      timetable: [
        { day: 'Mon', periods: [period(1, 'AOOP', 'L'), period(2, 'AOOP', 'L'), period(3, 'CN', 'L'), period(4, 'CN', 'L'), period(5, 'GL', 'S')] },
        { day: 'Tue', periods: [period(1, 'AI', 'L'), period(2, 'AI', 'S'), period(3, 'GL', 'S')] },
        { day: 'Fri', periods: [period(1, 'SDG', 'L'), period(2, 'GL', 'S'), period(3, 'GL', null)] },
      ],
      internals: [], results: [], cgpaRows: [], cgpa: null, sgpaTerms: [], feeOrders: [], classes: [], termOptions: null, issues: {},
    },
  };
}
