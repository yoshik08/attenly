'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import { cn } from '@/components/cn';

/* ------------------------------------------------------------------ */
/*  Landing — light "paper" theme. A different product from the dark   */
/*  app shell: shown on / when no ERP data is linked yet.              */
/* ------------------------------------------------------------------ */

const PAPER = 'bg-[#FAF5EC]';
const INK = 'text-[#191410]';
const MUTED = 'text-[#6E6459]';
const ACCENT = '#E4572E';
const CARD = 'bg-white border border-[#E9E1D1]';
const SERIF = 'font-[Fraunces,Georgia,serif]';

const rise = {
  initial: { y: 28, opacity: 0 },
  whileInView: { y: 0, opacity: 1 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
};

function LandingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#E9E1D1]/80 bg-[#FAF5EC]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-white shadow-[0_6px_16px_-6px_rgba(228,87,46,0.7)]"
            style={{ backgroundColor: ACCENT }}
          >
            ◑
          </span>
          <span className={cn(SERIF, 'text-xl font-bold tracking-tight', INK)}>Skipwise</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-[#6E6459] sm:flex">
          <a href="#how" className="transition hover:text-[#191410]">
            How it works
          </a>
          <a href="#features" className="transition hover:text-[#191410]">
            Features
          </a>
          <a href="#numbers" className="transition hover:text-[#191410]">
            The numbers
          </a>
        </nav>
        <Link
          href="/sync"
          className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-8px_rgba(228,87,46,0.8)] transition hover:brightness-110"
          style={{ backgroundColor: ACCENT }}
        >
          Link ERP →
        </Link>
      </div>
    </header>
  );
}

