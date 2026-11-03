/** Attendance maths: rounding, budgets, calculator. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ceilPct,
  componentBudget,
  courseTcbr,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  emptyPlan,
  overallPct,
  policyBand,
  sandboxPct,
  simpleAttendance,
  weightedPct,
  type ComponentKey,
  type SubjectAttendance,
} from '../lib/math';

const W = DEFAULT_WEIGHTS;
const subj = (c: Partial<Record<ComponentKey, [number, number]>>): SubjectAttendance => ({
  code: 'X',
  title: 'X',
  components: {
    L: { attended: c.L?.[0] ?? 0, conducted: c.L?.[1] ?? 0 },
    T: { attended: c.T?.[0] ?? 0, conducted: c.T?.[1] ?? 0 },
    P: { attended: c.P?.[0] ?? 0, conducted: c.P?.[1] ?? 0 },
    S: { attended: c.S?.[0] ?? 0, conducted: c.S?.[1] ?? 0 },
  },
});

test('ceilPct rounds up without floating-point drift', () => {
  assert.equal(ceilPct(7, 100), 7); // 0.07 * 100 = 7.000000000000001 in floats
  assert.equal(ceilPct(14, 200), 7);
  assert.equal(ceilPct(17, 20), 85);
  assert.equal(ceilPct(1, 3), 34);
  assert.equal(ceilPct(0, 5), 0);
  assert.equal(ceilPct(5, 5), 100);
});

test('weighted percentage uses L100 T100 P50 S25 and rounds up', () => {
  // 34*100 + 10*100 + 18*50 = 5300 over 40*100 + 12*100 + 22*50 = 6300 → 84.13 → 85
  assert.equal(weightedPct(subj({ L: [34, 40], T: [10, 12], P: [18, 22] }), W), 85);
  assert.equal(weightedPct(subj({ S: [14, 16] }), W), 88);
  assert.equal(weightedPct(subj({}), W), null);
});

test('late-joiner fix removes classes held before registration', () => {
  const s = subj({ L: [20, 30] });
  const tcbr = courseTcbr('X', { enabled: true, perCourse: { X: 6 } });
  assert.deepEqual(tcbr, { L: 6, T: 6, P: 6, S: 6 });
  assert.equal(weightedPct(s, W, tcbr), 84); // 20 / 24
  assert.equal(courseTcbr('X', { enabled: false, perCourse: { X: 6 } }), undefined);
});

test('what-if: attending adds to both counts, skipping only to conducted', () => {
  const s = subj({ L: [29, 38] });
  const plan = emptyPlan();
  plan.L.attend = 4;
  assert.equal(sandboxPct(s, W, plan), ceilPct(33, 42));
  plan.L.skip = 2;
  assert.equal(sandboxPct(s, W, plan), ceilPct(33, 44));
});

test('budgets always agree with the displayed percentage (property check)', () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let i = 0; i < 400; i++) {
    const comps: Partial<Record<ComponentKey, [number, number]>> = {};
    for (const k of ['L', 'T', 'P', 'S'] as ComponentKey[]) {
      if (rand(3) === 0) continue;
      const cond = 1 + rand(45);
      comps[k] = [rand(cond + 1), cond];
    }
    const s = subj(comps);
    for (const target of [75, 85]) {
      for (const k of Object.keys(comps) as ComponentKey[]) {
        const b = componentBudget(s, W, target, k);
        assert.ok(b, 'component with classes has a budget');
        const at = (attend: number, skip: number) => {
          const plan = emptyPlan();
          plan[k] = { attend, skip };
          return sandboxPct(s, W, plan)!;
        };
        if (b.spare > 0) {
          assert.ok(at(0, b.spare) >= target, `after ${b.spare} skips still ≥ ${target}`);
        }
        if (weightedPct(s, W)! >= target) {
          assert.equal(b.needed, 0);
          assert.ok(at(0, b.spare + 1) < target, `one more skip than spare drops below ${target}`);
        } else if (Number.isFinite(b.needed)) {
          assert.ok(at(b.needed, 0) >= target, `${b.needed} attends reach ${target}`);
          assert.ok(at(b.needed - 1, 0) < target, `${b.needed - 1} attends don't`);
        }
      }
    }
  }
});

test('budget is null for a class type the course doesn’t have', () => {
  assert.equal(componentBudget(subj({ L: [30, 34] }), W, 85, 'P'), null);
});

test('overall percentage pools weighted counts across courses', () => {
  const a = subj({ L: [30, 40] });
  const b = subj({ L: [40, 40] });
  assert.equal(overallPct([a, b], W, () => undefined), ceilPct(70, 80));
  assert.equal(overallPct([], W, () => undefined), null);
});

test('bands: 85 cruise line, 75 floor', () => {
  const t = DEFAULT_THRESHOLDS;
  assert.equal(policyBand(85, t), 'cruising');
  assert.equal(policyBand(84, t), 'thin-ice');
  assert.equal(policyBand(75, t), 'thin-ice');
  assert.equal(policyBand(74, t), 'in-the-red');
  assert.equal(policyBand(null, t), 'cruising');
});

test('calculator: attended / total against 85%', () => {
  // 33/39 = 84.6% → the ERP shows 85%; one more miss shows 83%.
  assert.deepEqual(simpleAttendance(33, 39, 85), { shown: 85, exact: 84.62, spare: 0, needed: 0 });
  const low = simpleAttendance(25, 36, 85)!;
  assert.equal(low.shown, 70);
  assert.ok(ceilPct(25 + low.needed, 36 + low.needed) >= 85);
  assert.ok(ceilPct(25 + low.needed - 1, 36 + low.needed - 1) < 85);
  const high = simpleAttendance(38, 40, 85)!;
  assert.ok(ceilPct(38, 40 + high.spare) >= 85 && ceilPct(38, 41 + high.spare) < 85);
  assert.equal(simpleAttendance(5, 4, 85), null);
  assert.equal(simpleAttendance(1.5, 4, 85), null);
  assert.equal(simpleAttendance(0, 0, 85), null);
});
