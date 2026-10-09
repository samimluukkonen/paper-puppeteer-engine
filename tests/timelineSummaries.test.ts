import { assert, test } from 'vitest';
import { summarizeKeyframeTimes } from '../src/devtools/animation-editor/timelineSummaries.js';

test('sparse timing and endpoints stay at authored positions; empty rows are excluded', () => {
  const keys = [
    { time: 0, x: 1 },
    { time: 500, rotation: 2 },
    { time: 750 },
    { time: 999, y: 1 },
    { time: 1000, x: 2 },
  ];
  assert.deepEqual([...summarizeKeyframeTimes(keys, 1, 703)], [0, 0.5, 1]);
  assert.deepEqual(
    keys.map((key) => key.time),
    [0, 500, 750, 999, 1000],
  );
});

test('dense summaries follow available pixels and zoom reveals original timestamps', () => {
  const keys = Array.from({ length: 513 }, (_, index) => ({ time: index * 10, x: index }));
  const original = keys.map((key) => key.time / 1000);
  const fitted = summarizeKeyframeTimes(keys, 5.12, 700);
  assert.isAtMost(fitted.size, 101);
  assert.isTrue(fitted.has(0));
  assert.isTrue(fitted.has(5.12));
  assert.isTrue([...fitted].every((time) => original.includes(time)));
  assert.deepEqual([...summarizeKeyframeTimes(keys, 5.12, 5600)], original);
  assert.isBelow(summarizeKeyframeTimes(keys, 5.12, 350).size, fitted.size);
});
