'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import { Container, Field, GlassPanel, inputClass } from '@/components/ui';
import { COMPONENT_ORDER, COMPONENT_LABELS } from '@/lib/math';
import { cn } from '@/components/cn';

interface Draft {
  name: string;
  kind: 'simple' | 'components';
  result: string;
  at: string;
}

const DRAFT_KEY = 'attenly:calc-drafts';

function loadDrafts(): Draft[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]') as Draft[];
  } catch {
    return [];
  }
}

function SimpleCalc() {
  const [total, setTotal] = useState('');
  const [attended, setAttended] = useState('');
  const [name, setName] = useState('');

  // Live percentage — recomputed on every keystroke, no button needed.
  const result = (() => {
    const t = parseFloat(total);
    const a = parseFloat(attended);
    if (!(t > 0) || !(a >= 0) || a > t) return null;
    return Math.round((a / t) * 10000) / 100;
  })();

  const saveDraft = () => {
    if (result === null || !name.trim()) return;
    const drafts = loadDrafts();
    drafts.unshift({ name: name.trim(), kind: 'simple', result: `${result}%`, at: new Date().toISOString() });
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts.slice(0, 20)));
    window.dispatchEvent(new Event('attenly:drafts'));
    setName('');
  };

  return (
    <GlassPanel className="p-6 sm:p-8">
      <h2 className="font-display text-2xl font-black text-[#F5F4F0]">Calculate Attendance</h2>
      <p className="mt-1 text-sm text-[#A1A1A8]">Enter your total classes and classes attended</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Total Classes" htmlFor="calc-total">
          <input id="calc-total" className={inputClass} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Enter total classes" />
        </Field>
        <Field label="Classes Attended" htmlFor="calc-att">
          <input id="calc-att" className={inputClass} inputMode="decimal" value={attended} onChange={(e) => setAttended(e.target.value)} placeholder="Enter classes attended" />
        </Field>
      </div>
      <AnimatePresence>
        {result !== null && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="font-display mt-5 text-center text-4xl font-black text-[#E9A13B]"
          >
            {result}%
          </motion.p>
        )}
      </AnimatePresence>
      <div className="mt-4 flex gap-2">
        <div className="flex-1">
          <Field label="Subject Name" htmlFor="calc-name" hint="Optional - to save as draft">
            <input id="calc-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter subject name to save as draft" />
          </Field>
        </div>
        <button
          onClick={saveDraft}
          disabled={result === null || !name.trim()}
          className="mt-6 shrink-0 rounded-xl border border-[#E9A13B]/40 px-4 text-sm font-bold text-[#E9A13B] transition disabled:cursor-not-allowed disabled:opacity-30 hover:bg-[#E9A13B]/10"
        >
          Save draft
        </button>
      </div>
    </GlassPanel>
  );
}

function ComponentCalc() {
  const { settings } = usePlanner();
  const { weights } = settings;
  const [vals, setVals] = useState<Record<string, string>>({ L: '', T: '', P: '', S: '' });
  const [name, setName] = useState('');

  // Live weighted percentage — recomputed on every keystroke.
  const result = (() => {
    let attW = 0;
    let condW = 0;
    for (const k of COMPONENT_ORDER) {
      const v = parseFloat(vals[k]);
      if (Number.isNaN(v) || v < 0 || v > 100) return null;
      const w = weights[k] ?? 0;
      attW += (v / 100) * w;
      condW += w;
    }
    if (condW <= 0) return null;
    return Math.round((attW / condW) * 10000) / 100;
  })();

  const saveDraft = () => {
    if (result === null || !name.trim()) return;
    const drafts = loadDrafts();
    drafts.unshift({ name: name.trim(), kind: 'components', result: `${result}%`, at: new Date().toISOString() });
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts.slice(0, 20)));
    window.dispatchEvent(new Event('attenly:drafts'));
    setName('');
  };

  return (
    <GlassPanel className="p-6 sm:p-8">
      <h2 className="font-display text-2xl font-black text-[#F5F4F0]">Calculate Attendance</h2>
      <p className="mt-1 text-sm text-[#A1A1A8]">Enter your attendance percentages for each component</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {COMPONENT_ORDER.map((k) => (
          <Field key={k} label={`${COMPONENT_LABELS[k]} (${weights[k]}%)`} htmlFor={`calc-${k}`}>
            <input
              id={`calc-${k}`}
              className={inputClass}
              inputMode="decimal"
              value={vals[k]}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
              placeholder={`Enter ${COMPONENT_LABELS[k].toLowerCase()} attendance`}
            />
          </Field>
        ))}
      </div>
      <AnimatePresence>
        {result !== null && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="font-display mt-5 text-center text-4xl font-black text-[#E9A13B]"
          >
            {result}%
          </motion.p>
        )}
      </AnimatePresence>
      <div className="mt-4 flex gap-2">
        <div className="flex-1">
          <Field label="Subject Name" htmlFor="calc-cname" hint="Optional - to save as draft">
            <input id="calc-cname" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter subject name to save as draft" />
          </Field>
        </div>
        <button
          onClick={saveDraft}
          disabled={result === null || !name.trim()}
          className="mt-6 shrink-0 rounded-xl border border-[#E9A13B]/40 px-4 text-sm font-bold text-[#E9A13B] transition disabled:cursor-not-allowed disabled:opacity-30 hover:bg-[#E9A13B]/10"
        >
          Save draft
        </button>
      </div>
    </GlassPanel>
  );
}

function Drafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => {
    const refresh = () => setDrafts(loadDrafts());
    refresh();
    window.addEventListener('attenly:drafts', refresh);
    return () => window.removeEventListener('attenly:drafts', refresh);
  }, []);
  if (drafts.length === 0) return null;
  return (
    <GlassPanel className="mt-6 p-6">
      <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">Drafts</h3>
      <div className="mt-3 flex flex-col gap-2">
        {drafts.map((d, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-[#232327] bg-white/[0.02] px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#F5F4F0]">{d.name}</p>
              <p className="text-[11px] text-[#6B6B72]">{d.kind === 'simple' ? 'Simple' : 'Components'} · {new Date(d.at).toLocaleDateString()}</p>
            </div>
            <p className="font-display text-xl font-black tabular-nums text-[#E9A13B]">{d.result}</p>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          localStorage.removeItem(DRAFT_KEY);
          setDrafts([]);
        }}
        className={cn('mt-3 text-xs font-semibold text-[#6B6B72] hover:text-white hover:underline')}
      >
        Clear drafts
      </button>
    </GlassPanel>
  );
}

export default function CalculatorPage() {
  return (
    <Container className="max-w-3xl py-8">
      <div className="mb-6">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#A1A1A8]">[ Calculator ]</p>
        <h1 className="font-display text-4xl font-black tracking-tight text-[#F5F4F0] sm:text-5xl">
          Quick math
        </h1>
        <p className="mt-2 text-sm text-[#A1A1A8]">No ERP needed — just the numbers in your head.</p>
      </div>
      <div className="flex flex-col gap-6">
        <SimpleCalc />
        <ComponentCalc />
        <Drafts />
      </div>
    </Container>
  );
}
