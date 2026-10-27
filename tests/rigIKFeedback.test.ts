import { assert, test } from 'vitest';
import { rigIKBendArrow } from '../src/devtools/rig-editor/rigIKBendArrow.js';
import { rigIKFeedback } from '../src/devtools/rig-editor/rigIKFeedback.js';
import { transformToAffine } from '../src/engine/affineMath.js';
import type { IKStatus } from '../src/engine/ik/types.js';
import { createTransform } from '../src/engine/types.js';

test.each([
  ['solved', 'Reachable'],
  ['clamped', 'Unreachable target'],
  ['inactive', 'Inactive'],
  ['singular-transform', 'Cannot solve'],
  ['unsupported-scale', 'Unsupported scale'],
] as const)('presents the runtime %s status without replacing it', (status: IKStatus, label) => {
  const constraint = Object.freeze({ status, enabled: true });
  assert.equal(rigIKFeedback(constraint, {}).label, label);
  assert.equal(rigIKFeedback(constraint, { enabled: false }).label, 'Disabled');
  assert.equal(rigIKFeedback({ status, enabled: false }, {}).label, 'Solver off');
});

test('bend arrow follows signed turns and reflected start-bone axes at a constant screen radius', () => {
  const center = { x: 100, y: 200 };
  for (const scaleX of [-2, 2]) {
    const basis = transformToAffine(createTransform({ scaleX, scaleY: 0.5, rotation: 0.4 }), {
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      tx: 0,
      ty: 0,
    });
    // Nonzero y verifies the indicator starts along the actual link, not an assumed +X sprite axis.
    const axis = { x: 3, y: 4 };
    for (const bend of [-1, 1] as const) {
      const arrow = rigIKBendArrow(center, axis, bend, basis);
      assert.lengthOf(arrow.arc, 9);
      assert.lengthOf(arrow.head, 3);
      for (const point of arrow.arc) assert.closeTo(Math.hypot(point.x - center.x, point.y - center.y), 20, 1e-8);
      const first = arrow.arc[0]!;
      const next = arrow.arc[1]!;
      const cross = (first.x - center.x) * (next.y - center.y) - (first.y - center.y) * (next.x - center.x);
      assert.equal(Math.sign(cross), bend * Math.sign(scaleX));
      assert.deepEqual(arrow.head[1], arrow.arc[8]);
    }
  }
  assert.deepEqual(rigIKBendArrow(center, { x: 0, y: 1 }, 1, { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }), {
    arc: [],
    head: [],
  });
});
