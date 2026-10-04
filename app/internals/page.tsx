'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import { Button, Container, GlassPanel, Chip } from '@/components/ui';
import { NeedLink } from '@/components/need-link';
import { api } from '@/lib/api';
import { cn } from '@/components/cn';
import type { InternalRow, ResultRow, BookletMarks } from '@/lib/erp/parsers';

function termQuery(term: { academicyear: string; semesterid: string; semester: string }): string {
  return new URLSearchParams({
    academicyear: term.academicyear,
    semesterid: term.semesterid,
    semester: term.semester,
  }).toString();
}

function BookletPopup({
  row,
  onClose,
}: {
  row: ResultRow;
  onClose: () => void;
}) {
  const [marks, setMarks] = useState<BookletMarks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const target = row.bookletUrl ?? row.pdfUrl;
    if (!target) {
      setLoading(false);
      setError('The ERP did not expose a booklet link for this row.');
      return;
    }
    // If only the PDF link exists, the marks popup is skipped — the PDF button below still works.
    if (!row.bookletUrl) {
      setLoading(false);
      return;
    }
    fetch(api(`/api/erp/booklet-marks?u=${encodeURIComponent(row.bookletUrl)}`))
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error ?? 'Could not load the booklet.');
        setMarks(d as BookletMarks);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the booklet.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 16 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-[#232327] bg-[#141416]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#232327] p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">
              {row.courseCode} · {row.exam}
            </p>
            <h3 className="font-display mt-1 text-xl font-black text-[#F5F4F0]">
              {marks?.title ?? 'Booklet'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {row.pdfUrl && (
              <a
                href={api(`/api/erp/file?u=${encodeURIComponent(row.pdfUrl)}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#E9A13B] px-4 py-2 text-xs font-bold text-[#0A0A0B] transition hover:brightness-110"
              >
                Full booklet PDF ↗
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded-full border border-[#232327] px-3 py-2 text-xs font-bold text-[#A1A1A8] hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="thin-scroll max-h-[65vh] overflow-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-[#A1A1A8]">Reading the booklet…</p>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[#F87171]">{error}</p>
              {row.pdfUrl && (
                <p className="mt-2 text-xs text-[#A1A1A8]">The full PDF is still available above.</p>
              )}
            </div>
          ) : marks && marks.headers.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {marks.headers.map((h, i) => (
                    <th
                      key={i}
                      className="border-b border-[#232327] px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[#A1A1A8]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marks.rows.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.05]">
                    {r.map((c, j) => (
                      <td key={j} className="px-2 py-2 tabular-nums text-[#F5F4F0]">
                        {c || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-[#A1A1A8]">
              No question-wise marks on the ERP for this one yet.
              {row.pdfUrl && ' The full PDF is available above.'}
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function InternalsPage() {
  const { ready, hasData, internals, results, term } = usePlanner();
  const [view, setView] = useState<'internals' | 'booklets'>('internals');
  const [liveInternals, setLiveInternals] = useState<InternalRow[] | null>(null);
  const [liveResults, setLiveResults] = useState<ResultRow[] | null>(null);
  const [popupRow, setPopupRow] = useState<ResultRow | null>(null);

  // Fallback: pull live once when the snapshot predates these datasets.
  useEffect(() => {
    if (!ready || !hasData || !term) return;
    let cancelled = false;
    const q = termQuery(term);
    if (internals.length === 0 && !liveInternals) {
      fetch(api(`/api/erp/internals?${q}`))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setLiveInternals(d.rows ?? []);
        })
        .catch(() => {});
    }
    if (results.length === 0 && !liveResults) {
      fetch(api(`/api/erp/results?${q}`))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setLiveResults(d.rows ?? []);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [ready, hasData, term, internals.length, results.length, liveInternals, liveResults]);

  const rows = internals.length > 0 ? internals : (liveInternals ?? []);
  const bookletRows = results.length > 0 ? results : (liveResults ?? []);

  const components = useMemo(() => {
    const names: string[] = [];
    for (const r of rows) {
      for (const c of r.components) {
        if (!names.includes(c.name)) names.push(c.name);
      }
    }
    return names;
  }, [rows]);

  if (!ready) {
    return (
      <Container className="py-10">
        <p className="text-sm text-[#A1A1A8]">Warming up…</p>
      </Container>
    );
  }
  if (!hasData) return <NeedLink what="internals" />;

  return (
    <Container className="max-w-7xl py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#A1A1A8]">
            [ Internals ]
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight text-[#F5F4F0] sm:text-5xl">
            {view === 'internals' ? 'Internals' : 'Booklets'}
          </h1>
          {term && (
            <p className="mt-2 text-sm text-[#A1A1A8]">
              {term.academicyear} · {term.semester}
            </p>
          )}
        </div>
        <Button
          variant="glass"
          onClick={() => setView((v) => (v === 'internals' ? 'booklets' : 'internals'))}
          className="shrink-0"
        >
          {view === 'internals' ? 'View Booklets →' : '← Back to Internals'}
        </Button>
      </div>

      {view === 'internals' ? (
        rows.length === 0 ? (
          <GlassPanel className="p-8 text-center">
            <p className="text-sm text-[#A1A1A8]">
              No internal marks on the ERP for this term yet. They&apos;ll appear here after the next backend sync.
            </p>
          </GlassPanel>
        ) : (
          <GlassPanel className="overflow-hidden">
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-[#232327] p-3 text-left text-xs font-bold uppercase tracking-wider text-[#A1A1A8]">
                      Course
                    </th>
                    {components.map((c) => (
                      <th
                        key={c}
                        className="border-b border-[#232327] p-3 text-center text-xs font-bold uppercase tracking-wider text-[#A1A1A8]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.courseCode} className="border-b border-white/[0.05] hover:bg-white/[0.02]">
                      <td className="p-3">
                        <p className="font-bold text-[#F5F4F0]">{r.courseCode}</p>
                        <p className="max-w-[280px] truncate text-xs text-[#A1A1A8]">{r.courseTitle}</p>
                      </td>
                      {components.map((c) => {
                        const comp = r.components.find((x) => x.name === c);
                        const marks = comp?.marks ?? '';
                        const empty = !marks || marks === '-' || marks === '0';
                        return (
                          <td key={c} className="p-3 text-center">
                            <span
                              className={cn(
                                'inline-block min-w-[3rem] rounded-lg border px-2 py-1 text-sm font-bold tabular-nums',
                                empty
                                  ? 'border-[#232327] text-[#6B6B72]'
                                  : 'border-[#E9A13B]/30 bg-[#E9A13B]/[0.07] text-[#F5F4F0]',
                              )}
                            >
                              {marks || '—'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
        )
      ) : bookletRows.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <p className="text-sm text-[#A1A1A8]">
            No answer scripts on the ERP for this term yet. They&apos;ll appear here after the next backend sync.
          </p>
        </GlassPanel>
      ) : (
        <GlassPanel className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#232327] text-left text-xs font-bold uppercase tracking-wider text-[#A1A1A8]">
                  <th className="p-3">Course Code</th>
                  <th className="p-3">Course Name</th>
                  <th className="p-3">Year</th>
                  <th className="p-3">Semester</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Exam</th>
                  <th className="p-3">Eval</th>
                  <th className="p-3 text-center">Booklet</th>
                </tr>
              </thead>
              <tbody>
                {bookletRows.map((r, i) => (
                  <tr key={`${r.courseCode}-${r.exam}-${i}`} className="border-b border-white/[0.05] hover:bg-white/[0.02]">
                    <td className="p-3 font-bold text-[#F5F4F0]">{r.courseCode}</td>
                    <td className="max-w-[260px] truncate p-3 text-[#A1A1A8]">{r.courseName}</td>
                    <td className="p-3 text-[#A1A1A8]">{r.academicYear}</td>
                    <td className="p-3 text-[#A1A1A8]">{r.semester}</td>
                    <td className="p-3 text-[#A1A1A8]">{r.type}</td>
                    <td className="max-w-[220px] truncate p-3 text-[#A1A1A8]" title={r.exam}>{r.exam}</td>
                    <td className="p-3 tabular-nums text-[#A1A1A8]">{r.evalNo}</td>
                    <td className="p-3 text-center">
                      {r.bookletUrl || r.pdfUrl ? (
                        <button
                          onClick={() => setPopupRow(r)}
                          className="rounded-full border border-[#7DD3FC]/40 px-3 py-1 text-xs font-bold text-[#7DD3FC] transition hover:bg-[#7DD3FC]/10"
                        >
                          Booklet
                        </button>
                      ) : (
                        <span className="text-xs text-[#6B6B72]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}

      <AnimatePresence>
        {popupRow && <BookletPopup row={popupRow} onClose={() => setPopupRow(null)} />}
      </AnimatePresence>
    </Container>
  );
}
