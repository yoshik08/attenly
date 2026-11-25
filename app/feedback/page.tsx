'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ChatCircleText, CheckCircle, CircleNotch, XCircle, ClockCounterClockwise } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, Notice, PageHeader } from '@/components/page';
import { nameCase } from '@/components/record-ui';
import { localPost } from '@/components/local';
import { api } from '@/lib/api';
import { ago, useNow } from '@/lib/time';
import type { FeedbackResult, FeedbackRun } from '@/lib/erp/feedback';

export default function FeedbackPage() {
  return (
    <DataGate title="Feedback">
      <Feedback />
    </DataGate>
  );
}

const TYPE_LABEL: Record<string, string> = { L: 'Lecture', T: 'Tutorial', P: 'Practical', S: 'Skilling' };
const STORE_PREFIX = 'attenly:feedback:v1:';

interface Saved {
  run: FeedbackRun;
  at: string;
}

interface Failure {
  error: string;
  code: string | null;
}

function readSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function Feedback() {
  const { active, local, activeAccount } = useStore();
  const now = useNow(30_000);
  const key = `${STORE_PREFIX}${active ?? '-'}`;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const paused = local && Boolean(activeAccount?.needsPassword);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the last run on this device paints after hydration
    setSaved(readSaved(key));
    setFailure(null);
  }, [key]);

  const force = async () => {
    if (!active || busy) return;
    if (paused) {
      setFailure({ error: 'The ERP rejected the saved password. Enter your current ERP password on the Attendance tab first.', code: 'needs_password' });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = local
        ? await localPost('/api/local/feedback', {})
        : await fetch(api(`/api/erp/feedback?account=${encodeURIComponent(active)}`), { method: 'POST', cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; run?: FeedbackRun; at?: string; error?: string; code?: string };
      if (!res.ok || !d.ok || !d.run) {
        setFailure({
          error: d.error ?? (res.status === 429 ? 'The ERP is rate-limiting Attenly. Wait a minute and try again.' : 'The ERP didn’t answer, so no feedback was submitted.'),
          code: d.code ?? (res.status === 429 ? 'rate_limited' : null),
        });
        return;
      }
      const next = { run: d.run, at: d.at ?? new Date().toISOString() };
      setSaved(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* the result still shows; it just won't be here after a reload */
      }
    } catch {
      setFailure({ error: 'You look offline. Nothing was sent to the ERP.', code: 'offline' });
    } finally {
      setBusy(false);
    }
  };

  const run = saved?.run ?? null;
  const results = run?.results ?? [];
  const done = results.filter((r) => r.status !== 'failed');
  const failed = results.filter((r) => r.status === 'failed');
  const fresh = results.filter((r) => r.status === 'submitted').length;
  const allGood = run != null && results.length > 0 && failed.length === 0 && !run.stopped;

  return (
    <div className="page-in max-w-[960px]">
      <PageHeader
        title="Feedback"
        sub={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span>Every pending faculty form on the ERP, answered &ldquo;Good&rdquo; on every question.</span>
            {saved && <span className="text-fg-3">Last run {ago(saved.at, now)}</span>}
          </span>
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={force} disabled={busy || !active}>
            {busy ? <CircleNotch size={18} className="spin" aria-hidden /> : <ChatCircleText size={18} weight="fill" aria-hidden />}
            {busy ? 'Submitting…' : 'Force submit'}
          </button>
        }
      />

      <div aria-live="polite" className="contents">
        {busy && (
          <p className="mt-6 text-[14px] text-fg-2">
            <span className="t-shimmer" data-text="Opening each faculty’s form on the ERP and filing it. This takes about half a minute.">
              Opening each faculty&rsquo;s form on the ERP and filing it. This takes about half a minute.
            </span>
          </p>
        )}

        {failure && (
          <Notice tone="detained" role="alert" title={failure.code === 'rate_limited' ? 'The ERP is rate-limiting Attenly' : 'Feedback was not submitted'} className="mt-6">
            {failure.error}
            {saved && ' The list below is from the last run, not this one.'}
          </Notice>
        )}

        {!busy && run && !failure && (
          <div className="mt-6">
            {results.length === 0 ? (
              <Empty icon={ChatCircleText} title="No feedback forms are open on the ERP." className="mt-0">
                When the university opens feedback for your courses, press Force submit again.
              </Empty>
            ) : allGood ? (
              <Banner tone="safe" Icon={CheckCircle} title={`Feedback is in for all ${results.length} faculty forms`}>
                {fresh === results.length
                  ? `Attenly filed every form now and found the answers on the ERP afterwards.`
                  : fresh === 0
                    ? `Every form was already filed before this run, so nothing was sent twice.`
                    : `${fresh} filed now, ${results.length - fresh} were already filed (left alone).`}
                {run.term && <> {run.term}.</>}
              </Banner>
            ) : (
              <Notice tone="detained" role="alert" title={`${failed.length} of ${results.length} forms didn’t go through`}>
                {run.stopped ? `${run.stopped} ` : ''}
                {done.length > 0 && `${done.length} ${done.length === 1 ? 'is' : 'are'} on the ERP. `}Press Force submit again to retry the rest; filed forms are skipped.
              </Notice>
            )}
          </div>
        )}
      </div>

      {!busy && results.length > 0 && <ResultList results={results} />}

      {!run && !busy && !failure && (
        <Empty icon={ClockCounterClockwise} title="Nothing submitted from this device yet.">
          Force submit signs into the ERP, opens Feedback → Submit, and files every faculty form listed there with &ldquo;Good&rdquo; for each
          question. Forms already filed this term are skipped.
        </Empty>
      )}

      <Footnote>
        This is the one screen where Attenly writes to the ERP, and only when you press the button. Afterwards it reads the ERP&rsquo;s own feedback
        results back, so &ldquo;Submitted&rdquo; means the ERP has the answers on file.
      </Footnote>
    </div>
  );
}

