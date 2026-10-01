import { assert, test } from 'vitest';
import { worldToLocal } from '../src/devtools/rig-editor/coordinates.js';
import { gridLines } from '../src/devtools/rig-editor/grid.js';

test('visible grid lines stay on local snap coordinates under rotation and translation', () => {
  const transform = { a: 0, b: 2, c: -2, d: 0, tx: 60, ty: 40 };
  const lines = gridLines(transform, 120, 100, 5);
  assert.isAbove(lines.length, 0);
  for (const line of lines) {
    const start = worldToLocal(line.start, transform)!;
    const end = worldToLocal(line.end, transform)!;
    const fixed = Math.abs(start.x - end.x) < 1e-9 ? start.x : start.y;
    assert.closeTo(fixed / 5, Math.round(fixed / 5), 1e-9);
  }
  assert.ok(lines.some((line) => line.index === 0));
});

test('grid is hidden when off and limits line density at low zoom', () => {
  const transform = { a: 0.1, b: 0, c: 0, d: 0.1, tx: 100, ty: 100 };
  assert.deepEqual(gridLines(transform, 760, 640, 0), []);
  const lines = gridLines(transform, 760, 640, 1);
  assert.isAbove(lines.length, 0);
  assert.isBelow(lines.length, 1600);
  assert.deepEqual(gridLines({ ...transform, d: 0 }, 760, 640, 1), []);
});

test('normal zoom shows distinct line spacing for each grid size', () => {
  const transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const counts = [1, 2, 5, 10].map((snap) => gridLines(transform, 760, 640, snap).length);
  assert.isAbove(counts[0]!, counts[1]!);
  assert.isAbove(counts[1]!, counts[2]!);
  assert.isAbove(counts[2]!, counts[3]!);
});
