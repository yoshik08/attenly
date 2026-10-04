'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import { cn } from '@/components/cn';

/* ------------------------------------------------------------------ */
/*  Landing — dark product-UI theme. Opens like the app itself:        */
/*  serif headlines, dense cards, semantic pills.                       */
/* ------------------------------------------------------------------ */

const BG = 'bg-[#0A0A0B]';
const INK = 'text-[#F5F4F0]';
const MUTED = 'text-[#A1A1A8]';
const CARD = 'bg-[#141416] border border-[#232327]';
const AMBER = '#E9A13B';
const SERIF = 'font-[Fraunces,Georgia,serif]';

const rise = {
  initial: { y: 28, opacity: 0 },
  whileInView: { y: 0, opacity: 1 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
};

function LandingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0A0A0B]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-[#0A0A0B]"
            style={{ backgroundColor: AMBER }}
          >
            ◑
          </span>
          <span className={cn(SERIF, 'text-xl font-bold tracking-tight', INK)}>Attenly</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-[#A1A1A8] sm:flex">
          <a href="#preview" className="transition hover:text-white">
            Preview
          </a>
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
          <a href="#how" className="transition hover:text-white">
            How it works
          </a>
        </nav>
        <Link
          href="/sync"
          className="rounded-full px-5 py-2.5 text-sm font-bold text-[#0A0A0B] transition hover:brightness-110"
          style={{ backgroundColor: AMBER }}
        >
          Launch →
        </Link>
      </div>
    </header>
  );
}

const PREVIEW_SUBJECTS = [
  {
    code: '25CS1302E',
    pill: '#FB923C',
    name: 'Database Systems Engineering And Distributed Backend Development',
    meta: 'S-9-MA',
    attended: '59 / 79 Classes Attended',
    pct: 81,
    components: [
      ['Lecture (Weightage: 100%)', '16/20 (80%)'],
      ['Practical (Weightage: 50%)', '18/20 (90%)'],
      ['Skilling (Weightage: 25%)', '25/39 (64%)'],
    ],
    bunks: '2 Lectures + 1 Practical left',
  },
  {
    code: '25CS2103E',
    pill: '#F87171',
    name: 'Data Structures And Algorithms - 3',
    meta: 'S-9-MA',
    attended: '52 / 72 Classes Attended',
    pct: 88,
    components: [
      ['Lecture (Weightage: 100%)', '18/20 (90%)'],
      ['Practical (Weightage: 50%)', '12/12 (100%)'],
      ['Skilling (Weightage: 25%)', '22/40 (55%)'],
    ],
    bunks: '4 Lectures + 2 Practicals left',
  },
  {
    code: '25CS2104E',
    pill: '#34D399',
    name: 'Operating Systems And Systems Programming',
    meta: 'S-9-MA',
    attended: '58 / 76 Classes Attended',
    pct: 80,
    components: [
      ['Lecture (Weightage: 100%)', '14/18 (78%)'],
      ['Practical (Weightage: 50%)', '18/20 (90%)'],
      ['Skilling (Weightage: 25%)', '26/38 (68%)'],
    ],
    bunks: '1 Lecture left — thin ice',
  },
];

