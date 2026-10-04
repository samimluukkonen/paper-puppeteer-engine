import { assert, test } from 'vitest';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';

test('relative determinant tolerance distinguishes unstable editor gestures from finite runtime inversion', () => {
  const matrix = { a: 1, b: 0, c: 1, d: 1e-14, tx: 5, ty: 0 };
  const local = { x: 3, y: 4 };
  const world = localToWorld(local, matrix);
  assert.isUndefined(worldToLocal(world, matrix));
  const result = worldToLocal(world, matrix, 0)!;
  assert.approximately(result.x, local.x, 1e-12);
  assert.approximately(result.y, local.y, 1e-12);
});

test.each([0, 1e-12])(
  'inversion with tolerance %s rejects singular, nonfinite, and unrepresentable results',
  (tolerance) => {
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    assert.isUndefined(worldToLocal({ x: 1, y: 1 }, { ...identity, a: 0 }, tolerance));
    assert.isUndefined(worldToLocal({ x: 1, y: 1 }, { ...identity, c: 1, d: 0 }, tolerance));
    assert.isUndefined(worldToLocal({ x: Infinity, y: 0 }, identity, tolerance));
    assert.isUndefined(worldToLocal({ x: 1, y: 1 }, { ...identity, tx: NaN }, tolerance));
    assert.isUndefined(worldToLocal({ x: Number.MAX_VALUE, y: 0 }, { ...identity, a: 1e-200 }, tolerance));
  },
);