function Banner({ tone, Icon, title, children }: { tone: string; Icon: typeof CheckCircle; title: string; children?: React.ReactNode }) {
  return (
    <div role="status" data-tone={tone} className="card glow rounded-[20px] p-4" style={{ '--gs': '280px', '--gx': '-130px', '--gy': '-150px' } as CSSProperties}>
      <div className="flex gap-3">
        <Icon size={20} weight="fill" className="mt-px shrink-0 text-tone" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{title}</p>
          {children && <div className="mt-1 text-[13.5px] leading-relaxed text-fg-2 pretty">{children}</div>}
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<FeedbackResult['status'], { label: string; tone: string; Icon: typeof CheckCircle }> = {
  submitted: { label: 'Submitted', tone: 'safe', Icon: CheckCircle },
  already: { label: 'Already filed', tone: 'safe', Icon: CheckCircle },
  failed: { label: 'Failed', tone: 'detained', Icon: XCircle },
};

function ResultList({ results }: { results: FeedbackResult[] }) {
  const groups: { code: string; title: string; items: FeedbackResult[] }[] = [];
  for (const r of results) {
    const g = groups.find((x) => x.code === r.code);
    if (g) g.items.push(r);
    else groups.push({ code: r.code, title: r.title, items: [r] });
  }
  return (
    <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-3 md:grid-cols-2 lg:gap-4">
      {groups.map((g, i) => {
        const title = nameCase(g.title || g.code);
        return (
          <article key={g.code} className="card rise min-w-0 p-5" style={{ '--i': i } as CSSProperties} aria-label={title}>
            <p className="mono text-[12px] text-fg-3">{g.code}</p>
            <h3 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] pretty">{title}</h3>
            <ul className="mt-4 flex flex-col gap-1.5">
              {g.items.map((r, j) => {
                const s = STATUS[r.status];
                return (
                  <li key={`${r.component}-${r.faculty}-${j}`} className="rounded-[12px] bg-white/[0.035] text-[13px]">
                    <details className="group/fb">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-fg">{nameCase(r.faculty)}</span>
                          <span className="mt-0.5 block text-[12px] text-fg-3">
                            {TYPE_LABEL[r.component] ?? r.component}
                            {r.section && <span className="mono"> · {r.section}</span>}
                            {r.questions.length > 0 && ` · ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}`}
                          </span>
                        </span>
                        <span data-tone={s.tone} className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-tone">
                          <s.Icon size={15} weight="fill" aria-hidden />
                          {s.label}
                        </span>
                      </summary>
                      <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
                        {r.error && <p className="mb-2 text-[12.5px] leading-snug text-fg-2 pretty">{r.error}</p>}
                        {r.shared && (
                          <p className="mb-2 text-[12px] leading-snug text-fg-3 pretty">Every answer on file for this faculty in this course; the ERP doesn&rsquo;t say which of their forms each came from.</p>
                        )}
                        {r.questions.length > 0 ? (
                          <ol className="flex flex-col gap-1.5">
                            {r.questions.map((q, k) => (
                              <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
                                <span className="text-[12.5px] leading-snug text-fg-2 pretty">{q.text}</span>
                                <span className="text-[12.5px] font-semibold text-fg">{q.answer}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          !r.error && <p className="text-[12.5px] text-fg-3">No answers recorded.</p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
