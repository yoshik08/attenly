'use client';

/**
 * The answer sheet. One bubble per class: filled = attended, ring = missed.
 * After a small gap, the future: mint rings you may leave blank (spare),
 * amber/red rings you have to fill (needed), or a what-if plan.
 */
export type Future =
  | { kind: 'spare'; count: number }
  | { kind: 'need'; count: number; tone: 'thin' | 'red' }
  | { kind: 'plan'; attend: number; skip: number }
  | null;

/** Visible future bubbles before the rest collapses into "+N". */
const FUTURE_CAP = 12;
/** Past bubbles before the strip switches to the dense size. */
const DENSE_AT = 48;
const PAST_CAP = 140;

export function BubbleSheet({
  attended,
  conducted,
  pre = 0,
  future,
  newAttended = 0,
  newMissed = 0,
  label,
}: {
  attended: number;
  conducted: number;
  /** Held before registration (TCBR): shown, not counted. */
  pre?: number;
  future: Future;
  newAttended?: number;
  newMissed?: number;
  /** Accessible summary of the strip. */
  label: string;
}) {
  const preN = Math.max(0, Math.min(pre, conducted));
  const att = Math.max(0, Math.min(attended, conducted));
  const missed = Math.max(0, conducted - att - preN);
  const total = preN + att + missed;
  const shownPast = Math.min(total, PAST_CAP);
  const dense = total > DENSE_AT;

  const cells: { s: string; isNew?: boolean }[] = [];
  for (let i = 0; i < preN; i++) cells.push({ s: 'pre' });
  for (let i = 0; i < att; i++) cells.push({ s: 'on', isNew: i >= att - newAttended });
  for (let i = 0; i < missed; i++) cells.push({ s: 'off', isNew: i >= missed - newMissed });
  const past = cells.slice(total - shownPast);

  const fut: string[] = [];
  let futMore = 0;
  if (future?.kind === 'spare' || future?.kind === 'need') {
    const n = Number.isFinite(future.count) ? future.count : FUTURE_CAP + 1;
    const s = future.kind === 'spare' ? 'spare' : `need-${future.tone}`;
    for (let i = 0; i < Math.min(n, FUTURE_CAP); i++) fut.push(s);
    futMore = Number.isFinite(future.count) ? Math.max(0, n - FUTURE_CAP) : -1;
  } else if (future?.kind === 'plan') {
    const a = Math.min(future.attend, FUTURE_CAP);
    const k = Math.min(future.skip, FUTURE_CAP - a);
    for (let i = 0; i < a; i++) fut.push('plan-on');
    for (let i = 0; i < k; i++) fut.push('plan-off');
    futMore = future.attend + future.skip - a - k;
  }

  return (
    <div className="sheet" data-dense={dense} role="img" aria-label={label}>
      {total > shownPast && <span className="more-count">+{total - shownPast}</span>}
      {past.map((c, i) => (
        <span key={i} className="bub" data-s={c.s} data-new={c.isNew ? 'true' : undefined} />
      ))}
      {fut.length > 0 && <span className="sheet-gap" aria-hidden />}
      {fut.map((s, i) => (
        <span key={`f${i}`} className="bub" data-s={s} />
      ))}
      {futMore > 0 && <span className="more-count">+{futMore}</span>}
      {futMore < 0 && <span className="more-count">…</span>}
    </div>
  );
}
