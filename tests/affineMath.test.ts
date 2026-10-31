import { assert, test } from 'vitest';
import { invertAffine, localToWorld, worldToLocal } from '../src/engine/affineMath.js';

test.each([1, 1e-200, 1e200])('reusable affine inverse handles shear, reflection and scale %s', (scale) => {
  const matrix = { a: 2 * scale, b: 0.5 * scale, c: -0.75 * scale, d: -1.5 * scale, tx: 7 * scale, ty: -5 * scale };
  const inverse = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  assert.isTrue(invertAffine(matrix, inverse));
  for (const point of [
    { x: 0, y: 0 },
    { x: 3, y: -4 },
    { x: -5, y: 2 },
  ]) {
    const world = localToWorld(point, matrix);
    const actual = localToWorld(world, inverse);
    const expected = worldToLocal(world, matrix)!;
    assert.closeTo(actual.x, expected.x, 1e-12);
    assert.closeTo(actual.y, expected.y, 1e-12);
    assert.closeTo(actual.x, point.x, 1e-12);
    assert.closeTo(actual.y, point.y, 1e-12);
  }
});

test('reusable inverse preserves its output when the matrix or inverse is invalid', () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const inverse = { ...identity };
  for (const matrix of [
    { ...identity, a: 0 },
    { ...identity, c: 1, d: 0 },
    { ...identity, c: 1, d: 1e-14 },
    { ...identity, a: 1e-320 },
    { ...identity, a: 1e-200, tx: 1e200 },
    ...Object.keys(identity).flatMap((key) => [
      { ...identity, [key]: NaN },
      { ...identity, [key]: Infinity },
    ]),
  ]) {
    assert.isFalse(invertAffine(matrix, inverse));
    assert.deepEqual(inverse, identity);
  }
  assert.isTrue(invertAffine({ ...identity, c: 1, d: 1e-14 }, inverse, 0));
});

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