function HeroCard() {
  const rows = [
    { code: 'DBMS', pct: 82, left: 3 },
    { code: 'OS', pct: 91, left: 6 },
    { code: 'CN', pct: 68, left: 0 },
  ];
  return (
    <motion.div
      initial={{ y: 40, opacity: 0, rotate: 1.5 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(CARD, 'w-full max-w-sm rounded-3xl p-6 shadow-[0_30px_60px_-30px_rgba(25,20,16,0.35)]')}
    >
      <div className="flex items-center justify-between">
        <p className={cn(SERIF, 'text-lg font-bold', INK)}>Bunk balance</p>
        <span className="rounded-full bg-[#1E4D3B]/10 px-3 py-1 text-xs font-bold text-[#1E4D3B]">
          ● live
        </span>
      </div>
      <p className={cn('mt-1 text-xs', MUTED)}>Odd Sem · 2026-2027</p>
      <div className="mt-5 flex flex-col gap-4">
        {rows.map((r) => (
          <div key={r.code}>
            <div className="flex items-baseline justify-between text-sm">
              <span className={cn('font-bold', INK)}>{r.code}</span>
              <span className={MUTED}>
                <span className={cn('font-bold', r.pct < 75 ? 'text-[#C23B22]' : INK)}>{r.pct}%</span>
                {' · '}
                {r.left > 0 ? `${r.left} skips left` : 'no skips left'}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#F0E9D9]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${r.pct}%` }}
                transition={{ duration: 1.1, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-full"
                style={{ backgroundColor: r.pct < 75 ? '#C23B22' : ACCENT }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-2xl bg-[#FAF5EC] p-4 text-sm">
        <p className={cn('font-bold', INK)}>Verdict</p>
        <p className={MUTED}>CN is in the red — attend the next 4 to climb back.</p>
      </div>
    </motion.div>
  );
}

function LandingHero() {
  const { loadSample } = usePlanner();
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: 'radial-gradient(#E9E1D1 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)',
        }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <motion.div {...rise}>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#E9E1D1] bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#6E6459]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ACCENT }} />
              Live sync · KL University ERP
            </span>
          </motion.div>
          <motion.h1
            {...rise}
            transition={{ ...rise.transition, delay: 0.08 }}
            className={cn(SERIF, 'mt-6 text-5xl font-black leading-[1.02] tracking-tight sm:text-7xl', INK)}
          >
            Every bunk,
            <br />
            <span className="relative inline-block">
              <span className="relative z-10" style={{ color: ACCENT }}>
                calculated.
              </span>
              <svg
                aria-hidden
                viewBox="0 0 300 24"
                preserveAspectRatio="none"
                className="absolute -bottom-1 left-0 z-0 h-5 w-full"
              >
                <path
                  d="M4 16 C 60 8, 150 20, 296 10"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="7"
                  strokeLinecap="round"
                  opacity="0.28"
                />
              </svg>
            </span>
          </motion.h1>
          <motion.p
            {...rise}
            transition={{ ...rise.transition, delay: 0.16 }}
            className={cn('mt-6 max-w-xl text-lg leading-relaxed', MUTED)}
          >
            Skipwise plugs into your KL ERP and reads your real attendance — every subject, every
            period. It tells you exactly how many classes you can skip before detention comes
            knocking.
          </motion.p>
          <motion.div
            {...rise}
            transition={{ ...rise.transition, delay: 0.24 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link
              href="/sync"
              className="rounded-full px-7 py-3.5 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(228,87,46,0.8)] transition hover:brightness-110"
              style={{ backgroundColor: ACCENT }}
            >
              Link your ERP →
            </Link>
            <button
              onClick={loadSample}
              className="rounded-full border-2 border-[#191410]/15 bg-white px-7 py-3.5 text-base font-bold text-[#191410] transition hover:border-[#191410]/35"
            >
              Try sample data
            </button>
          </motion.div>
          <motion.p
            {...rise}
            transition={{ ...rise.transition, delay: 0.3 }}
            className={cn('mt-5 text-xs', MUTED)}
          >
            Your ERP password is never stored — only an encrypted login token.
          </motion.p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <HeroCard />
        </div>
      </div>
    </section>
  );
}

function StatsStrip() {
  const stats = [
    ['75%', 'detention floor'],
    ['85%', 'cruise line'],
    ['6-day', 'timetable aware'],
    ['0', 'passwords stored'],
  ];
  return (
    <section id="numbers" className="border-y border-[#E9E1D1] bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-[#E9E1D1] px-5 sm:grid-cols-4">
        {stats.map(([v, l], i) => (
          <motion.div
            key={l}
            {...rise}
            transition={{ ...rise.transition, delay: i * 0.07 }}
            className="px-6 py-8 text-center"
          >
            <p className={cn(SERIF, 'text-4xl font-black', INK)}>{v}</p>
            <p className={cn('mt-1 text-xs font-bold uppercase tracking-widest', MUTED)}>{l}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const cards = [
    {
      t: 'What-if lab',
      d: 'Rehearse the bunk before you take it. Flip any class to attended or skipped and watch the exact percentage damage, per subject.',
    },
    {
      t: 'Bunk balance',
      d: 'A live count of skippable classes for every subject. Spend them like currency — the app tells you when the wallet is empty.',
    },
    {
      t: 'Class gravity',
      d: 'TCBR-weighted math with a late-joiner fix, so transfer credits and course overrides never lie to you.',
    },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
      <motion.h2
        {...rise}
        className={cn(SERIF, 'text-4xl font-black tracking-tight sm:text-6xl', INK)}
      >
        Your attendance, <span style={{ color: ACCENT }}>decoded.</span>
      </motion.h2>
      <motion.p {...rise} transition={{ ...rise.transition, delay: 0.1 }} className={cn('mt-4 max-w-2xl text-lg', MUTED)}>
        The ERP shows you raw counts. Skipwise turns them into decisions.
      </motion.p>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div
            key={c.t}
            {...rise}
            transition={{ ...rise.transition, delay: i * 0.1 }}
            className={cn(CARD, 'rounded-3xl p-7 shadow-[0_20px_45px_-30px_rgba(25,20,16,0.3)]')}
          >
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
    ['01', 'Link your ERP', 'One login. The captcha decodes itself, and your password never touches our database.'],
    ['02', 'Pull your data', 'Timetable plus per-period attendance, snapshotted to MongoDB for instant reloads.'],
    ['03', 'Skip with confidence', 'Your game plan shows the bunk balance per subject. Green means go.'],
  ];
  return (
    <section id="how" className="border-y border-[#E9E1D1] bg-[#F3ECDD]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
        <motion.h2 {...rise} className={cn(SERIF, 'text-4xl font-black tracking-tight sm:text-5xl', INK)}>
          Three steps to <span style={{ color: ACCENT }}>smarter</span> skips.
        </motion.h2>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {steps.map(([n, t, d], i) => (
            <motion.div key={n} {...rise} transition={{ ...rise.transition, delay: i * 0.1 }}>
              <p className={cn(SERIF, 'text-5xl font-black', 'text-[#191410]/15')}>{n}</p>
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
    <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
      <motion.div
        {...rise}
        className="relative overflow-hidden rounded-[2.5rem] bg-[#191410] px-8 py-16 text-center sm:py-20"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(#E4572E 1.2px, transparent 1.2px)',
            backgroundSize: '26px 26px',
          }}
        />
        <h2 className={cn(SERIF, 'relative text-4xl font-black tracking-tight text-[#FAF5EC] sm:text-6xl')}>
          Stop guessing.
          <br />
          Start skipping <span style={{ color: ACCENT }}>smart.</span>
        </h2>
        <Link
          href="/sync"
          className="relative mt-8 inline-block rounded-full px-8 py-4 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(228,87,46,0.9)] transition hover:brightness-110"
          style={{ backgroundColor: ACCENT }}
        >
          Link your ERP →
        </Link>
      </motion.div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-[#E9E1D1]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-xs sm:flex-row">
        <p className={cn('font-bold', INK)}>Skipwise — read the room before you bunk it.</p>
        <p className={MUTED}>A student-built side project. Not affiliated with KL University.</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className={cn(PAPER, 'min-h-screen', INK, 'antialiased')}>
      <LandingNav />
      <main>
        <LandingHero />
        <StatsStrip />
        <Features />
        <Steps />
        <CtaBand />
      </main>
      <LandingFooter />
    </div>
  );
}
