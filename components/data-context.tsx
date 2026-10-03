'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SubjectAttendance, Thresholds, Weights } from '@/lib/math';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '@/lib/math';
import type { TimetableDay } from '@/lib/erp/parsers';
import {
  SAMPLE_SUBJECTS,
  SAMPLE_TIMETABLE,
  SAMPLE_TRENDS,
  SAMPLE_TERM,
  seedSampleLog,
  type AttendanceLog,
} from '@/lib/sample-data';

export interface TermInfo {
  academicyear: string;
  semesterid: string;
  semester: string;
}

export interface Settings {
  thresholds: Thresholds;
  weights: Weights;
  theme: 'light' | 'dark' | 'system';
}

interface PlannerState {
  subjects: SubjectAttendance[];
  timetable: TimetableDay[];
  log: AttendanceLog;
  trends: Record<string, number[]>;
  term: TermInfo | null;
  sampleMode: boolean;
  syncedAt: string | null;
  settings: Settings;
}

interface PlannerContextValue extends PlannerState {
  ready: boolean;
  hasData: boolean;
  loadSample: () => void;
  loadErpData: (subjects: SubjectAttendance[], timetable: TimetableDay[], term: TermInfo) => void;
  clearData: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setLogEntry: (dateISO: string, key: string, present: boolean | null) => void;
}

const STORAGE_KEY = 'skipwise:v1';

const DEFAULT_STATE: PlannerState = {
  subjects: [],
  timetable: [],
  log: {},
  trends: {},
  term: null,
  sampleMode: false,
  syncedAt: null,
  settings: {
    thresholds: DEFAULT_THRESHOLDS,
    weights: DEFAULT_WEIGHTS,
    theme: 'system',
  },
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

function loadStored(): PlannerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PlannerState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlannerState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage on mount (must run client-side to avoid SSR mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadStored());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [state, ready]);

  // Theme handling
  useEffect(() => {
    const apply = () => {
      const t = state.settings.theme;
      const dark =
        t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [state.settings.theme, ready]);

  const loadSample = useCallback(() => {
    setState((s) => ({
      ...s,
      subjects: SAMPLE_SUBJECTS,
      timetable: SAMPLE_TIMETABLE,
      log: seedSampleLog(),
      trends: SAMPLE_TRENDS,
      term: SAMPLE_TERM,
      sampleMode: true,
      syncedAt: new Date().toISOString(),
    }));
  }, []);

  const loadErpData = useCallback(
    (subjects: SubjectAttendance[], timetable: TimetableDay[], term: TermInfo) => {
      // Backfill missing subject titles from the timetable.
      const titles = new Map<string, string>();
      for (const d of timetable) {
        for (const p of d.periods) {
          if (p.subjectCode && p.subjectTitle && !titles.has(p.subjectCode)) {
            titles.set(p.subjectCode, p.subjectTitle);
          }
        }
      }
      const merged = subjects.map((s) => ({
        ...s,
        title: s.title || titles.get(s.code) || s.code,
      }));
      // Add timetable-only subjects as stubs so the grid still renders.
      const known = new Set(merged.map((s) => s.code));
      for (const [code, title] of titles) {
        if (!known.has(code)) {
          merged.push({
            code,
            title,
            components: {
              L: { conducted: 0, attended: 0 },
              T: { conducted: 0, attended: 0 },
              P: { conducted: 0, attended: 0 },
              S: { conducted: 0, attended: 0 },
            },
          });
        }
      }
      setState((s) => ({
        ...s,
        subjects: merged,
        timetable,
        log: {},
        trends: {},
        term,
        sampleMode: false,
        syncedAt: new Date().toISOString(),
      }));
    },
    [],
  );

  const clearData = useCallback(() => {
    setState((s) => ({
      ...s,
      subjects: [],
      timetable: [],
      log: {},
      trends: {},
      term: null,
      sampleMode: false,
      syncedAt: null,
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const setLogEntry = useCallback((dateISO: string, key: string, present: boolean | null) => {
    setState((s) => {
      const day = { ...(s.log[dateISO] ?? {}) };
      if (present == null) delete day[key];
      else day[key] = present;
      const log = { ...s.log };
      if (Object.keys(day).length === 0) delete log[dateISO];
      else log[dateISO] = day;
      return { ...s, log };
    });
  }, []);

  const value = useMemo<PlannerContextValue>(
    () => ({
      ...state,
      ready,
      hasData: state.subjects.length > 0 || state.timetable.length > 0,
      loadSample,
      loadErpData,
      clearData,
      updateSettings,
      setLogEntry,
    }),
    [state, ready, loadSample, loadErpData, clearData, updateSettings, setLogEntry],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be used inside DataProvider');
  return ctx;
}
