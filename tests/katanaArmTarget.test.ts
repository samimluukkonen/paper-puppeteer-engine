import { assert, test } from 'vitest';
import {
  gripReachCorrection,
  horizontalEdgesAtY,
  palmClearanceCorrection,
  stepPalmAroundHead,
  translateGripTarget,
  updatePalmPath,
} from '../src/demo/katanaArmTarget.js';

test('grip corrections stop when rounding cannot move the target', () => {
  const target = { x: 1e20, y: -1e20 };
  assert.isFalse(translateGripTarget(target, { x: 1, y: -1 }));
  assert.deepEqual(target, { x: 1e20, y: -1e20 });
  assert.isFalse(translateGripTarget(target, { x: 0, y: 0 }));
});

test('grip corrections continue while either coordinate makes progress', () => {
  const target = { x: 1e20, y: 2 };
  assert.isTrue(translateGripTarget(target, { x: 1, y: -0.5 }));
  assert.deepEqual(target, { x: 1e20, y: 1.5 });
  assert.isTrue(translateGripTarget(target, { x: -1e20, y: 0 }));
  assert.deepEqual(target, { x: 0, y: 1.5 });
});

test('palm path switches sides above the head and descends only outside its margin', () => {
  const head = { left: 0, right: 60, top: 0 };
  const previous = { side: 'right' as const, overHead: false };
  const above = updatePalmPath(previous, { x: 20, y: -8 }, head, true, 8);
  assert.deepEqual(above, { side: 'left', overHead: true });
  assert.deepEqual(previous, { side: 'right', overHead: false });
  assert.deepEqual(updatePalmPath(above, { x: -9, y: 10 }, head, true, 8), { side: 'left', overHead: false });
  assert.deepEqual(updatePalmPath(above, { x: 20, y: 10 }, head, true, 8), above);
  assert.deepEqual(updatePalmPath(previous, { x: 20, y: -8 }, head, false, 8), previous);
});

test.each(['left', 'right'] as const)('palm clearance keeps the stronger %s outward correction', (side) => {
  const path = { side, overHead: false };
  const edges = { left: 0, right: 60 };
  const palm = { x: side === 'right' ? 40 : 20, y: 10 };
  const sign = side === 'right' ? 1 : -1;
  assert.deepEqual(palmClearanceCorrection(palm, { x: -5 * sign, y: -2 }, path, edges, undefined, 8), {
    x: sign * 28,
    y: -2,
  });
  assert.deepEqual(palmClearanceCorrection(palm, { x: 35 * sign, y: 4 }, path, edges, undefined, 8), {
    x: sign * 35,
    y: 0,
  });
});

test('overhead clearance routes above the head without pushing toward a silhouette edge', () => {
  const path = { side: 'left' as const, overHead: true };
  const head = { left: 0, right: 60, top: 0 };
  assert.deepEqual(palmClearanceCorrection({ x: 30, y: 4 }, { x: 2, y: -3 }, path, head, head, 8), { x: 2, y: -12 });
  assert.deepEqual(palmClearanceCorrection({ x: -9, y: 4 }, { x: 2, y: -3 }, path, head, head, 8), { x: 2, y: -3 });
});

test('an in-range secondary grip leaves the primary hand target alone', () => {
  assert.deepEqual(gripReachCorrection({ x: 0, y: 0 }, { x: 40, y: 0 }, 30, 30), { x: 0, y: 0 });
});

test('an out-of-reach grip pulls the hand target toward the shoulder', () => {
  const correction = gripReachCorrection({ x: 10, y: 10 }, { x: 110, y: 10 }, 30, 30);
  assert.closeTo(correction.x, -41.5, 1e-8);
  assert.closeTo(correction.y, 0, 1e-8);
});

test('a grip too close to the shoulder moves away from it', () => {
  const correction = gripReachCorrection({ x: 0, y: 0 }, { x: 0, y: 2 }, 40, 20);
  assert.closeTo(correction.x, 0, 1e-8);
  assert.closeTo(correction.y, 18.5, 1e-8);
});

test('body silhouette edge follows the cutout at the palm height', () => {
  const corners = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
  ];
  assert.deepEqual(horizontalEdgesAtY(corners, 1), { left: -1, right: 1 });
  assert.deepEqual(horizontalEdgesAtY(corners, 0), { left: -2, right: 2 });
  assert.strictEqual(horizontalEdgesAtY(corners, 3), undefined);
});

test('a palm crossing the head climbs its near corner before moving across', () => {
  const head = { left: 0, right: 60, top: 0 };
  const step = stepPalmAroundHead({ x: 68, y: 20 }, { x: 30, y: -8 }, head, 8, 8);
  assert.deepEqual(step, { x: 68, y: 12 });
  const across = stepPalmAroundHead({ x: 68, y: -8 }, { x: 30, y: -8 }, head, 8, 8);
  assert.deepEqual(across, { x: 60, y: -8 });
  const reverse = stepPalmAroundHead({ x: -8, y: 20 }, { x: 30, y: -8 }, head, 8, 8);
  assert.deepEqual(reverse, { x: -8, y: 12 });
  const descent = stepPalmAroundHead({ x: 30, y: -8 }, { x: -8, y: 20 }, head, 8, 8);
  assert.deepEqual(descent, { x: 22, y: -8 });
});
