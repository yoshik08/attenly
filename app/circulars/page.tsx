'use client';

import type { CSSProperties } from 'react';
import { ArrowSquareOut, Megaphone } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { useRecord } from '@/components/records';
import { RecordLine, RecordProblem, RecordSkeleton, dateOf, fmtDate } from '@/components/record-ui';
import { api } from '@/lib/api';
import type { Circular } from '@/lib/erp/records-parse';

export default function CircularsPage() {
  return (
    <DataGate title="Circulars">
      <Circulars />
    </DataGate>
  );
}

/** "Organizing an … – Reg." → drop the registrar's trailing "Reg." marker. */
const subjectOf = (s: string) => s.replace(/\s*[–-]?\s*Reg\.?,?\s*$/i, '').trim();

function Circulars() {
  const { active } = useStore();
  const rec = useRecord('circulars');
  const list = rec.data?.circulars ?? [];
  const total = rec.data?.total ?? null;

  // Grouped by month, newest first (the ERP already lists them newest first).
  const months: [string, Circular[]][] = [];
  for (const c of list) {
    const d = dateOf(c.date);
    const label = d ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'Earlier';
    const last = months[months.length - 1];
    if (last && last[0] === label) last[1].push(c);
    else months.push([label, [c]]);
  }

  return (
    <div className="page-in max-w-[900px]">
      <PageHeader
        title="Circulars"
        sub={
          <RecordLine fetchedAt={rec.fetchedAt} loading={rec.loading} onRefresh={rec.refresh}>
            {list.length > 0 && (
              <span className="tnum">
                Latest {list.length}
                {total && total > list.length ? ` of ${total}` : ''}
              </span>
            )}
          </RecordLine>
        }
      />
      <RecordProblem error={rec.error} code={rec.code} hasData={Boolean(rec.data)} />

      {!rec.data && rec.loading ? (
        <RecordSkeleton cards={4} />
      ) : list.length === 0 ? (
        rec.data && (
          <Empty icon={Megaphone} title="No circulars for you on the ERP.">
            The registrar&rsquo;s circulars addressed to you show up here.
          </Empty>
        )
      ) : (
        <div className="mt-7 flex flex-col gap-8">
          {months.map(([label, items]) => (
            <section key={label} aria-label={label}>
              <p className="mb-2.5 text-[13px] font-semibold text-fg-2">{label}</p>
              <ul className="grouped lg lg-card lg-frost">
                {items.map((c, i) => {
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-medium leading-snug pretty">{subjectOf(c.subject)}</span>
                        {c.note && <span className="mt-1 block text-[12.5px] leading-snug text-fg-2 pretty">{c.note}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-fg-3 tnum">
                        {fmtDate(c.date, true)}
                        {c.hasDocument && <ArrowSquareOut size={15} className="text-fg-2" aria-label="Opens the document" />}
                      </span>
                    </>
                  );
                  return (
                    <li key={c.id} className="rise" style={{ '--i': i } as CSSProperties}>
                      {c.hasDocument && active ? (
                        <a
                          href={api(`/api/erp/circular?id=${encodeURIComponent(c.id)}&account=${encodeURIComponent(active)}`)}
                          target="_blank"
                          rel="noopener"
                          className="press flex items-start gap-4 px-4 py-3.5 hover:bg-white/[0.035] sm:px-5"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="flex items-start gap-4 px-4 py-3.5 sm:px-5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Footnote>
        From the registrar&rsquo;s office on the ERP. A circular&rsquo;s document is read from the ERP when you open it.
      </Footnote>
    </div>
  );
}
