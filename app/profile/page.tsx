'use client';

import type { CSSProperties } from 'react';
import { Bus, ChatsCircle, IdentificationCard } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { useRecord } from '@/components/records';
import { RecordLine, RecordProblem, RecordSkeleton, fmtDate, money, nameCase } from '@/components/record-ui';
import { cn } from '@/components/cn';
import type { BusSeat, CounsellingNote } from '@/lib/erp/records-parse';

export default function ProfilePage() {
  return (
    <DataGate title="Profile">
      <Profile />
    </DataGate>
  );
}

function Profile() {
  const { activeAccount } = useStore();
  const rec = useRecord('profile');
  const p = rec.data?.profile;
  const bus = rec.data?.bus ?? [];
  const notes = rec.data?.counselling ?? [];
  // The newest seat: the ERP lists one per year.
  const seat = [...bus].sort((a, b) => b.academicYear.localeCompare(a.academicYear))[0] ?? null;

  return (
    <div className="page-in">
      <PageHeader
        title={p?.name ? nameCase(p.name) : 'Profile'}
        sub={
          <RecordLine fetchedAt={rec.fetchedAt} loading={rec.loading} onRefresh={rec.refresh}>
            <span className="mono">{p?.universityId || activeAccount?.universityId}</span>
          </RecordLine>
        }
      />
      <RecordProblem error={rec.error} code={rec.code} hasData={Boolean(rec.data)} />

      {!rec.data && rec.loading ? (
        <RecordSkeleton cards={2} />
      ) : (
        p && (
          <div className="mt-7 grid items-start gap-3 md:grid-cols-2 lg:gap-4">
            <section className="card rise p-5 lg:p-6" aria-label="Academic" style={{ '--i': 0 } as CSSProperties}>
              <p className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">
                <IdentificationCard size={17} weight="fill" aria-hidden /> Academic
              </p>
              <dl className="mt-3">
                {[
                  ['Department', p.department ? nameCase(p.department) : ''],
                  ['Program', p.program],
                  ['Regulation', p.regulation],
                  ['Admitted', p.admissionDate ? fmtDate(p.admissionDate) : ''],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v], i) => (
                    <div key={k} className={cn('flex items-baseline justify-between gap-4 py-2.5', i > 0 && 'hair-t')}>
                      <dt className="text-[13.5px] text-fg-2">{k}</dt>
                      <dd className="min-w-0 text-right text-[14.5px] font-semibold pretty">{v}</dd>
                    </div>
                  ))}
              </dl>
            </section>
            {seat ? <BusCard seat={seat} /> : rec.data && <NoBus />}
          </div>
        )
      )}

      <section aria-label="Counselling diary" className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="h2">
            Counselling diary{' '}
            {notes.length > 0 && <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3 tnum">{notes.length}</span>}
          </h2>
          {notes[0]?.counsellor && <p className="text-[13px] text-fg-2">Counsellor {nameCase(notes[0].counsellor)}</p>}
        </div>
        {rec.data && notes.length === 0 ? (
          <Empty icon={ChatsCircle} title="Your counsellor hasn’t written anything yet." className="mt-0">
            Notes from counselling sessions, and calls to your parents, show up here.
          </Empty>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {notes.map((n, i) => (
              <Note key={`${n.date}-${i}`} note={n} index={i} />
            ))}
          </ol>
        )}
      </section>

      <Footnote>
        Read from the ERP when you open this screen, at most every few hours. Attenly leaves out your birth date and contact
        details on purpose.
      </Footnote>
    </div>
  );
}

function BusCard({ seat }: { seat: BusSeat }) {
  // "B CAMPUS ROUTE NO 8 (MOTI NAGAR) - MOTI NAGAR" → the stop after the dash.
  const stop = seat.stage.split(' - ').pop()?.trim() ?? '';
  return (
    <section
      data-tone="mark"
      className="card glow rise p-5 lg:p-6"
      aria-label="Bus"
      style={{ '--i': 1, '--gs': '320px', '--gx': '-140px', '--gy': '-170px' } as CSSProperties}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">
        <Bus size={17} weight="fill" aria-hidden /> Bus · {seat.academicYear}
      </p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="figure text-[52px] leading-none">{seat.bus}</p>
          <p className="mt-2 text-[14px] text-fg-2">{nameCase(seat.route)}</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-fg-3">Seat</p>
          <p className="figure text-[34px] leading-none">{seat.seat}</p>
        </div>
      </div>
      <p className="mt-4 hair-t pt-3 text-[13px] text-fg-2">
        {[stop && `Stop ${nameCase(stop)}`, seat.shift, seat.fee != null && `${money(seat.fee)} ${seat.feeType.replace(/\s*\(/, ' (').toLowerCase()}`.trim()]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </section>
  );
}

function NoBus() {
  return (
    <section className="card rise p-5 lg:p-6" style={{ '--i': 1 } as CSSProperties}>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">
        <Bus size={17} aria-hidden /> Bus
      </p>
      <p className="mt-3 text-[14px] text-fg-2">No bus seat on the ERP.</p>
    </section>
  );
}

function Note({ note, index }: { note: CounsellingNote; index: number }) {
  const parent = /parent/i.test(note.with);
  return (
    <li className="card rise p-4 sm:p-5" style={{ '--i': index } as CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-[13px] font-semibold tnum">{fmtDate(note.date)}</p>
        <span className="flex items-center gap-1.5">
          {note.category && (
            <span data-tone="none" className="chip">
              {note.category}
            </span>
          )}
          {note.with && (
            <span data-tone={parent ? 'mark' : 'none'} className="chip">
              {parent ? 'Spoke to parent' : 'With you'}
            </span>
          )}
        </span>
      </div>
      {note.problem && <p className="mt-2.5 text-[13px] text-fg-2">Concern: {note.problem}</p>}
      <p className="mt-2 text-[14.5px] leading-relaxed pretty">{note.remarks}</p>
      <p className="mt-2 text-[12px] text-fg-3">
        {[note.semester, note.academicYear].filter(Boolean).join(' ')}
      </p>
    </li>
  );
}
