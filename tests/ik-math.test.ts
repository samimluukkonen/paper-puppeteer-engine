import { assert, test } from 'vitest';
import type { TwoBoneIKInput, TwoBoneIKResult } from '../src/engine/ik/solveTwoBoneIK.js';
import { blendIKRotation, solveTwoBoneIK } from '../src/engine/ik/solveTwoBoneIK.js';

const input: TwoBoneIKInput = {
  root: { x: 10, y: 20 },
  target: { x: 70, y: 80 },
  lengthA: 60,
  lengthB: 50,
  bendDirection: 1,
};

function finite(result: TwoBoneIKResult): void {
  for (const value of [
    result.rootRotation,
    result.middleRotation,
    result.middle.x,
    result.middle.y,
    result.end.x,
    result.end.y,
  ])
    assert.isTrue(Number.isFinite(value));
}

test('reachable target is reached with actual segment lengths and a translated root', () => {
  const result = solveTwoBoneIK(input);
  assert.isTrue(result.reachable);
  assert.approximately(result.end.x, input.target.x, 1e-8);
  assert.approximately(result.end.y, input.target.y, 1e-8);
  assert.approximately(Math.hypot(result.middle.x - input.root.x, result.middle.y - input.root.y), 60, 1e-8);
  assert.approximately(Math.hypot(result.end.x - result.middle.x, result.end.y - result.middle.y), 50, 1e-8);
});

test('far target fully extends without stretching either link', () => {
  const result = solveTwoBoneIK({ ...input, target: { x: 1010, y: 20 } });
  assert.isFalse(result.reachable);
  assert.approximately(result.end.x, 120, 1e-8);
  assert.approximately(result.end.y, 20, 1e-8);
  assert.approximately(result.middleRotation, 0, 1e-8);
  finite(result);
});

test('target inside minimum reach folds an unequal chain to its inner boundary', () => {
  for (const [lengthA, lengthB] of [
    [60, 50],
    [50, 60],
  ]) {
    const result = solveTwoBoneIK({ ...input, lengthA: lengthA!, lengthB: lengthB!, target: { x: 10.01, y: 20 } });
    assert.isFalse(result.reachable);
    assert.approximately(result.end.x, 20, 1e-8);
    assert.approximately(result.end.y, 20, 1e-8);
    assert.approximately(Math.abs(result.middleRotation), Math.PI, 1e-8);
    finite(result);
  }
});

test('equal links fold at the root using a deterministic fallback direction', () => {
  const values = { ...input, lengthB: 60, target: input.root, fallbackRotation: 0.7 };
  const result = solveTwoBoneIK(values);
  assert.isTrue(result.reachable);
  assert.approximately(result.rootRotation, 0.7 - Math.PI / 2, 1e-8);
  assert.approximately(result.end.x, input.root.x, 1e-8);
  assert.approximately(result.end.y, input.root.y, 1e-8);
  assert.deepEqual(solveTwoBoneIK(values), result);
});

test('opposite bend directions reach the same target with opposite signed elbows', () => {
  const a = solveTwoBoneIK(input);
  const b = solveTwoBoneIK({ ...input, bendDirection: -1 });
  assert.isAbove(a.middleRotation, 0);
  assert.isBelow(b.middleRotation, 0);
  assert.approximately(a.middleRotation, -b.middleRotation, 1e-8);
  assert.isAbove(Math.hypot(a.middle.x - b.middle.x, a.middle.y - b.middle.y), 30);
  assert.approximately(a.end.x, b.end.x, 1e-8);
  assert.approximately(a.end.y, b.end.y, 1e-8);
});

test('zero and nearly zero links always produce finite results', () => {
  for (const lengthA of [0, 1e-12, 50]) {
    for (const lengthB of [0, 1e-12, 50]) {
      for (const target of [input.root, { x: 10 + 1e-12, y: 20 }, input.target]) {
        finite(solveTwoBoneIK({ ...input, lengthA, lengthB, target }));
      }
    }
  }
});

test('sweeping across inner and outer boundaries never flips bend or produces invalid math', () => {
  for (const bendDirection of [-1, 1] as const) {
    for (let angle = -Math.PI; angle <= Math.PI; angle += 0.1) {
      for (const distance of [0, 1e-9, 9.999999, 10, 10.000001, 75, 109.999999, 110, 110.000001, 1000]) {
        const result = solveTwoBoneIK({
          ...input,
          bendDirection,
          target: { x: 10 + distance * Math.cos(angle), y: 20 + distance * Math.sin(angle) },
        });
        finite(result);
        assert.isAtLeast(result.middleRotation * bendDirection, 0);
      }
    }
  }
});

test('mix zero preserves authored rotation, mix one matches IK, and half mix uses the shortest angle', () => {
  assert.strictEqual(blendIKRotation(0.7, -1.1, 0), 0.7);
  assert.approximately(blendIKRotation(0.7, -1.1, 1), -1.1, 1e-8);
  assert.approximately(blendIKRotation(0.7, -1.1, 0.5), -0.2, 1e-8);
  assert.approximately(blendIKRotation(Math.PI - 0.1, -Math.PI + 0.1, 0.5), Math.PI, 1e-8);
  assert.approximately(blendIKRotation(4 * Math.PI, 0.2, 1), 4 * Math.PI + 0.2, 1e-8);
});

test('large lengths avoid overflow in law-of-cosines intermediates', () => {
  finite(
    solveTwoBoneIK({ ...input, root: { x: 0, y: 0 }, target: { x: 1e100, y: 1e100 }, lengthA: 1e100, lengthB: 1e100 }),
  );
});

test('invalid inputs are rejected before they can contaminate a pose', () => {
  for (const lengthA of [-1, NaN, Infinity]) assert.throws(() => solveTwoBoneIK({ ...input, lengthA }));
  assert.throws(() => solveTwoBoneIK({ ...input, target: { x: NaN, y: 0 } }), /finite/);
  for (const mix of [-1, 2, NaN, Infinity]) assert.throws(() => blendIKRotation(0, 1, mix));
});
