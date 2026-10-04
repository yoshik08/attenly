'use client';

import { useMemo } from 'react';
import { usePlanner } from '@/components/data-context';
import { Container, GlassPanel } from '@/components/ui';
import { NeedLink } from '@/components/need-link';
import { cn } from '@/components/cn';
import type { TimetableDay } from '@/lib/erp/parsers';
import type { ComponentKey } from '@/lib/math';

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TYPE_PILL: Record<string, string> = {
  L: 'LEC',
  T: 'TUT',
  P: 'PRAC',
  S: 'SKILL',
};

function sortedPeriods(timetable: TimetableDay[]): string[] {
  const set = new Map<string, { order: number; start: string }>();
  for (const d of timetable) {
    for (const p of d.periods) {
      if (!set.has(p.period)) {
        const n = parseInt(p.period.replace(/\D/g, ''), 10);
        set.set(p.period, { order: Number.isNaN(n) ? 999 : n, start: p.start });
      }
    }
  }
  return [...set.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].start.localeCompare(b[1].start))
    .map(([k]) => k);
}

function cellTone(type: ComponentKey | null): string {
  if (type === 'S') return 'border-[#E9A13B]/30 bg-[#E9A13B]/[0.09]';
  if (type === 'P') return 'border-[#34D399]/30 bg-[#34D399]/[0.09]';
  return 'border-[#232327] bg-white/[0.02]';
}

function pillTone(type: ComponentKey | null): string {
  if (type === 'S') return 'border-[#E9A13B]/50 text-[#E9A13B]';
  if (type === 'P') return 'border-[#34D399]/50 text-[#34D399]';
  return 'border-white/20 text-[#A1A1A8]';
}

export default function TimetablePage() {
  const { ready, hasData, timetable, subjects } = usePlanner();

  const periods = useMemo(() => sortedPeriods(timetable), [timetable]);
  const days = useMemo(
    () => DAY_ORDER.map((d) => timetable.find((t) => t.day === d)).filter(Boolean) as TimetableDay[],
    [timetable],
  );

  // Course code -> full course name, from the attendance data.
  const nameFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subjects) {
      if (s.code && s.title && s.title !== s.code) m.set(s.code, s.title);
    }
    return (code: string, fallbackTitle: string) => {
      const t = m.get(code) || fallbackTitle;
      if (!t || t === code) return code;
      const first = t.split('|')[0].trim();
      return first.length > 26 ? first.slice(0, 26) + '…' : first;
    };
  }, [subjects]);

  if (!ready) {
    return (
      <Container className="py-10">
        <p className="text-sm text-[#A1A1A8]">Warming up…</p>
      </Container>
    );
  }
  if (!hasData || timetable.length === 0) return <NeedLink what="timetable" />;

  return (
    <Container className="max-w-7xl py-8">
      <div className="mb-6">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#A1A1A8]">
          [ Timetable ]
        </p>
        <h1 className="font-display text-4xl font-black tracking-tight text-[#F5F4F0] sm:text-5xl">
          The week
        </h1>
        <p className="mt-2 text-sm text-[#A1A1A8]">
          Every period, every room. Amber is skilling, green is practical.
        </p>
      </div>

      <GlassPanel className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead>
              <tr>
                <th className="w-20 border-b border-[#232327] p-3 text-left text-xs font-bold uppercase tracking-wider text-[#A1A1A8]">
                  Day
                </th>
                {periods.map((_, i) => (
                  <th
                    key={i}
                    className="border-b border-[#232327] p-3 text-center text-xs font-bold uppercase tracking-wider text-[#A1A1A8]"
                  >
                    Period {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td className="border-b border-white/[0.05] p-3 align-top text-sm font-black uppercase tracking-wide text-[#F5F4F0]">
                    {d.day}
                  </td>
                  {periods.map((per) => {
                    const p = d.periods.find((x) => x.period === per);
                    if (!p) {
                      return <td key={per} className="border-b border-white/[0.05] p-1.5" />;
                    }
                    return (
                      <td key={per} className="border-b border-white/[0.05] p-1.5 align-top">
                        <div className={cn('rounded-xl border px-2 py-1.5', cellTone(p.type))}>
                          <p className="truncate text-xs font-black text-[#F5F4F0]">
                            {nameFor(p.subjectCode, p.subjectTitle)}
                          </p>
                          <span
                            className={cn(
                              'mt-1 inline-block rounded-md border px-1.5 py-px text-[10px] font-black tracking-wide',
                              pillTone(p.type),
                            )}
                          >
                            {TYPE_PILL[p.type ?? 'L'] ?? 'LEC'}
                          </span>
                          {p.room && (
                            <p className="mt-1 truncate text-[10px] text-[#6B6B72]">{p.room}</p>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </Container>
  );
}
