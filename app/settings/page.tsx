'use client';

import { useState } from 'react';
import { usePlanner } from '@/components/data-context';
import { Button, Card, Container, SectionTitle, inputClass } from '@/components/ui';
import { cn } from '@/components/cn';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type ComponentKey, COMPONENT_ORDER, COMPONENT_LABELS } from '@/lib/math';

export default function SettingsPage() {
  const { ready, settings, updateSettings, clearData, sampleMode } = usePlanner();
  const [confirmClear, setConfirmClear] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);

  if (!ready) return <Container className="py-10"><p className="text-sm text-neutral-500">Loading…</p></Container>;

  const { thresholds, weights, theme } = settings;
  const invalid = thresholds.safeAt <= thresholds.condonationFrom;

  async function logoutErp() {
    await fetch('/api/erp/logout', { method: 'POST' });
    setLoggedOut(true);
  }

  return (
    <Container className="max-w-2xl py-10">
      <SectionTitle eyebrow="Settings" title="Tune the math" />

      {/* Attendance lines */}
      <Card className="animate-rise mb-6 p-5">
        <h3 className="font-bold">Attendance lines</h3>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Policy bands are computed from these. “Safe at” must be above “Condonation from”.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="safeAt">Safe at (%)</label>
            <input
              id="safeAt"
              type="number"
              min={0}
              max={100}
              className={inputClass}
              value={thresholds.safeAt}
              onChange={(e) => updateSettings({ thresholds: { ...thresholds, safeAt: Number(e.target.value) } })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold" htmlFor="condFrom">Condonation from (%)</label>
            <input
              id="condFrom"
              type="number"
              min={0}
              max={100}
              className={inputClass}
              value={thresholds.condonationFrom}
              onChange={(e) => updateSettings({ thresholds: { ...thresholds, condonationFrom: Number(e.target.value) } })}
            />
          </div>
        </div>
        {invalid && (
          <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
            “Safe at” must be greater than “Condonation from”.
          </p>
        )}
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => updateSettings({ thresholds: DEFAULT_THRESHOLDS })}
        >
          Reset to 85 / 75
        </Button>
      </Card>

      {/* LTPS weights */}
      <Card className="mb-6 p-5">
        <h3 className="font-bold">LTPS weights</h3>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          How much each class type counts toward your percentage.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(COMPONENT_ORDER as ComponentKey[]).map((k) => (
            <div key={k}>
              <label className="mb-1 block text-sm font-semibold" htmlFor={`w-${k}`}>
                {COMPONENT_LABELS[k]}
              </label>
              <input
                id={`w-${k}`}
                type="number"
                min={0}
                className={inputClass}
                value={weights[k]}
                onChange={(e) => updateSettings({ weights: { ...weights, [k]: Math.max(0, Number(e.target.value)) } })}
              />
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => updateSettings({ weights: DEFAULT_WEIGHTS })}
        >
          Reset to 100 / 25 / 50 / 25
        </Button>
      </Card>

      {/* Theme */}
      <Card className="mb-6 p-5">
        <h3 className="font-bold">Theme</h3>
        <div className="mt-3 flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => updateSettings({ theme: t })}
              className={cn(
                'rounded-lg border px-4 py-2 text-sm font-semibold capitalize',
                theme === t
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                  : 'border-neutral-300 dark:border-neutral-700',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      {/* Data */}
      <Card className="p-5">
        <h3 className="font-bold">Your data</h3>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Synced ERP data lives only in this browser (localStorage)
          {sampleMode ? ' — you are viewing sample data.' : '.'} Clearing it removes
          subjects, timetable and tracked history from this device.
        </p>
        <div className="flex flex-wrap gap-2">
          {!confirmClear ? (
            <Button variant="danger" onClick={() => setConfirmClear(true)}>
              Clear synced data
            </Button>
          ) : (
            <>
              <Button
                variant="danger"
                onClick={() => { clearData(); setConfirmClear(false); }}
              >
                Yes, clear everything
              </Button>
              <Button variant="secondary" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={logoutErp} disabled={loggedOut}>
            {loggedOut ? 'Logged out of ERP' : 'Log out of ERP'}
          </Button>
        </div>
      </Card>
    </Container>
  );
}
