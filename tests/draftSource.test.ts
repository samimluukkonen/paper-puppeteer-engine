import { assert, test } from 'vitest';
import { draftSource, sameDraftSource } from '../src/devtools/shared/draftSource.js';
import { Rig } from '../src/engine/Rig.js';

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

test('source fingerprints have fixed storage size for large documents', () => {
  const large = { ...source, animation: { ...source.animation, payload: 'x'.repeat(1_000_000) } };
  const fingerprint = draftSource(large);
  assert.match(fingerprint, /^sha256-v1:[0-9a-f]{64}$/);
  assert.equal(fingerprint.length, draftSource(source).length);
  assert.notEqual(fingerprint, draftSource(source));
  assert.isTrue(sameDraftSource(JSON.stringify(large), fingerprint));
  assert.isTrue(sameDraftSource(fingerprint, JSON.stringify(large)));
  assert.isFalse(sameDraftSource(JSON.stringify(source), fingerprint));
  assert.isFalse(sameDraftSource('sha256-v2:' + fingerprint.slice(10), fingerprint));
  assert.throws(() => draftSource(undefined), /serializable/);
});

test('runtime rigs and their legacy JSON fingerprints match authored skeleton data', () => {
  const rig = new Rig(source.rig);
  const runtime = { ...source, rig };
  const authored = {
    ...source,
    rig: { root: rig.root, bones: rig.bones, slots: rig.slots, attachments: rig.attachments, skins: rig.skins },
  };
  assert.equal(draftSource(runtime), draftSource(authored));
  assert.isTrue(sameDraftSource(JSON.stringify(runtime), draftSource(runtime)));
  assert.isTrue(sameDraftSource(JSON.stringify(runtime, null, 2), draftSource(authored)));
  assert.isFalse(
    sameDraftSource(
      JSON.stringify(runtime),
      draftSource({ ...runtime, rig: new Rig({ root: 'other', bones: [{ id: 'other' }] }) }),
    ),
  );
});

test('runtime-shaped objects in event payloads retain every authored field in source identity', () => {
  const rig = new Rig(source.rig);
  const payloadRig: unknown = JSON.parse(JSON.stringify(rig));
  const payload = { rig: payloadRig };
  const original = { rig, animation: { events: [{ time: 0, data: payload }] } };
  const changed = {
    rig,
    animation: {
      events: [{ time: 0, data: { rig: { ...(payloadRig as Record<string, unknown>), renderOrder: ['changed'] } } }],
    },
  };
  assert.isTrue(sameDraftSource(JSON.stringify(original), draftSource(original)));
  assert.isFalse(sameDraftSource(JSON.stringify(original), draftSource(changed)));
});
