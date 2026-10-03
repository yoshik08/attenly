/**
 * Attendance engine unit tests. Run with: npm test
 * (tsx type-strips the TS on the fly; no build step needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DETENTION_FLOOR,
  classImpact,
  courseTcbr,
  emptyPlan,
  maxSkippable,
  neededToReach,
  policyBand,
  sandboxPct,
  skipGuidance,
  skipMargin,
  tcbrPct,
  weightedPct,
  weightedSums,
  type ComponentKey,
  type ComponentMap,
  type SubjectAttendance,
} from '../lib/math';

function mkSubj(
  L: [number, number],
  T: [number, number] = [0, 0],
  P: [number, number] = [0, 0],
  S: [number, number] = [0, 0],
): SubjectAttendance {
  const c = ([conducted, attended]: [number, number]) => ({ conducted, attended });
  const components: ComponentMap = { L: c(L), T: c(T), P: c(P), S: c(S) };
  return { code: 'X101', title: 'X', components };
}

/** Raw (un-ceiled) ratio after attending `n` more of component `k`. */
function rawAfterAttends(subj: SubjectAttendance, k: ComponentKey, n: number): number {
  const components = JSON.parse(JSON.stringify(subj.components)) as ComponentMap;
  components[k].conducted += n;
  components[k].attended += n;
  const { attW, condW } = weightedSums({ ...subj, components }, DEFAULT_WEIGHTS);
  return (attW / condW) * 100;
}

/** Raw (un-ceiled) ratio after bunking `n` more of component `k`. */
function rawAfterSkips(subj: SubjectAttendance, k: ComponentKey, n: number): number {
  const components = JSON.parse(JSON.stringify(subj.components)) as ComponentMap;
  components[k].conducted += n;
  const { attW, condW } = weightedSums({ ...subj, components }, DEFAULT_WEIGHTS);
  return (attW / condW) * 100;
}

test('default weights are L=100 T=100 P=50 S=25, thresholds 85/75', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { L: 100, T: 100, P: 50, S: 25 });
  assert.deepEqual(DEFAULT_THRESHOLDS, { safeAt: 85, condonationFrom: 75 });
  assert.equal(DETENTION_FLOOR, 75);
});

test('weightedPct uses new weights and ceils like the ERP', () => {
  // attW = 22*100 + 7*100 = 2900; condW = 28*100 + 10*100 = 3800 -> 76.31 -> 77
  assert.equal(weightedPct(mkSubj([28, 22], [10, 7]), DEFAULT_WEIGHTS), 77);
  assert.equal(weightedPct(mkSubj([10, 9]), DEFAULT_WEIGHTS), 90);
  assert.equal(weightedPct(mkSubj([3, 2]), DEFAULT_WEIGHTS), 67); // 66.67 -> 67
});

test('weightedPct is null when nothing counts', () => {
  assert.equal(weightedPct(mkSubj([0, 0]), DEFAULT_WEIGHTS), null);
});

test('sandboxPct: attend adds conducted+attended, bunk adds conducted only', () => {
  const subj = mkSubj([10, 8]); // 80%
  const plan = emptyPlan();
  plan.L.attend = 2;
  plan.L.skip = 1;
  // (8+2)/(10+2+1) = 10/13 = 76.92 -> 77
  assert.equal(sandboxPct(subj, DEFAULT_WEIGHTS, plan), 77);
  const bunkOnly = emptyPlan();
  bunkOnly.L.skip = 5;
  // 8/15 = 53.33 -> 54
  assert.equal(sandboxPct(subj, DEFAULT_WEIGHTS, bunkOnly), 54);
});

test('neededToReach matches the spec formula', () => {
  const subj = mkSubj([20, 15]); // 75%, lecture only
  // ceil((85*2000 - 100*1500) / (100*15)) = ceil(13.33) = 14
  assert.equal(neededToReach(subj, DEFAULT_WEIGHTS, 85, 'L'), 14);
  // already above a lower target -> 0
  assert.equal(neededToReach(subj, DEFAULT_WEIGHTS, 70, 'L'), 0);
});

