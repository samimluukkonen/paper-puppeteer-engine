import { assert, test } from 'vitest';
import { sampleProperty } from '../src/engine/AnimationClip.js';

test('dense tracks interpolate the correct interval when seeking in both directions', () => {
  const keys = Array.from({ length: 512 }, (_, index) => ({ time: index * 17, value: index ** 2 }));
  for (const index of [510, 1, 256, 42, 0, 509]) {
    assert.equal(sampleProperty(keys, index * 17), index ** 2);
    assert.closeTo(sampleProperty(keys, (index + 0.25) * 17), index ** 2 * 0.75 + (index + 1) ** 2 * 0.25, 1e-8);
  }
  assert.equal(sampleProperty(keys, -20), 0);
  assert.equal(sampleProperty(keys, 10000), 511 ** 2);
});

test('nonuniform key spacing, single keys, and empty tracks keep their sampling behavior', () => {
  const keys = [
    { time: 10, value: 1 },
    { time: 20, value: 3 },
    { time: 80, value: 9 },
  ];
  assert.equal(sampleProperty(keys, 15), 2);
  assert.equal(sampleProperty(keys, 20), 3);
  assert.equal(sampleProperty(keys, 50), 6);
  assert.equal(sampleProperty(keys, 80), 9);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 0), 7);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 100), 7);
  assert.throws(() => sampleProperty([], 0), /empty property track/);
});

test('exact angular keys retain the shortest-path equivalent angle until past the final key', () => {
  const degrees = (value: number) => (value * Math.PI) / 180;
  const keys = [
    { time: 0, value: degrees(179) },
    { time: 100, value: degrees(-179) },
  ];
  assert.closeTo(sampleProperty(keys, 50, 'rotation'), Math.PI, 1e-12);
  assert.closeTo(sampleProperty(keys, 100, 'rotation'), degrees(181), 1e-12);
  assert.equal(sampleProperty(keys, 101, 'rotation'), degrees(-179));
});
