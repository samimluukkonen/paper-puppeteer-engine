import { assert, test } from 'vitest';
import { draftSource, sameDraftSource } from '../src/devtools/shared/draftSource.js';

const source = {
  rig: { root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] },
  animation: {
    name: 'idle',
    duration: 1000,
    tracks: { root: [{ time: 0, x: 1 }], child: [{ time: 0, y: 2 }] },
    events: [{ time: 100, data: { a: 1, b: [2, 3] } }],
  },
};

test('source identity ignores key order throughout rig, tracks and event payloads', () => {
  const reordered = {
    animation: {
      ...source.animation,
      tracks: { child: [{ y: 2, time: 0 }], root: [{ x: 1, time: 0 }] },
      events: [{ data: { b: [2, 3], a: 1 }, time: 100 }],
    },
    rig: { bones: [{ id: 'root' }, { parent: 'root', id: 'child' }], root: 'root' },
  };
  assert.equal(draftSource(source), draftSource(reordered));
  assert.isTrue(sameDraftSource(JSON.stringify(source), draftSource(reordered)));
  assert.isTrue(sameDraftSource(JSON.stringify(source, null, 2), JSON.stringify(reordered)));
});

test('authored values and array order remain part of source identity', () => {
  for (const changed of [
    { ...source, animation: { ...source.animation, duration: 2000 } },
    { ...source, rig: { ...source.rig, bones: [...source.rig.bones].reverse() } },
    { ...source, animation: { ...source.animation, events: [{ time: 100, data: { a: 1, b: [3, 2] } }] } },
  ])
    assert.isFalse(sameDraftSource(draftSource(source), draftSource(changed)));
});

test('opaque legacy sources retain exact matching and malformed sources do not match', () => {
  assert.isTrue(sameDraftSource('original', 'original'));
  assert.isFalse(sameDraftSource('original', 'different'));
  assert.isFalse(sameDraftSource('broken JSON', draftSource(source)));
});