test('neededToReach across components, verified by simulation', () => {
  const subj = mkSubj([20, 15], [10, 10]);
  const n = neededToReach(subj, DEFAULT_WEIGHTS, 85, 'T');
  assert.equal(n, 4);
  // brute-force on the raw ratio (the formula's own semantics; ceil is display-only)
  for (let k = 0; k < n; k++) {
    assert.ok(rawAfterAttends(subj, 'T', k) < 85, `k=${k}`);
  }
  assert.ok(rawAfterAttends(subj, 'T', n) >= 85);
});

test('skipMargin matches the spec formula', () => {
  const subj = mkSubj([20, 15]); // 75%
  // floor((100*1500 - 70*2000) / (70*100)) = floor(1.428) = 1
  assert.equal(skipMargin(subj, DEFAULT_WEIGHTS, 70, 'L'), 1);
  // exactly at the line -> no runway
  assert.equal(skipMargin(subj, DEFAULT_WEIGHTS, 75, 'L'), 0);
  // below the line -> no runway
  assert.equal(skipMargin(mkSubj([20, 10]), DEFAULT_WEIGHTS, 70, 'L'), 0);
});

test('skipMargin across components, verified by simulation', () => {
  const subj = mkSubj([20, 20], [10, 8]); // strong lecture, weaker tutorial
  const m = skipMargin(subj, DEFAULT_WEIGHTS, 85, 'T');
  for (let k = 0; k <= m; k++) {
    assert.ok(rawAfterSkips(subj, 'T', k) >= 85, `k=${k}`);
  }
  assert.ok(rawAfterSkips(subj, 'T', m + 1) < 85);
});

test('tcbrPct mirrors the ERP late-joiner adjustment', () => {
  assert.equal(tcbrPct({ conducted: 28, attended: 22 }, 3), 88); // 22/25
  assert.equal(tcbrPct({ conducted: 5, attended: 5 }, 5), null);
  assert.equal(tcbrPct({ conducted: 3, attended: 3 }, 5), null);
});

test('weightedPct honors per-component TCBR', () => {
  const subj = mkSubj([28, 22]);
  assert.equal(weightedPct(subj, DEFAULT_WEIGHTS, { L: 3 }), 88);
  // TCBR'd out entirely -> null
  assert.equal(weightedPct(subj, DEFAULT_WEIGHTS, { L: 28 }), null);
});

test('courseTcbr resolves settings to a component map', () => {
  assert.equal(courseTcbr('CS101', { enabled: false, perCourse: { CS101: 3 } }), undefined);
  assert.deepEqual(courseTcbr('CS101', { enabled: true, perCourse: { CS101: 3 } }), {
    L: 3, T: 3, P: 3, S: 3,
  });
  assert.equal(courseTcbr('CS101', { enabled: true, perCourse: {} }), undefined);
  assert.equal(courseTcbr('CS101', { enabled: true, perCourse: { CS101: 0 } }), undefined);
});

test('policyBand uses the fresh band names', () => {
  assert.equal(policyBand(90, DEFAULT_THRESHOLDS), 'cruising');
  assert.equal(policyBand(80, DEFAULT_THRESHOLDS), 'thin-ice');
  assert.equal(policyBand(70, DEFAULT_THRESHOLDS), 'in-the-red');
  assert.equal(policyBand(null, DEFAULT_THRESHOLDS), 'cruising');
});

test('maxSkippable + skipGuidance at both red lines', () => {
  const subj = mkSubj([20, 20]);
  assert.equal(maxSkippable(subj, DEFAULT_WEIGHTS, 85), 3);
  const g = skipGuidance(subj, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS);
  assert.equal(g.keepCruising, 3);
  assert.equal(g.stayAboveFloor, 6);
});

test('classImpact deltas are sane and ceiled', () => {
  const subj = mkSubj([28, 22]);
  const { gain, loss } = classImpact(subj, DEFAULT_WEIGHTS, 'L');
  // cur 79 -> attend 80 (gain 1), bunk 76 (loss 3)
  assert.equal(gain, 1);
  assert.equal(loss, 3);
});
