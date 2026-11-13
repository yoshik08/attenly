'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowsClockwise, CaretDown, IdentificationCard, Minus, Plus, SignOut, Trash } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { Sheet } from '@/components/overlay';
import { LinkForm } from '@/components/link-form';
import { BootScreen } from '@/components/states';
import { SignIn } from '@/components/gate';
import { PageHeader } from '@/components/page';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, COMPONENT_ORDER, DEFAULT_TARGET, DEFAULT_WEIGHTS, TARGETS, type ComponentKey } from '@/lib/math';
import { ago, useNow } from '@/lib/time';
import { Segmented } from '@/components/segmented';
import { termText, yearsNewestFirst } from '@/lib/terms';
import { courseTitle } from '@/lib/insights';

export default function SettingsPage() {
  const { phase } = useStore();
  if (phase === 'boot') return <BootScreen />;
  if (phase === 'signed-out') return <SignIn />;
  return <Settings />;
}

function Section({ id, title, children, note }: { id?: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pt-10">
      <h2 className="h2 text-[18px]">{title}</h2>
      {note && <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-fg-2 pretty">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A two-step destructive button: the first tap arms it, the second confirms. */
function ConfirmButton({ label, confirm, onConfirm, busy }: { label: string; confirm: string; onConfirm: () => void; busy?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm press lg lg-btn"
      data-armed={armed}
      disabled={busy}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      <Trash size={15} aria-hidden />
      {busy ? 'Removing…' : armed ? confirm : label}
    </button>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          className="field appearance-none pr-10 lg lg-input"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <CaretDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-2" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Which year and semester the shown ERP account syncs: automatic (the newest
 * term with attendance on the ERP) or one picked from the ERP's own lists.
 */
function SemesterSection() {
  const { activeAccount, snapshot, setTerm, sync } = useStore();
  const options = snapshot?.termOptions ?? null;
  const years = options ? yearsNewestFirst(options.years) : [];
  const semesters = options?.semesters ?? [];
  const chosen = activeAccount?.term ?? null;
  const [mode, setMode] = useState<'auto' | 'choose'>(chosen ? 'choose' : 'auto');
  const [year, setYear] = useState(chosen?.academicyear ?? snapshot?.term.academicyear ?? years[0]?.id ?? '');
  const [sem, setSem] = useState(chosen?.semesterid ?? snapshot?.term.semesterid ?? semesters[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!activeAccount) return null;

  const apply = async (term: { academicyear: string; semesterid: string } | null) => {
    setBusy(true);
    setError(null);
    const r = await setTerm(term);
    if (!r.ok) setError(r.error ?? 'Could not change the semester.');
    setBusy(false);
  };
  const pending = busy || sync.running;
  const showing = termText(snapshot?.term);
  const sameAsChosen = chosen && chosen.academicyear === year && chosen.semesterid === sem;

  return (
    <Section
      id="semester"
      title="Semester"
      note="Attenly shows the newest semester you have courses in on the ERP. Pick one yourself to look back at an earlier semester."
    >
      <div className="card p-4 sm:p-5 lg lg-card lg-frost">
      <Segmented
        label="Semester choice"
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m === 'auto' && chosen) void apply(null);
        }}
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'choose', label: 'Choose' },
        ]}
      />
      {mode === 'auto' ? (
        <p className="mt-4 text-[14px] text-fg-2" aria-live="polite">
          {pending ? 'Finding your newest semester…' : showing ? `Showing ${showing}.` : 'Sync once to find your semester.'}
        </p>
      ) : !options ? (
        <p className="mt-4 text-[14px] text-fg-2">Sync once to load the ERP’s list of semesters.</p>
      ) : (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id="term-year" label="Academic year" value={year} onChange={setYear} options={years} disabled={pending} />
            <Select id="term-sem" label="Semester" value={sem} onChange={setSem} options={semesters} disabled={pending} />
          </div>
          <button
            type="button"
            className="btn btn-primary press mt-4 lg lg-btn"
            disabled={pending || !year || !sem || Boolean(sameAsChosen && !error)}
            onClick={() => void apply({ academicyear: year, semesterid: sem })}
          >
            <ArrowsClockwise size={18} className={pending ? 'spin' : ''} aria-hidden />
            {pending ? 'Syncing…' : sameAsChosen ? `Showing ${showing}` : 'Sync this semester'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-det">
          {error}
        </p>
      )}
      </div>
    </Section>
  );
}

function NumberField({
  id,
  label,
  value,
  onCommit,
  min,
  max,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  hint?: string;
}) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(String(value));
  }
  const n = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field tnum lg lg-input"
        inputMode="decimal"
        value={text}
        aria-invalid={valid ? undefined : true}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onCommit(v);
        }}
        onBlur={() => {
          if (!valid) setText(String(value));
        }}
      />
      {hint && <p className="mt-1.5 text-[12px] text-fg-3">{hint}</p>}
    </div>
  );
}