function SubjectCard({ s, i }: { s: (typeof PREVIEW_SUBJECTS)[number]; i: number }) {
  return (
    <motion.div
      {...rise}
      transition={{ ...rise.transition, delay: i * 0.1 }}
      className={cn(CARD, 'rounded-3xl p-6')}
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded-lg px-2.5 py-1 text-xs font-black tracking-wide text-[#0A0A0B]"
          style={{ backgroundColor: s.pill }}
        >
          {s.code}
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-[#34D399]/30 bg-[#34D399]/10 px-2.5 py-1 text-xs font-bold text-[#34D399]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" /> Safe
        </span>
      </div>
      <p className={cn('mt-4 text-[15px] font-bold leading-snug', INK)}>{s.name}</p>
      <p className={cn('mt-1.5 text-xs', MUTED)}>🧑‍🏫 Faculty Not Listed · 🎒 {s.meta}</p>
      <p className={cn('mt-3 text-sm', MUTED)}>{s.attended}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${s.pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.3 + i * 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-[#34D399]"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="font-black text-[#34D399]">{s.pct}%</span>
        <span className={cn('text-xs', MUTED)}>Target: 85%</span>
      </div>
      <p className={cn('mt-4 text-[11px] font-bold uppercase tracking-widest', MUTED)}>Components</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {s.components.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between text-[13px]">
            <span className={MUTED}>{label}</span>
            <span className={cn('font-bold', INK)}>{val}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px]">
        <span className={cn('font-bold', INK)}>Bunk balance: </span>
        <span className={MUTED}>{s.bunks}</span>
      </div>
    </motion.div>
  );
}

function Hero() {
  const { loadSample } = usePlanner();
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(rgba(233,161,59,0.14) 1px, transparent 1px)`,
          backgroundSize: '30px 30px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
        <motion.p {...rise} className="text-xs font-bold uppercase tracking-[0.25em] text-[#A1A1A8]">
          [ Attenly — KLU ERP, rebuilt ]
        </motion.p>
        <motion.h1
          {...rise}
          transition={{ ...rise.transition, delay: 0.08 }}
          className={cn(SERIF, 'mt-5 max-w-3xl text-5xl font-black leading-[1.04] tracking-tight sm:text-7xl', INK)}
        >
          You&apos;re in. <span style={{ color: AMBER }}>Now you know.</span>
        </motion.h1>
        <motion.p
          {...rise}
          transition={{ ...rise.transition, delay: 0.16 }}
          className={cn('mt-6 max-w-2xl text-lg leading-relaxed', MUTED)}
        >
          Attenly reads your live KL ERP data — attendance per subject and period, your timetable —
          and turns it into a plan: how many classes you can skip, which ones will hurt, and what
          it takes to climb back.
        </motion.p>
        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.24 }} className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sync"
            className="rounded-full px-7 py-3.5 text-base font-bold text-[#0A0A0B] transition hover:brightness-110"
            style={{ backgroundColor: AMBER }}
          >
            Launch Attenly →
          </Link>
          <button
            onClick={loadSample}
            className="rounded-full border border-white/15 bg-white/[0.04] px-7 py-3.5 text-base font-bold text-white transition hover:border-white/30"
          >
            Try sample data
          </button>
        </motion.div>

        <div id="preview" className="mt-16">
          <motion.div {...rise} className="mb-6 flex items-end justify-between">
            <h2 className={cn(SERIF, 'text-3xl font-black tracking-tight sm:text-4xl', INK)}>Your Subjects</h2>
            <span className={cn('text-xs font-bold uppercase tracking-widest', MUTED)}>Odd Sem 2026-2027</span>
          </motion.div>
          <div className="grid gap-5 md:grid-cols-3">
            {PREVIEW_SUBJECTS.map((s, i) => (
              <SubjectCard key={s.code} s={s} i={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SyncStrip() {
  const rows = [
    ['Attendance', 'Ready', true],
    ['Timetable', 'Ready', true],
    ['Snapshots', 'Ready', true],
    ['Hourly refresh', 'Soon', false],
  ] as const;
  return (
    <section className="mx-auto max-w-6xl px-5 py-14">
      <motion.div {...rise} className={cn(CARD, 'rounded-3xl p-7 sm:p-9')}>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#A1A1A8]">[ Synced ]</p>
        <h2 className={cn(SERIF, 'mt-3 text-3xl font-black tracking-tight sm:text-4xl', INK)}>
          Everything else, <span style={{ color: AMBER }}>on autopilot.</span>
        </h2>
        <p className={cn('mt-3 max-w-2xl', MUTED)}>
          Fetched right after you log in, then snapshotted to MongoDB. Every tab is ready the
          moment you open it.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {rows.map(([label, status, ready]) => (
            <div key={label} className="flex items-center justify-between text-[15px]">
              <span className="flex items-center gap-3">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: ready ? '#34D399' : '#6B7280' }}
                />
                <span className={cn('font-medium', INK)}>{label}</span>
              </span>
              <span className={cn('text-sm', MUTED)}>{status}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl bg-white/[0.04] px-5 py-4 text-center text-sm font-bold text-[#A1A1A8]">
          One login pulls it all from the ERP…
        </div>
      </motion.div>
    </section>
  );
}

function Features() {
  const cards = [
    {
      t: 'What-if lab',
      d: 'Rehearse the bunk before you take it. Flip any class to attended or skipped and see the exact percentage damage, per subject.',
    },
    {
      t: 'Bunk balance',
      d: 'A live count of skippable classes for every subject. Spend them like currency — Attenly tells you when the wallet is empty.',
    },
    {
      t: 'Class gravity',
      d: 'TCBR-weighted math with a late-joiner fix, so transfer credits and course overrides never lie to you.',
    },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-14">
      <motion.h2 {...rise} className={cn(SERIF, 'text-4xl font-black tracking-tight sm:text-5xl', INK)}>
        One login. <span style={{ color: AMBER }}>The whole campus.</span>
      </motion.h2>
      <motion.p {...rise} transition={{ ...rise.transition, delay: 0.1 }} className={cn('mt-4 max-w-2xl text-lg', MUTED)}>
        The official portal shows you raw counts. Attenly turns them into decisions.
      </motion.p>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div key={c.t} {...rise} transition={{ ...rise.transition, delay: i * 0.1 }} className={cn(CARD, 'rounded-3xl p-7')}>
            <p className={cn(SERIF, 'text-2xl font-bold', INK)}>{c.t}</p>
            <p className={cn('mt-3 leading-relaxed', MUTED)}>{c.d}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Steps() {
  const steps = [
    ['01', 'Link your ERP', 'One login with Google, then your ERP ID. The captcha decodes itself.'],
    ['02', 'Pull your data', 'Timetable plus per-period attendance, snapshotted for instant reloads.'],
    ['03', 'Skip with confidence', 'Your subjects show the bunk balance per class. Green means go.'],
  ];
  return (
    <section id="how" className="border-y border-white/[0.07] bg-[#0E0E10]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <motion.h2 {...rise} className={cn(SERIF, 'text-4xl font-black tracking-tight sm:text-5xl', INK)}>
          Three steps to <span style={{ color: AMBER }}>smarter</span> skips.
        </motion.h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          {steps.map(([n, t, d], i) => (
            <motion.div key={n} {...rise} transition={{ ...rise.transition, delay: i * 0.1 }}>
              <p className={cn(SERIF, 'text-5xl font-black text-white/10')}>{n}</p>
              <p className={cn('mt-3 text-xl font-bold', INK)}>{t}</p>
              <p className={cn('mt-2 leading-relaxed', MUTED)}>{d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <motion.div {...rise} className={cn(CARD, 'relative overflow-hidden rounded-[2rem] px-8 py-14 text-center sm:py-16')}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(${AMBER} 1.2px, transparent 1.2px)`,
            backgroundSize: '26px 26px',
          }}
        />
        <h2 className={cn(SERIF, 'relative text-4xl font-black tracking-tight sm:text-5xl', INK)}>
          The portal KLU should have <span style={{ color: AMBER }}>given you.</span>
        </h2>
        <Link
          href="/sync"
          className="relative mt-8 inline-block rounded-full px-8 py-4 text-base font-bold text-[#0A0A0B] transition hover:brightness-110"
          style={{ backgroundColor: AMBER }}
        >
          Launch Attenly →
        </Link>
      </motion.div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-xs sm:flex-row">
        <p className={cn('font-bold', INK)}>Attenly — the KLU ERP, rebuilt for students.</p>
        <p className={MUTED}>A student-built ERP front. Not affiliated with KL University.</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className={cn(BG, 'min-h-screen', INK, 'antialiased')}>
      <LandingNav />
      <main>
        <Hero />
        <SyncStrip />
        <Features />
        <Steps />
        <CtaBand />
      </main>
      <LandingFooter />
    </div>
  );
}
