'use client';

import { useEffect, useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { Segmented } from '@/components/segmented';
import { BubbleSheet } from '@/components/bubbles';
import { Figure } from '@/components/motion';
import { BAND_INK } from '@/components/course';
import { cn } from '@/components/cn';
import { bandLabel, ceilPct, COMPONENT_LABELS, COMPONENT_ORDER, policyBand, simpleAttendance, type ComponentKey } from '@/lib/math';

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
    <div className="page-in mx-auto max-w-[640px] py-6 lg:py-10">
      <h1 className="title-l">Calculator</h1>
      <p className="mt-1.5 text-[14px] text-dropout-text">For numbers you have in your head. No ERP needed.</p>
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
      <div className="mt-6">
        {mode === 'simple' ? (
          <Simple safeAt={settings.thresholds.safeAt} floor={settings.thresholds.condonationFrom} onSave={save} />
        ) : (
          <Components settings={settings} onSave={save} />
        )}
      </div>

      {saved.length > 0 && (
        <section className="mt-12" aria-label="Saved results">
          <h2 className="text-[13px] font-medium text-dropout-text">Saved results</h2>
          <ul className="mt-2">
            {saved.map((d, i) => (
              <li key={`${d.at}-${i}`} className="seam-b flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">{d.name}</p>
                  <p className="text-[12px] text-dropout-quiet">
                    {d.kind === 'simple' ? 'Attended / total' : 'By component'}, saved {new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="figure text-[22px]">{d.result}</span>
                  <button type="button" onClick={() => remove(i)} className="press inline-flex h-11 w-11 items-center justify-center rounded-full text-dropout-quiet hover:text-red" aria-label={`Delete ${d.name}`}>
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
      className="seam-t mt-6 flex items-end gap-2 pt-5"
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
        <input id="save-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" maxLength={40} />
      </div>
      <button type="submit" className="btn btn-line press" disabled={disabled || !name.trim()}>
        Save
      </button>
    </form>
  );
}

function Simple({ safeAt, floor, onSave }: { safeAt: number; floor: number; onSave: (s: Omit<Saved, 'at'>) => void }) {
  const [total, setTotal] = useState('');
  const [attended, setAttended] = useState('');
  const [target, setTarget] = useState<string>(String(safeAt));
  const t = whole(total);
  const a = whole(attended);
  const tgt = Number(target);
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
  const band = policyBand(r?.shown ?? null, { safeAt, condonationFrom: floor });

  let verdict: string | null = null;
  if (r) {
    if (r.shown >= tgt) verdict = r.spare > 0 ? `You can miss ${r.spare} more and still show ${tgt}%.` : `You’re on the ${tgt}% line. Missing the next class drops you below it.`;
    else verdict = Number.isFinite(r.needed) ? `Attend the next ${r.needed} in a row to reach ${tgt}%.` : `${tgt}% is out of reach from here.`;
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="calc-total">
            Classes held
          </label>
          <input id="calc-total" className="field tnum" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={err && total ? true : undefined} />
        </div>
        <div>
          <label className="label" htmlFor="calc-att">
            Classes attended
          </label>
          <input id="calc-att" className="field tnum" inputMode="numeric" value={attended} onChange={(e) => setAttended(e.target.value)} aria-invalid={err && attended ? true : undefined} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-[13px] text-dropout-text">Aim for</span>
        <Segmented
          label="Target"
          size="sm"
          value={target}
          onChange={setTarget}
          options={[
            { value: String(safeAt), label: `${safeAt}%` },
            { value: String(floor), label: `${floor}%` },
          ]}
        />
      </div>

      {err && (
        <p role="alert" className="mt-4 text-[14px] text-red">
          {err}
        </p>
      )}

      <div className="mt-6 rounded-2xl p-5 ring-seam" aria-live="polite">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[13px] text-dropout-text">The ERP would show</p>
            {r && <p className={cn('mt-0.5 text-[13px] font-semibold', BAND_INK[band])}>{bandLabel(band)}</p>}
          </div>
          {r && <Figure value={r.shown} className="figure text-[56px]" />}
        </div>
        {r && (
          <>
            <p className="mt-1 text-right text-[12px] text-dropout-quiet tnum">{r.exact.toFixed(2)}% before rounding up</p>
            <p className="mt-4 text-[15px] pretty">{verdict}</p>
            {t != null && a != null && t <= 140 && (
              <div className="mt-4">
                <BubbleSheet
                  attended={a}
                  conducted={t}
                  future={r.shown >= tgt ? { kind: 'spare', count: r.spare } : { kind: 'need', count: r.needed, tone: r.shown >= floor ? 'thin' : 'red' }}
                  label={`${a} of ${t} attended`}
                />
              </div>
            )}
          </>
        )}
        {!r && !err && <p className="mt-3 text-[14px] text-dropout-quiet">Enter the classes held and attended.</p>}
      </div>
      <SaveRow disabled={!r} onSave={(name) => r && onSave({ name, kind: 'simple', result: `${r.shown}%` })} />
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
  const { weights, thresholds } = settings;

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
  const band = policyBand(result?.shown ?? null, thresholds);

  return (
    <div>
      <p className="text-[14px] text-dropout-text pretty">
        Leave a component empty if the course doesn’t have it. Weights follow Settings: lecture {weights.L}, tutorial {weights.T}, practical {weights.P}, skilling {weights.S}.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {COMPONENT_ORDER.map((k) => (
          <div key={k}>
            <label className="label" htmlFor={`comp-${k}`}>
              {COMPONENT_LABELS[k]} %
            </label>
            <input
              id={`comp-${k}`}
              className="field tnum"
              inputMode="decimal"
              value={vals[k]}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {err && (
        <p role="alert" className="mt-4 text-[14px] text-red">
          {err}
        </p>
      )}
      <div className="mt-6 rounded-2xl p-5 ring-seam" aria-live="polite">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[13px] text-dropout-text">Weighted attendance</p>
            {result && <p className={cn('mt-0.5 text-[13px] font-semibold', BAND_INK[band])}>{bandLabel(band)}</p>}
          </div>
          {result && <Figure value={result.shown} className="figure text-[56px]" />}
        </div>
        {result ? (
          <p className="mt-1 text-right text-[12px] text-dropout-quiet tnum">{result.exact.toFixed(2)}% before rounding up</p>
        ) : (
          !err && <p className="mt-3 text-[14px] text-dropout-quiet">Enter at least one component.</p>
        )}
      </div>
      <SaveRow disabled={!result} onSave={(name) => result && onSave({ name, kind: 'components', result: `${result.shown}%` })} />
    </div>
  );
}
