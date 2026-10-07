import { assert, test } from 'vitest';
import { freezeData, isFullyFrozen } from '../src/engine/readonlyData.js';

test('freezing traverses shallow-frozen roots, arrays and shared frozen branches', () => {
  const child = { value: 1 };
  const branch = Object.freeze({ child });
  const array = Object.freeze([branch]);
  const root = Object.freeze({ array, branch });
  assert.isFalse(isFullyFrozen(root));
  assert.strictEqual(freezeData(root), root);
  assert.isTrue(Object.isFrozen(child));
  assert.isTrue(isFullyFrozen(root));
  assert.throws(() => {
    child.value = 2;
  }, TypeError);
  assert.equal(child.value, 1);
  assert.strictEqual(freezeData(root), root);
});

test('deep immutability verification includes symbol-owned children', () => {
  const key = Symbol('child');
  const child = { value: 1 };
  const root = Object.freeze({ [key]: child });
  assert.isFalse(isFullyFrozen(root));
  Object.freeze(child);
  assert.isTrue(isFullyFrozen(root));
});
