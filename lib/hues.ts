/**
 * One quiet hue per course, so a week reads as a pattern ("Cloud is every
 * morning"). Hues are OKLCH angles chosen to stay apart from each other on
 * black; courses take them in code order, so a course keeps its colour for
 * the whole term and on every screen that uses it.
 */
const PALETTE = [264, 196, 158, 310, 32, 84, 350, 128, 228, 4, 290, 176];

export function courseHues(codes: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(codes)].sort();
  return new Map(sorted.map((c, i) => [c, PALETTE[i % PALETTE.length]]));
}
