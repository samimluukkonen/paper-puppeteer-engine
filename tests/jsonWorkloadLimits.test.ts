import { assert, test } from 'vitest';
import { JsonInputLimitError } from '../src/engine/jsonInput.js';
import { DEFAULT_JSON_WORKLOAD_LIMITS, JsonWorkloadBudget } from '../src/engine/jsonWorkloadLimits.js';

function chain(length: number) {
  return Array.from({ length }, (_, index) => ({ id: `b${index}`, ...(index ? { parent: `b${index - 1}` } : {}) }));
}

test.each(Object.keys(DEFAULT_JSON_WORKLOAD_LIMITS))('%s rejects invalid limits', (name) => {
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => new JsonWorkloadBudget({ [name]: value }), /positive safe integer/);
});

test.each([
  ['slots', 'maxSlots', 'slot'],
  ['attachments', 'maxAttachments', 'attachment'],
  ['ik', 'maxIKConstraints', 'IK constraint'],
] as const)('%s are bounded before reading entries, even with a malformed skeleton', (field, option, label) => {
  const entries = Array.from({ length: DEFAULT_JSON_WORKLOAD_LIMITS[option] + 1 }, () => ({}));
  Object.defineProperty(entries, '0', { get: () => assert.fail('Oversized catalogs must not be inspected') });
  const input = { [field]: entries };
  assert.throws(() => new JsonWorkloadBudget().checkRig(input), new RegExp(`${label} limit`));
  assert.doesNotThrow(() => new JsonWorkloadBudget({ [option]: entries.length }).checkRig(input));
  assert.throws(() => new JsonWorkloadBudget({ [option]: 1 }).checkRig({ [field]: [{}, {}] }));
  assert.doesNotThrow(() => new JsonWorkloadBudget({ [option]: 2 }).checkRig({ [field]: [{}, {}] }));
  const unsafe = Object.defineProperty({}, field, { get: () => assert.fail('Do not invoke catalog getters') });
  assert.doesNotThrow(() => new JsonWorkloadBudget().checkRig(unsafe));
});

test('event budgets accumulate across clips independently of keyframes and precede event reads', () => {
  const budget = new JsonWorkloadBudget({ maxEvents: 3, maxKeyframes: 1 });
  budget.checkAnimation({ events: [{}, {}] });
  budget.checkAnimation({ events: [{}], tracks: { root: [{ time: 0 }] } });
  assert.throws(() => budget.checkAnimation({ events: [{}] }), /3-event limit/);
  const rows = Array.from({ length: DEFAULT_JSON_WORKLOAD_LIMITS.maxEvents + 1 }, () => ({}));
  Object.defineProperty(rows, '0', { get: () => assert.fail('Oversized event arrays must not be read') });
  assert.throws(() => new JsonWorkloadBudget().checkAnimation({ events: rows }), /10000-event limit/);
  assert.doesNotThrow(() => new JsonWorkloadBudget({ maxEvents: rows.length }).checkAnimation({ events: rows }));
  const unsafe = Object.defineProperty({}, 'events', { get: () => assert.fail('Do not invoke event getters') });
  assert.doesNotThrow(() => new JsonWorkloadBudget().checkAnimation(unsafe));
});

test('bone count is checked before reading entries or constructing a graph', () => {
  const bones = Array.from({ length: 3 }, () => ({}));
  Object.defineProperty(bones, '0', { get: () => assert.fail('Oversized input must not be read') });
  assert.throws(() => new JsonWorkloadBudget({ maxBones: 2 }).checkRig({ bones }), JsonInputLimitError);
  assert.doesNotThrow(() => new JsonWorkloadBudget({ maxBones: 3 }).checkRig({ bones: chain(3) }));
});

test.each(['parent-first', 'child-first'] as const)('hierarchy depth is bounded for %s rigs', (order) => {
  const budget = new JsonWorkloadBudget({ maxBones: 10, maxBoneDepth: 3 });
  const bones = chain(4);
  if (order === 'child-first') bones.reverse();
  assert.throws(() => budget.checkRig({ bones }), /3-level bone hierarchy limit/);
  assert.doesNotThrow(() => budget.checkRig({ bones: chain(3) }));
  assert.doesNotThrow(() =>
    budget.checkRig({ bones: [{ id: 'root' }, ...chain(9).map((bone) => ({ ...bone, parent: 'root' }))] }),
  );
});

test('cycles, missing parents and malformed shapes terminate without invoking accessors', () => {
  const budget = new JsonWorkloadBudget();
  for (const input of [
    null,
    { bones: {} },
    {
      bones: [
        { id: 'a', parent: 'b' },
        { id: 'b', parent: 'a' },
      ],
    },
    { bones: [{ id: 'a', parent: 'missing' }] },
  ])
    assert.doesNotThrow(() => budget.checkRig(input));
  const unsafe = Object.defineProperty({}, 'bones', { get: () => assert.fail('Do not execute input getters') });
  assert.doesNotThrow(() => budget.checkRig(unsafe));
  const unsafeTrack = Object.defineProperty({}, 'root', {
    enumerable: true,
    get: () => assert.fail('Do not execute track getters'),
  });
  assert.doesNotThrow(() => budget.checkAnimation({ tracks: unsafeTrack }));
});

test('keyframe rows accumulate across bone tracks, IK tracks and animations', () => {
  const budget = new JsonWorkloadBudget({ maxKeyframes: 4 });
  budget.checkAnimation({ tracks: { root: [{ time: 0 }, { time: 1 }] }, ikTracks: { arm: [{ time: 0 }] } });
  budget.checkAnimation({ tracks: { root: [{ time: 0 }] } });
  assert.throws(() => budget.checkAnimation({ ikTracks: { arm: [{ time: 0 }] } }), /4-keyframe limit/);
});

test('default limits reject oversized compact data and can be raised for trusted inputs', () => {
  const bones = chain(DEFAULT_JSON_WORKLOAD_LIMITS.maxBoneDepth + 1);
  assert.throws(() => new JsonWorkloadBudget().checkRig({ bones }), /bone hierarchy limit/);
  assert.doesNotThrow(() => new JsonWorkloadBudget({ maxBoneDepth: bones.length }).checkRig({ bones }));
  const rows = Array.from({ length: DEFAULT_JSON_WORKLOAD_LIMITS.maxKeyframes + 1 }, () => ({ time: 0 }));
  assert.throws(() => new JsonWorkloadBudget().checkAnimation({ tracks: { root: rows } }), /keyframe limit/);
  assert.doesNotThrow(() =>
    new JsonWorkloadBudget({ maxKeyframes: rows.length }).checkAnimation({ tracks: { root: rows } }),
  );
});
