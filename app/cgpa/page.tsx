'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlanner } from '@/components/data-context';
import { Container, GlassPanel, Chip, CountUp } from '@/components/ui';
import { NeedLink } from '@/components/need-link';
import { api } from '@/lib/api';
import { cn } from '@/components/cn';
import type { CgpaRow } from '@/lib/erp/parsers';
import type { SgpaTerm } from '@/components/data-context';

function gradeTone(grade: string): string {
  const g = grade.toUpperCase();
  if (g === 'O' || g === 'A+') return 'text-[#34D399] border-[#34D399]/40';
  if (g === 'F' || g === 'AB') return 'text-[#F87171] border-[#F87171]/40';
  return 'text-[#E9A13B] border-[#E9A13B]/40';
}

export default function CgpaPage() {
  const { ready, hasData, cgpa, sgpaTerms, cgpaRows } = usePlanner();
  const [live, setLive] = useState<{ cgpa: number | null; terms: SgpaTerm[]; rows: CgpaRow[] } | null>(null);
  const [termKey, setTermKey] = useState<string | null>(null);

  // Fallback: if the snapshot predates CGPA syncing, pull it live once.
  useEffect(() => {
    if (!ready || !hasData || cgpaRows.length > 0 || live) return;
    let cancelled = false;
    fetch(api('/api/erp/cgpa'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setLive({ cgpa: d.cgpa ?? null, terms: d.terms ?? [], rows: d.rows ?? [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, hasData, cgpaRows.length, live]);

  const data = useMemo(() => {
    if (cgpaRows.length > 0) return { cgpa, terms: sgpaTerms, rows: cgpaRows };
    if (live) return live;
    return { cgpa: null as number | null, terms: [] as SgpaTerm[], rows: [] as CgpaRow[] };
  }, [cgpa, sgpaTerms, cgpaRows, live]);

  const activeTerm = data.terms.find((t) => t.key === termKey) ?? data.terms[0] ?? null;
  const termRows = useMemo(
    () =>
      activeTerm
        ? data.rows.filter((r) => `${r.academicYear}::${r.semester}` === activeTerm.key)
        : [],
    [data.rows, activeTerm],
  );

  if (!ready) {
    return (
      <Container className="py-10">
        <p className="text-sm text-[#A1A1A8]">Warming up…</p>
      </Container>
    );
  }
  if (!hasData) return <NeedLink what="CGPA" />;

  return (
    <Container className="py-8">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#A1A1A8]">[ CGPA ]</p>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black tracking-tight text-[#F5F4F0] sm:text-5xl">
            CGPA
          </h1>
          <div className="mt-3 flex items-baseline gap-3">
            <CountUp value={data.cgpa} className="font-display text-6xl font-black tabular-nums" />
            <span className="text-sm text-[#A1A1A8]">cumulative</span>
          </div>
        </div>

        {/* SGPA term picker — small, right side, under the nav */}
        {data.terms.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">
              SGPA
            </label>
            <div className="flex flex-wrap justify-end gap-1.5">
              {data.terms.map((t) => {
                const active = activeTerm?.key === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTermKey(t.key)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-bold transition',
                      active
                        ? 'border-[#E9A13B] bg-[#E9A13B]/15 text-[#E9A13B]'
                        : 'border-[#232327] text-[#A1A1A8] hover:border-white/20 hover:text-white',
                    )}
                  >
                    {t.semester} · {t.academicYear} — {t.sgpa ?? '—'}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data.terms.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <p className="text-sm text-[#A1A1A8]">
            No grades on the ERP yet. If you&apos;ve finished a semester, hit{' '}
            <span className="font-bold text-[#E9A13B]">⟳ hard sync</span> up top — it
            re-pulls everything from the ERP. Otherwise they&apos;ll appear here
            after the next backend sync.
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-6">
          {/* selected term detail */}
          {activeTerm && (
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">
                    {activeTerm.academicYear} · {activeTerm.semester}
                  </p>
                  <p className="font-display mt-1 text-3xl font-black tabular-nums text-[#F5F4F0]">
                    {activeTerm.sgpa ?? '—'}
                    <span className="ml-2 align-middle text-sm font-normal text-[#A1A1A8]">SGPA</span>
                  </p>
                </div>
                <Chip tone="amber">{activeTerm.credits} credits</Chip>
              </div>
              <div className="thin-scroll mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#232327] text-left text-[11px] uppercase tracking-wider text-[#A1A1A8]">
                      <th className="py-2 pr-3 font-bold">Code</th>
                      <th className="py-2 pr-3 font-bold">Course</th>
                      <th className="py-2 pr-3 text-center font-bold">Grade</th>
                      <th className="py-2 pr-3 text-center font-bold">Points</th>
                      <th className="py-2 text-center font-bold">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termRows.map((r) => (
                      <tr key={r.courseCode} className="border-b border-white/[0.05]">
                        <td className="py-2.5 pr-3 font-bold text-[#F5F4F0]">{r.courseCode}</td>
                        <td className="py-2.5 pr-3 text-[#A1A1A8]">{r.courseName}</td>
                        <td className="py-2.5 pr-3 text-center">
                          <span className={cn('rounded-md border px-2 py-0.5 text-xs font-black', gradeTone(r.grade))}>
                            {r.grade || '—'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-center tabular-nums text-[#A1A1A8]">{r.gradePoint}</td>
                        <td className="py-2.5 text-center tabular-nums text-[#A1A1A8]">{r.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          )}

          {/* all terms */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.terms.map((t) => (
              <button key={t.key} onClick={() => setTermKey(t.key)}>
                <GlassPanel
                  className={cn(
                    'p-4 text-left transition hover:border-white/20',
                    activeTerm?.key === t.key && 'border-[#E9A13B]/50',
                  )}
                >
                  <p className="text-xs font-bold text-[#A1A1A8]">
                    {t.semester} · {t.academicYear}
                  </p>
                  <p className="font-display mt-1 text-3xl font-black tabular-nums text-[#F5F4F0]">
                    {t.sgpa ?? '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B6B72]">{t.credits} credits</p>
                </GlassPanel>
              </button>
            ))}
          </div>
        </div>
      )}
    </Container>
  );
}
