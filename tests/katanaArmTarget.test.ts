import { assert, test } from 'vitest';
import { gripReachCorrection, horizontalEdgesAtY, stepPalmAroundHead } from '../src/demo/katanaArmTarget.js';

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
