'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { Segmented } from '@/components/segmented';
import { BubbleSheet } from '@/components/bubbles';
import { Ring } from '@/components/ring';
import { PageHeader } from '@/components/page';
import { cn } from '@/components/cn';
import { ceilPct, COMPONENT_LABELS, COMPONENT_ORDER, simpleAttendance, statusOf, type ComponentKey, type Status } from '@/lib/math';

interface Saved {
  name: string;
  kind: 'simple' | 'components';
  result: string;
  at: string;
}

const SAVED_KEY = 'attenly:calc-drafts';

function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((d) => d && typeof d.name === 'string' && typeof d.result === 'string') : [];
  } catch {
    return [];
  }
}
function writeSaved(list: Saved[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage unavailable */
  }
}

/** Whole numbers only: "28", not "28.5" or "-3". */
function whole(v: string): number | null {
  if (!/^\d{1,4}$/.test(v.trim())) return null;
  return Number(v.trim());
}

export default function CalculatorPage() {
  const { settings } = useStore();
  const [mode, setMode] = useState<'simple' | 'components'>('simple');
  const [saved, setSaved] = useState<Saved[]>([]);
  useEffect(() => {
    // Saved results live in this browser; read them after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(readSaved());
  }, []);
  const save = (s: Omit<Saved, 'at'>) => {
    const next = [{ ...s, at: new Date().toISOString() }, ...readSaved()].slice(0, 20);
    writeSaved(next);
    setSaved(next);
  };
  const remove = (i: number) => {
    const next = saved.filter((_, j) => j !== i);
    writeSaved(next);
    setSaved(next);
  };

  return (
    <div className="page-in max-w-[1000px]">
      <PageHeader title="Calculator" sub="For numbers you have in your head. No ERP needed." />
      <Segmented
        className="mt-6"
        label="Calculator"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'simple', label: 'Attended / total' },
          { value: 'components', label: 'By component' },
        ]}
      />
      <div className="mt-5">
        {mode === 'simple' ? <Simple target={settings.target} onSave={save} /> : <Components settings={settings} onSave={save} />}
      </div>

      {saved.length > 0 && (
        <section className="mt-12" aria-label="Saved results">
          <h2 className="h2">Saved results</h2>
          <ul className="card mt-4 px-4 lg lg-card lg-frost">
            {saved.map((d, i) => (
              <li key={`${d.at}-${i}`} className={cn('flex items-center justify-between gap-3 py-3', i > 0 && 'hair-t')}>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{d.name}</p>
                  <p className="text-[12px] text-fg-3">
                    {d.kind === 'simple' ? 'Attended / total' : 'By component'}, saved{' '}
                    {new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="figure text-[24px]">{d.result}</span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="press inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-3 hover:bg-det/12 hover:text-det lg-press"
                    aria-label={`Delete ${d.name}`}
                  >
                    <Trash size={17} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SaveRow({ disabled, onSave }: { disabled: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="mt-4 flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || !name.trim()) return;
        onSave(name.trim());
        setName('');
      }}
    >
      <div className="flex-1">
        <label className="label" htmlFor="save-name">
          Save this result as
        </label>
        <input id="save-name" className="field lg lg-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" maxLength={40} />
      </div>
      <button type="submit" className="btn btn-secondary press min-h-[48px] lg lg-btn" disabled={disabled || !name.trim()}>
        Save
      </button>
    </form>
  );
}

function BigField({
  id,
  label,
  value,
  onChange,
  invalid,
  decimal = false,
  suffix,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  decimal?: boolean;
  suffix?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="field figure !min-h-[64px] !text-[28px] lg lg-input"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid ? true : undefined}
        />
        {suffix && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-fg-3">{suffix}</span>}
      </div>
    </div>
  );
}

function Answer({
  value,
  status,
  target,
  title,
  verdict,
  exact,
  children,
  empty,
}: {
  value: number | null;
  status: Status | null;
  target: number;
  title: string;
  verdict?: string | null;
  exact?: string | null;
  children?: React.ReactNode;
  empty: string;
}) {
  return (
    <div
      data-tone={status ?? 'none'}
      className="card glow p-5 sm:p-6 lg lg-card"
      style={{ '--gs': '420px', '--gx': '-170px', '--gy': '-200px' } as React.CSSProperties}
      aria-live="polite"
    >
      <div className="flex items-center gap-5">
        <Ring value={value} tone={status} target={target} size={124} stroke={10} />
        <div className="min-w-0">
          <p className="text-[13px] text-fg-2">{title}</p>
          {value != null ? (
            <>
              <p className="mt-1 text-[17px] font-semibold text-tone">{value >= target ? 'At or above target' : 'Below target'}</p>
              {exact && <p className="mono mt-1 text-[12px] text-fg-3">{exact}</p>}
            </>
          ) : (
            <p className="mt-1 text-[15px] text-fg-3">{empty}</p>
          )}
        </div>
      </div>
      {verdict && <p className="mt-5 text-[16px] leading-snug pretty">{verdict}</p>}
      {children}
    </div>
  );
}

function Simple({ target, onSave }: { target: number; onSave: (s: Omit<Saved, 'at'>) => void }) {
  const [total, setTotal] = useState('');
  const [attended, setAttended] = useState('');
  const t = whole(total);
  const a = whole(attended);
  const tgt = target;
  const err =
    total && t === null
      ? 'Total classes is a whole number.'
      : attended && a === null
        ? 'Classes attended is a whole number.'
        : t != null && a != null && a > t
          ? 'You can’t attend more classes than were held.'
          : t === 0
            ? 'Total classes has to be at least 1.'
            : null;
  const r = t != null && a != null && !err ? simpleAttendance(a, t, tgt) : null;
  const status = statusOf(r?.shown ?? null);

  let verdict: string | null = null;
  if (r) {
    if (r.shown >= tgt) verdict = r.spare > 0 ? `You can miss ${r.spare} more and still show ${tgt}%.` : `You’re on the ${tgt}% line. Missing the next class drops you below it.`;
    else verdict = Number.isFinite(r.needed) ? `Attend the next ${r.needed} in a row to reach ${tgt}%.` : `${tgt}% is out of reach from here.`;
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
      <div className="card p-5 sm:p-6 lg lg-card lg-frost">
        <div className="grid grid-cols-2 gap-3">
          <BigField id="calc-total" label="Classes held" value={total} onChange={setTotal} invalid={Boolean(err && total)} />
          <BigField id="calc-att" label="Classes attended" value={attended} onChange={setAttended} invalid={Boolean(err && attended)} />
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
          <span>Aim for {tgt}%</span>
          <Link href="/forecast" className="link">
            Change the target
          </Link>
        </p>
        {err && (
          <p role="alert" className="mt-3 text-[14px] text-det">
            {err}
          </p>
        )}
        <SaveRow disabled={!r} onSave={(name) => r && onSave({ name, kind: 'simple', result: `${r.shown}%` })} />
      </div>
      <Answer
        value={r?.shown ?? null}
        status={status}
        target={tgt}
        title="The ERP would show"
        verdict={verdict}
        exact={r ? `${r.exact.toFixed(2)}% before rounding up` : null}
        empty="Enter the classes held and attended."
      >
        {r && t != null && a != null && t <= 140 && (
          <div className="mt-4">
            <BubbleSheet
              attended={a}
              conducted={t}
              future={r.shown >= tgt ? { kind: 'spare', count: r.spare } : { kind: 'need', count: r.needed, tone: r.shown >= 75 ? 'thin' : 'red' }}
              label={`${a} of ${t} attended`}
            />
          </div>
        )}
      </Answer>
    </div>
  );
}

function Components({
  settings,
  onSave,
}: {
  settings: ReturnType<typeof useStore>['settings'];
  onSave: (s: Omit<Saved, 'at'>) => void;
}) {
  const [vals, setVals] = useState<Record<ComponentKey, string>>({ L: '', T: '', P: '', S: '' });
  const { weights, target } = settings;

  const { result, err } = (() => {
    let num = 0;
    let den = 0;
    for (const k of COMPONENT_ORDER) {
      const raw = vals[k].trim();
      if (!raw) continue; // not part of this course
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return { result: null, err: `${COMPONENT_LABELS[k]} needs a percentage like 82 or 82.5.` };
      const v = Number(raw);
      if (v > 100) return { result: null, err: `${COMPONENT_LABELS[k]} can’t be above 100%.` };
      num += v * weights[k];
      den += 100 * weights[k];
    }
    if (den === 0) return { result: null, err: null };
    return { result: { exact: Math.round((num / den) * 10000) / 100, shown: ceilPct(num, den) }, err: null };
  })();
  const status = statusOf(result?.shown ?? null);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
      <div className="card p-5 sm:p-6 lg lg-card lg-frost">
        <p className="text-[14px] text-fg-2 pretty">
          Leave a component empty if the course doesn’t have it. Weights follow Settings: lecture {weights.L}, tutorial {weights.T},
          practical {weights.P}, skilling {weights.S}.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {COMPONENT_ORDER.map((k) => (
            <BigField
              key={k}
              id={`comp-${k}`}
              label={`${COMPONENT_LABELS[k]} %`}
              value={vals[k]}
              decimal
              suffix="%"
              onChange={(v) => setVals((x) => ({ ...x, [k]: v }))}
            />
          ))}
        </div>
        {err && (
          <p role="alert" className="mt-3 text-[14px] text-det">
            {err}
          </p>
        )}
        <SaveRow disabled={!result} onSave={(name) => result && onSave({ name, kind: 'components', result: `${result.shown}%` })} />
      </div>
      <Answer
        value={result?.shown ?? null}
        status={status}
        target={target}
        title="Weighted attendance"
        exact={result ? `${result.exact.toFixed(2)}% before rounding up` : null}
        empty={err ? 'Fix the highlighted figure.' : 'Enter at least one component.'}
      />
    </div>
  );
}