function Settings() {
  const store = useStore();
  const { settings, updateSettings, accounts, active, user, snapshot } = store;
  const { target, weights, tcbr } = settings;
  const now = useNow(30_000);
  const [repair, setRepair] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accError, setAccError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  // Re-mount the semester picker when the shown account or its synced term changes.
  const activeAccountKey = `${active ?? ''}|${store.activeAccount?.term ? `${store.activeAccount.term.academicyear}:${store.activeAccount.term.semesterid}` : 'auto'}|${snapshot?.termOptions ? 'o' : ''}`;

  const setTcbr = (code: string, v: number) => {
    const perCourse = { ...tcbr.perCourse };
    if (v <= 0) delete perCourse[code];
    else perCourse[code] = v;
    updateSettings({ tcbr: { ...tcbr, perCourse } });
  };

  return (
    <div className="page-in max-w-[780px]">
      <PageHeader title="Settings" />

      <Section id="accounts" title="ERP accounts" note="Each linked account syncs on its own. The primary one opens first.">
        {accounts.length === 0 ? (
          <p className="text-[14px] text-fg-2">No ERP account linked yet. Link one on the Attendance tab.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {accounts.map((a) => (
              <li key={a.universityId} className="card p-4 sm:p-5 lg lg-card lg-frost">
                <div className="flex items-start gap-3.5">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-raised hair">
                    <IdentificationCard size={22} className="text-fg-2" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
                      {a.label ?? <span className="mono">{a.universityId}</span>}
                      {a.primary && <span data-tone="none" className="chip !min-h-[22px] !text-[11px] lg lg-pill">primary</span>}
                      {a.universityId === active && <span data-tone="safe" className="chip !min-h-[22px] !text-[11px] lg lg-pill">showing</span>}
                    </p>
                    {a.label && <p className="mono text-[12.5px] text-fg-3">{a.universityId}</p>}
                    <p className={cn('mt-1 text-[13px]', a.needsPassword ? 'text-cond' : a.lastError ? 'text-det' : 'text-fg-2')}>
                      {a.needsPassword
                        ? (a.lastError?.message ?? 'Syncing is paused until you enter the ERP password again.')
                        : a.lastError
                          ? `Last sync didn’t finish: ${a.lastError.message}`
                          : a.lastSyncAt
                            ? `Synced ${ago(a.lastSyncAt, now)}`
                            : 'Not synced yet'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 hair-t pt-4">
                  <div className="flex flex-wrap gap-2">
                    {a.universityId !== active && (
                      <button type="button" className="btn btn-secondary btn-sm press lg lg-btn" onClick={() => void store.switchAccount(a.universityId)}>
                        Show this account
                      </button>
                    )}
                    {!a.primary && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm press lg lg-btn"
                        disabled={busyId === a.universityId}
                        onClick={async () => {
                          setBusyId(a.universityId);
                          setAccError(null);
                          const r = await store.makePrimary(a.universityId);
                          if (!r.ok) setAccError(r.error ?? null);
                          setBusyId(null);
                        }}
                      >
                        Make primary
                      </button>
                    )}
                    <button type="button" className={cn('btn btn-sm press lg lg-btn', a.needsPassword ? 'btn-primary' : 'btn-secondary')} onClick={() => setRepair(a.universityId)}>
                      {a.needsPassword ? 'Enter password' : 'Change password'}
                    </button>
                  </div>
                  <ConfirmButton
                    label="Remove"
                    confirm="Remove it and its data"
                    busy={busyId === `rm-${a.universityId}`}
                    onConfirm={async () => {
                      setBusyId(`rm-${a.universityId}`);
                      setAccError(null);
                      const r = await store.removeAccount(a.universityId);
                      if (!r.ok) setAccError(r.error ?? null);
                      setBusyId(null);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {accError && (
          <p role="alert" className="mt-3 text-[14px] text-det">
            {accError}
          </p>
        )}
        <button type="button" className="btn btn-secondary press mt-3 lg lg-btn" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Link another ERP account
        </button>
      </Section>

      <SemesterSection key={activeAccountKey} />

      <Section
        id="target"
        title="Target attendance"
        note="One figure for the whole app: the bands on every course, the rings, the verdicts, the calculator, Plan the day and Forecast. The college's bands themselves (85 safe, 75 condonation, 65 medical, below that detained) do not move."
      >
        <div className="card p-4 sm:p-5 lg lg-card lg-frost">
        <Segmented
          label="Target attendance"
          value={String(target)}
          onChange={(v) => updateSettings({ target: v === '75' ? 75 : 85 })}
          options={TARGETS.map((t) => ({
            value: String(t),
            label: `${t}%`,
            hint: t === 75 ? 'Hold the condonation line' : 'Hold the safe line',
          }))}
        />
        <p className="mt-3 text-[13.5px] text-fg-2 pretty">
          {target === 85
            ? 'Budgets aim at 85%: a course under it can still be condoned down to 75%.'
            : 'Budgets aim at 75%: the condonation floor, with detention below it at 65%.'}
        </p>
        {target !== DEFAULT_TARGET && (
          <button type="button" className="btn btn-secondary btn-sm press mt-4 lg lg-btn" onClick={() => updateSettings({ target: DEFAULT_TARGET })}>
            Back to {DEFAULT_TARGET}%
          </button>
        )}
        </div>
      </Section>

      <Section title="Class weights" note="How much each class type counts. The ERP uses lecture 100, tutorial 100, practical 50, skilling 25.">
        <div className="card p-4 sm:p-5 lg lg-card lg-frost">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COMPONENT_ORDER.map((k: ComponentKey) => (
            <NumberField key={k} id={`w-${k}`} label={COMPONENT_LABELS[k]} value={weights[k]} min={0} max={1000} onCommit={(v) => updateSettings({ weights: { ...weights, [k]: v } })} />
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm press mt-4 lg lg-btn" onClick={() => updateSettings({ weights: DEFAULT_WEIGHTS })}>
          Reset to {DEFAULT_WEIGHTS.L} / {DEFAULT_WEIGHTS.T} / {DEFAULT_WEIGHTS.P} / {DEFAULT_WEIGHTS.S}
        </button>
        </div>
      </Section>

      <Section title="Late-joiner fix" note="Joined a course late? The ERP drops classes held before you registered. Tell Attenly how many, per course, so the figures match.">
        <div className="grouped lg lg-card lg-frost">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
            <span id="tcbr-label" className="text-[15px] font-medium">Leave out classes held before I registered</span>
            <button
              type="button"
              role="switch"
              aria-checked={tcbr.enabled}
              aria-labelledby="tcbr-label"
              onClick={() => updateSettings({ tcbr: { ...tcbr, enabled: !tcbr.enabled } })}
              className="switch press"
            />
          </div>
          {tcbr.enabled && (snapshot?.attendance ?? []).length === 0 && (
            <p className="px-4 py-3.5 text-[14px] text-fg-2 sm:px-5">Courses appear here after your first sync.</p>
          )}
          {tcbr.enabled &&
            (snapshot?.attendance ?? []).map((s) => {
              const v = tcbr.perCourse[s.code] ?? 0;
              return (
                <div key={s.code} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{courseTitle(s.title, s.code)}</p>
                    <p className="mono text-[12px] text-fg-3">{s.code}</p>
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={`Classes before registration for ${s.code}`}>
                    <button type="button" className="icon-btn press !h-10 !w-10 lg lg-btn" disabled={v <= 0} onClick={() => setTcbr(s.code, v - 1)} aria-label="One fewer">
                      <Minus size={15} weight="bold" aria-hidden />
                    </button>
                    <span className="figure w-8 text-center text-[20px]">{v}</span>
                    <button type="button" className="icon-btn press !h-10 !w-10 lg lg-btn" disabled={v >= 60} onClick={() => setTcbr(s.code, v + 1)} aria-label="One more">
                      <Plus size={15} weight="bold" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </Section>

      <Section title="Google account">
        <div className="card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 lg lg-card lg-frost">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{user?.name ?? 'Signed in'}</p>
            {user?.email && <p className="truncate text-[13.5px] text-fg-2">{user.email}</p>}
          </div>
          <button type="button" className="btn btn-danger btn-sm press lg lg-btn" onClick={() => void store.signOut()}>
            <SignOut size={15} aria-hidden /> Sign out of Google
          </button>
        </div>
      </Section>

      <Section title="This device" note="Attenly keeps a copy of your last sync, your settings and saved calculator results in this browser so the app opens instantly.">
        {cleared ? (
          <p className="text-[14px] text-safe">Cleared. The next load pulls everything from the cloud again.</p>
        ) : (
          <ConfirmButton
            label="Forget data on this device"
            confirm="Yes, forget it"
            onConfirm={() => {
              store.clearDevice();
              setCleared(true);
            }}
          />
        )}
      </Section>

      <p className="pt-12 text-[12.5px] text-fg-3">
        Attenly is an unofficial student project, not affiliated with KL University.{' '}
        <Link href="/privacy" className="link">
          Privacy
        </Link>
      </p>

      <Sheet open={repair !== null} onClose={() => setRepair(null)} title={accounts.find((a) => a.universityId === repair)?.needsPassword ? 'Enter your ERP password' : 'Change the saved password'}>
        {repair && (
          <LinkForm
            mode="repair"
            universityId={repair}
            onLinked={(id, snap) => {
              setRepair(null);
              void store.onLinked(id, snap);
            }}
          />
        )}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Link another ERP account">
        {adding && (
          <LinkForm
            mode="add"
            onLinked={(id, snap) => {
              setAdding(false);
              void store.onLinked(id, snap);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
