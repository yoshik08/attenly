'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import { Button, Container, Field, GlassPanel, SectionHeader, Stepper, Toggle, inputClass } from '@/components/ui';
import { cn } from '@/components/cn';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  DETENTION_FLOOR,
  COMPONENT_ORDER,
  COMPONENT_LABELS,
  type ComponentKey,
} from '@/lib/math';

export default function SettingsPage() {
  const { ready, settings, updateSettings, clearData, sampleMode, subjects } = usePlanner();
  const [confirmClear, setConfirmClear] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);

  if (!ready)
    return (
      <Container className="py-10">
        <p className="text-sm text-slate-500">Warming up…</p>
      </Container>
    );

  const { thresholds, weights, tcbr } = settings;
  const invalid = thresholds.safeAt <= thresholds.condonationFrom;

  async function logoutErp() {
    await fetch('/api/erp/logout', { method: 'POST' });
    setLoggedOut(true);
  }

  const setTcbrCourse = (code: string, v: number) => {
    const perCourse = { ...tcbr.perCourse };
    if (v <= 0) delete perCourse[code];
    else perCourse[code] = v;
    updateSettings({ tcbr: { ...tcbr, perCourse } });
  };

  return (
    <Container className="max-w-2xl py-8">
      <SectionHeader
        kicker="Control deck"
        title="Dial the math"
        sub="Every number below feeds the engine live — no save button, it just updates."
      />

      {/* red lines */}
      <GlassPanel className="mb-5 p-6">
        <h3 className="font-display text-lg font-bold text-white">Your red lines</h3>
        <p className="mb-5 text-sm text-slate-400">
          The bands are drawn from these. The university&apos;s detention floor sits at {DETENTION_FLOOR}% —
          the “floor” line should never dip below it.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Cruise line (%)" htmlFor="safeAt" hint="At or above this: cruising.">
            <input
              id="safeAt"
              type="number"
              min={0}
              max={100}
              className={inputClass}
              value={thresholds.safeAt}
              onChange={(e) => updateSettings({ thresholds: { ...thresholds, safeAt: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Floor (%)" htmlFor="condFrom" hint="Below this: in the red.">
            <input
              id="condFrom"
              type="number"
              min={0}
              max={100}
              className={inputClass}
              value={thresholds.condonationFrom}
              onChange={(e) => updateSettings({ thresholds: { ...thresholds, condonationFrom: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <AnimatePresence>
          {invalid && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 text-sm font-medium text-rose-300"
            >
              The cruise line has to sit above the floor.
            </motion.p>
          )}
        </AnimatePresence>
        <Button
          variant="glass"
          className="mt-4"
          onClick={() => updateSettings({ thresholds: DEFAULT_THRESHOLDS })}
        >
          Reset to 85 / 75
        </Button>
      </GlassPanel>

      {/* class gravity */}
      <GlassPanel className="mb-5 p-6">
        <h3 className="font-display text-lg font-bold text-white">Class gravity</h3>
        <p className="mb-5 text-sm text-slate-400">
          How hard each class type pulls your score. A lecture moves the needle twice as much as a lab.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(COMPONENT_ORDER as ComponentKey[]).map((k) => (
            <Field key={k} label={COMPONENT_LABELS[k]} htmlFor={`w-${k}`}>
              <input
                id={`w-${k}`}
                type="number"
                min={0}
                className={inputClass}
                value={weights[k]}
                onChange={(e) => updateSettings({ weights: { ...weights, [k]: Math.max(0, Number(e.target.value)) } })}
              />
            </Field>
          ))}
        </div>
        <Button
          variant="glass"
          className="mt-4"
          onClick={() => updateSettings({ weights: DEFAULT_WEIGHTS })}
        >
          Reset to 100 / 100 / 50 / 25
        </Button>
      </GlassPanel>

      {/* late-joiner fix */}
      <GlassPanel className="mb-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-white">Late-joiner fix</h3>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              Joined a course late? The ERP quietly drops classes held before you registered. Flip
              this on and tell it how many to drop per course — your scores will match the portal.
            </p>
          </div>
          <Toggle
            checked={tcbr.enabled}
            onChange={(v) => updateSettings({ tcbr: { ...tcbr, enabled: v } })}
            label="Late-joiner fix"
          />
        </div>
        <AnimatePresence initial={false}>
          {tcbr.enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35 }}
              className="overflow-hidden"
            >
              <div className="mt-5 flex flex-col gap-2 border-t border-white/[0.08] pt-4">
                {subjects.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No courses loaded yet — link your ERP or load sample data first.
                  </p>
                )}
                {subjects.map((s) => (
                  <div
                    key={s.code}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{s.code}</p>
                      <p className="truncate text-xs text-slate-500">{s.title}</p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-slate-500">pre-reg classes</span>
                      <Stepper
                        small
                        value={tcbr.perCourse[s.code] ?? 0}
                        onChange={(v) => setTcbrCourse(s.code, v)}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Provisional — the university can revise these counts. Don&apos;t use this for
                  formal academic decisions; always cross-check the ERP.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>

      {/* danger zone */}
      <GlassPanel className="p-6">
        <h3 className="font-display text-lg font-bold text-white">Danger zone</h3>
        <p className="mb-5 text-sm text-slate-400">
          Synced data lives only in this browser{sampleMode ? ' — you’re on the sample orbit' : ''}.
          Clearing wipes courses, timetable and the tape from this device.
        </p>
        <div className="flex flex-wrap gap-2">
          {!confirmClear ? (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>
              Clear synced data
            </Button>
          ) : (
            <>
              <Button variant="danger" onClick={() => { clearData(); setConfirmClear(false); }}>
                Yes, wipe it all
              </Button>
              <Button variant="glass" onClick={() => setConfirmClear(false)}>
                Keep it
              </Button>
            </>
          )}
          <Button variant="glass" onClick={logoutErp} disabled={loggedOut}>
            {loggedOut ? 'Unlinked from ERP' : 'Unlink ERP session'}
          </Button>
        </div>
      </GlassPanel>
    </Container>
  );
}
