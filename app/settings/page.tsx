'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowsClockwise, CaretDown, Minus, Plus, SignOut, Trash } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { Sheet } from '@/components/overlay';
import { LinkForm } from '@/components/link-form';
import { BootScreen } from '@/components/states';
import { SignIn } from '@/components/gate';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, COMPONENT_ORDER, DEFAULT_TARGET, DEFAULT_WEIGHTS, TARGETS, type ComponentKey } from '@/lib/math';
import { ago, useNow } from '@/lib/time';
import { Segmented } from '@/components/segmented';
import { termText, yearsNewestFirst } from '@/lib/terms';

export default function SettingsPage() {
  const { phase } = useStore();
  if (phase === 'boot') return <BootScreen />;
  if (phase === 'signed-out') return <SignIn />;
  return <Settings />;
}

function Section({ id, title, children, note }: { id?: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="seam-b scroll-mt-24 py-8">
      <h2 className="title-s text-[19px]">{title}</h2>
      {note && <p className="mt-1.5 max-w-[60ch] text-[14px] text-dropout-text pretty">{note}</p>}
      <div className="mt-5">{children}</div>
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
      className="btn btn-danger btn-sm press"
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
          className="field appearance-none pr-10"
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
        <CaretDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-dropout-text" aria-hidden />
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
        <p className="mt-4 text-[14px] text-dropout-text" aria-live="polite">
          {pending ? 'Finding your newest semester…' : showing ? `Showing ${showing}.` : 'Sync once to find your semester.'}
        </p>
      ) : !options ? (
        <p className="mt-4 text-[14px] text-dropout-text">Sync once to load the ERP’s list of semesters.</p>
      ) : (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id="term-year" label="Academic year" value={year} onChange={setYear} options={years} disabled={pending} />
            <Select id="term-sem" label="Semester" value={sem} onChange={setSem} options={semesters} disabled={pending} />
          </div>
          <button
            type="button"
            className="btn btn-mark press mt-4"
            disabled={pending || !year || !sem || Boolean(sameAsChosen && !error)}
            onClick={() => void apply({ academicyear: year, semesterid: sem })}
          >
            <ArrowsClockwise size={18} className={pending ? 'spin' : ''} aria-hidden />
            {pending ? 'Syncing…' : sameAsChosen ? `Showing ${showing}` : 'Sync this semester'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-red">
          {error}
        </p>
      )}
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
        className="field tnum"
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
      {hint && <p className="mt-1.5 text-[12px] text-dropout-quiet">{hint}</p>}
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
    <div className="page-in mx-auto max-w-[720px] py-6 lg:py-10">
      <h1 className="title-l">Settings</h1>

      <Section id="accounts" title="ERP accounts" note="Each linked account syncs on its own. The primary one opens first.">
        {accounts.length === 0 ? (
          <p className="text-[14px] text-dropout-text">No ERP account linked yet. Link one on the Attendance tab.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {accounts.map((a) => (
              <li key={a.universityId} className="rounded-2xl p-4 ring-seam">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold">
                      {a.label ?? <span className="tnum">{a.universityId}</span>}
                      {a.primary && <span className="ml-2 rounded-full bg-[#121826] px-2 py-0.5 align-middle text-[11px] font-medium text-dropout-text">primary</span>}
                      {a.universityId === active && <span className="ml-2 rounded-full bg-[#0d1a14] px-2 py-0.5 align-middle text-[11px] font-medium text-cruise">showing</span>}
                    </p>
                    {a.label && <p className="text-[13px] text-dropout-quiet tnum">{a.universityId}</p>}
                    <p className={cn('mt-1 text-[13px]', a.needsPassword ? 'text-thin' : a.lastError ? 'text-[#ffb4ab]' : 'text-dropout-text')}>
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {a.universityId !== active && (
                      <button type="button" className="btn btn-line btn-sm press" onClick={() => void store.switchAccount(a.universityId)}>
                        Show this account
                      </button>
                    )}
                    {!a.primary && (
                      <button
                        type="button"
                        className="btn btn-line btn-sm press"
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
                    <button type="button" className={cn('btn btn-sm press', a.needsPassword ? 'btn-mark' : 'btn-line')} onClick={() => setRepair(a.universityId)}>
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
          <p role="alert" className="mt-3 text-[14px] text-red">
            {accError}
          </p>
        )}
        <button type="button" className="btn btn-line press mt-4" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Link another ERP account
        </button>
      </Section>

      <SemesterSection key={activeAccountKey} />

      <Section
        title="Target attendance"
        note="One figure for the whole app: the bands on every course, the rings, the verdicts, the calculator, Plan the day and Forecast. The college's bands themselves (85 safe, 75 condonation, 65 medical, below that detained) do not move."
      >
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
        <p className="mt-3 text-[13px] text-dropout-text pretty">
          {target === 85
            ? 'Budgets aim at 85%: a course under it can still be condoned down to 75%.'
            : 'Budgets aim at 75%: the detention line, with condonation above it.'}
        </p>
        {target !== DEFAULT_TARGET && (
          <button type="button" className="btn btn-line btn-sm press mt-4" onClick={() => updateSettings({ target: DEFAULT_TARGET })}>
            Back to {DEFAULT_TARGET}%
          </button>
        )}
      </Section>

      <Section title="Class weights" note="How much each class type counts. The ERP uses lecture 100, tutorial 100, practical 50, skilling 25.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COMPONENT_ORDER.map((k: ComponentKey) => (
            <NumberField key={k} id={`w-${k}`} label={COMPONENT_LABELS[k]} value={weights[k]} min={0} max={1000} onCommit={(v) => updateSettings({ weights: { ...weights, [k]: v } })} />
          ))}
        </div>
        <button type="button" className="btn btn-line btn-sm press mt-4" onClick={() => updateSettings({ weights: DEFAULT_WEIGHTS })}>
          Reset to {DEFAULT_WEIGHTS.L} / {DEFAULT_WEIGHTS.T} / {DEFAULT_WEIGHTS.P} / {DEFAULT_WEIGHTS.S}
        </button>
      </Section>

      <Section title="Late-joiner fix" note="Joined a course late? The ERP drops classes held before you registered. Tell Attenly how many, per course, so the figures match.">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-[15px] font-medium">Leave out classes held before I registered</span>
          <button
            type="button"
            role="switch"
            aria-checked={tcbr.enabled}
            onClick={() => updateSettings({ tcbr: { ...tcbr, enabled: !tcbr.enabled } })}
            className={cn('press relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors', tcbr.enabled ? 'bg-cruise' : 'bg-seam-strong')}
          >
            <span className={cn('absolute left-0 top-[3px] h-6 w-6 rounded-full bg-mark transition-transform duration-200 ease-out', tcbr.enabled ? 'translate-x-[23px]' : 'translate-x-[3px]')} />
          </button>
        </label>
        {tcbr.enabled && (
          <ul className="mt-4">
            {(snapshot?.attendance ?? []).length === 0 && <li className="text-[14px] text-dropout-text">Courses appear here after your first sync.</li>}
            {(snapshot?.attendance ?? []).map((s) => {
              const v = tcbr.perCourse[s.code] ?? 0;
              return (
                <li key={s.code} className="seam-b flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{s.title || s.code}</p>
                    <p className="text-[12px] text-dropout-quiet tnum">{s.code}</p>
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={`Classes before registration for ${s.code}`}>
                    <button type="button" className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam disabled:opacity-30" disabled={v <= 0} onClick={() => setTcbr(s.code, v - 1)} aria-label="One fewer">
                      <Minus size={16} aria-hidden />
                    </button>
                    <span className="figure w-8 text-center text-[20px]">{v}</span>
                    <button type="button" className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam disabled:opacity-30" disabled={v >= 60} onClick={() => setTcbr(s.code, v + 1)} aria-label="One more">
                      <Plus size={16} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Google account">
        <p className="text-[15px] font-medium">{user?.name ?? 'Signed in'}</p>
        {user?.email && <p className="text-[14px] text-dropout-text">{user.email}</p>}
        <button type="button" className="btn btn-danger btn-sm press mt-5" onClick={() => void store.signOut()}>
          <SignOut size={15} aria-hidden /> Sign out of Google
        </button>
      </Section>

      <Section title="This device" note="Attenly keeps a copy of your last sync, your settings and saved calculator results in this browser so the app opens instantly.">
        {cleared ? (
          <p className="text-[14px] text-cruise">Cleared. The next load pulls everything from the cloud again.</p>
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

      <p className="pt-8 text-[12px] text-dropout-quiet">
        Attenly is an unofficial student project, not affiliated with KL University.{' '}
        <Link href="/privacy" className="underline hover:text-mark">
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
