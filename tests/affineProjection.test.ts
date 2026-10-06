import { assert, test } from 'vitest';
import { factorAffine } from '../src/engine/affineProjection.js';

const cases = [
  [1, 0, 0, 1],
  [0, 0, 0, 0],
  [0, 2, 0, 0],
  [-2, 0, 0, 1],
  [2, 3, -4, 5],
  [1, 1, 1, 1],
  [1e-200, 2e-200, 3e-200, -4e-200],
  [1e200, 2e200, 3e200, -4e200],
  [1, 0, 0, 1e-15],
  [1e308, 1e308, 1e308, -1e308],
];
for (let index = 0; index < 100; index += 1)
  cases.push([Math.sin(index), Math.cos(index * 2), Math.sin(index * 3), Math.cos(index * 4)]);

test.each(cases)(
  'two transform factors reconstruct [%s, %s, %s, %s] including shear and singular scales',
  (a, b, c, d) => {
    const factors = factorAffine(
      { a: a, b: b, c: c, d: d, tx: 0, ty: 0 },
      {
        rotation: 0,
        scaleX: 0,
        scaleY: 0,
        innerRotation: 0,
        innerScale: 0,
      },
    );
    assert.isTrue(Object.values(factors).every(Number.isFinite));
    const outerCos = Math.cos(factors.rotation);
    const outerSin = Math.sin(factors.rotation);
    const innerCos = Math.cos(factors.innerRotation);
    const innerSin = Math.sin(factors.innerRotation);
    const actual = [
      (outerCos * factors.scaleX * innerCos - outerSin * factors.scaleY * innerSin) * factors.innerScale,
      (outerSin * factors.scaleX * innerCos + outerCos * factors.scaleY * innerSin) * factors.innerScale,
      (-outerCos * factors.scaleX * innerSin - outerSin * factors.scaleY * innerCos) * factors.innerScale,
      (-outerSin * factors.scaleX * innerSin + outerCos * factors.scaleY * innerCos) * factors.innerScale,
    ];
    const expected = [a, b, c, d];
    const magnitude = Math.max(...expected.map(Math.abs)) || 1;
    for (let index = 0; index < 4; index += 1)
      assert.closeTo(actual[index]! / magnitude, expected[index]! / magnitude, 1e-14);
  },
);
