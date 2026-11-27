'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { CaretDown, Exam, FilePdf } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { useRecord } from '@/components/records';
import { QuestionChip, RecordLine, RecordProblem, RecordSkeleton, nameCase } from '@/components/record-ui';
import { openLocalDocument } from '@/components/local';
import { api } from '@/lib/api';
import type { Paper } from '@/lib/erp/records-parse';

export default function BookletsPage() {
  return (
    <DataGate title="Booklets">
      <Booklets />
    </DataGate>
  );
}

/** Newest term first: by academic year, then Even before Odd (Even comes later in the year). */
function termOrder(a: Paper, b: Paper) {
  const rank = (s: string) => (/even/i.test(s) ? 2 : /odd/i.test(s) ? 1 : 3);
  return b.academicYear.localeCompare(a.academicYear) || rank(b.semester) - rank(a.semester);
}

function Booklets() {
  const rec = useRecord('papers');
  const papers = useMemo(() => [...(rec.data?.papers ?? [])].sort(termOrder), [rec.data]);

  const groups = useMemo(() => {
    const out: [string, Paper[]][] = [];
    for (const p of papers) {
      const label = `${p.semester} ${p.academicYear}`;
      const last = out[out.length - 1];
      if (last && last[0] === label) last[1].push(p);
      else out.push([label, [p]]);
    }
    return out;
  }, [papers]);

  return (
    <div className="page-in">
      <PageHeader
        title="Booklets"
        sub={
          <RecordLine fetchedAt={rec.fetchedAt} loading={rec.loading} onRefresh={rec.refresh}>
            {papers.length > 0 && (
              <span className="tnum">
                {papers.length} evaluated paper{papers.length === 1 ? '' : 's'}
              </span>
            )}
          </RecordLine>
        }
      />
      <RecordProblem error={rec.error} code={rec.code} hasData={Boolean(rec.data)} />

      {!rec.data && rec.loading ? (
        <RecordSkeleton cards={4} />
      ) : papers.length === 0 ? (
        rec.data && (
          <Empty icon={Exam} title="No evaluated answer scripts on the ERP yet.">
            Once a mid-term is evaluated, its scanned booklet and each question&rsquo;s marks show up here.
          </Empty>
        )
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-9">
            {groups.map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="h2 mb-3 text-[20px]">{label}</h2>
                <ul className="grid items-start gap-2.5 md:grid-cols-2">
                  {list.map((p, i) => (
                    <Booklet key={`${p.courseCode}-${p.exam}-${i}`} paper={p} index={i} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <Footnote>
        From the ERP&rsquo;s In Sem Answer Scripts, read when you open this screen. A scan is read from the ERP when you open it;
        evaluator names are left out.
      </Footnote>
    </div>
  );
}

function Booklet({ paper: p, index }: { paper: Paper; index: number }) {
  const { active, local } = useStore();
  const [open, setOpen] = useState(false);
  const id = `booklet-${p.courseCode}-${index}`;
  const paper = { code: p.courseCode, exam: p.exam, ay: p.academicYear, sem: p.semester };
  const scan = p.hasScan && active && !local ? api(`/api/erp/booklet?${new URLSearchParams({ account: active, ...paper }).toString()}`) : null;
  return (
    <li className="card rise p-4 sm:p-5" style={{ '--i': index } as CSSProperties}>
      <div className="min-w-0">
        <p className="mono text-[12px] text-fg-3">{p.courseCode}</p>
        <h3 className="mt-1 line-clamp-2 text-[16px] font-semibold leading-snug pretty">{nameCase(p.courseName)}</h3>
        <p className="mt-0.5 truncate text-[12.5px] text-fg-2">{p.exam}</p>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          disabled={p.questions.length === 0}
          className="press inline-flex items-center gap-1 rounded-full bg-raised px-3 py-1.5 text-[13px] font-semibold text-fg hair hover:bg-raised-2 disabled:opacity-50"
        >
          {p.questions.length === 0 ? 'No question marks' : open ? 'Hide questions' : `${p.questions.length} questions`}
          {p.questions.length > 0 && (
            <span className="t-acc-chevron" aria-hidden>
              <CaretDown size={12} weight="bold" />
            </span>
          )}
        </button>
        {scan ? (
          <a href={scan} target="_blank" rel="noopener" className="btn btn-secondary btn-sm press">
            <FilePdf size={16} aria-hidden /> Open scan
          </a>
        ) : p.hasScan && local ? (
          // Without Google the scan is a form post, so the sealed login stays out of the address bar.
          <button type="button" onClick={() => openLocalDocument('/api/local/booklet', paper)} className="btn btn-secondary btn-sm press">
            <FilePdf size={16} aria-hidden /> Open scan
          </button>
        ) : (
          <span className="text-[12.5px] text-fg-3">No scan on the ERP</span>
        )}
      </div>
      <div className="t-acc" data-open={open}>
        <div className="t-acc-panel" id={id}>
          <div className="t-acc-panel-inner">
            {open && (
              <div className="grid grid-cols-3 gap-1.5 pt-3.5 sm:grid-cols-4">
                {p.questions.map((q) => (
                  <QuestionChip key={q.question} label={q.question} got={q.got} max={q.max} notWritten={q.notWritten} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
