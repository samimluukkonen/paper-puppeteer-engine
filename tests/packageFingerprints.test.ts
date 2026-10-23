import { assert, test, vi } from 'vitest';
import { draftSource } from '../src/devtools/shared/draftSource.js';
import type { PackageSnapshot } from '../src/devtools/shared/package/characterPackage.js';
import { PackageFingerprints } from '../src/devtools/shared/package/PackageFingerprints.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { freezeData } from '../src/engine/readonlyData.js';

function fixture(): PackageSnapshot {
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'fingerprints',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['first.json', 'second.json'],
      textures: {},
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root' }] },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    animations: Object.fromEntries(
      ['first', 'second'].map((name) => [
        `${name}.json`,
        { version: 1, name, duration: 1000, loop: true, tracks: { root: [{ time: 0, x: 1 }] } },
      ]),
    ),
  });
  return {
    definition,
    rig: freezeData(structuredClone(definition.rigFile!)),
    skins: definition.standaloneSkins,
    animations: definition.animations,
    replacements: [],
  };
}

test('immutable domain and clip fingerprints reuse hashes across fresh wrappers, edits and undo', () => {
  const digest = vi.fn(draftSource);
  const fingerprints = new PackageFingerprints(digest);
  const source = fixture();
  const baseline = fingerprints.compute(source);
  assert.equal(digest.mock.calls.length, 7); // Five domains and two clips.
  digest.mockClear();
  assert.deepEqual(
    fingerprints.compute({ ...source, rig: { ...source.rig }, animations: [...source.animations] }),
    baseline,
  );
  assert.equal(digest.mock.calls.length, 0);

  const editedRig = { ...source, rig: freezeData({ ...source.rig, bones: [{ id: 'root', x: 12 }] }) };
  const rigDomains = fingerprints.compute(editedRig);
  assert.equal(digest.mock.calls.length, 1);
  assert.notEqual(rigDomains.Rig, baseline.Rig);
  assert.equal(rigDomains.Animations, baseline.Animations);
  digest.mockClear();

  const edited = {
    ...editedRig,
    animations: [
      freezeData({ ...source.animations[0]!, tracks: { root: [{ time: 0, x: 42 }] } }),
      source.animations[1]!,
    ],
  };
  const animationDomains = fingerprints.compute(edited);
  assert.equal(digest.mock.calls.length, 2); // Only the edited clip and the small list of clip digests.
  assert.equal(animationDomains.Rig, rigDomains.Rig);
  assert.notEqual(animationDomains.Animations, baseline.Animations);
  digest.mockClear();
  assert.equal(fingerprints.compute(editedRig).Animations, baseline.Animations);
  assert.equal(digest.mock.calls.length, 1); // Undo reuses both original clip digests.
});

test('mutable snapshots detect in-place edits without freezing caller data', () => {
  const fingerprints = new PackageFingerprints();
  const source = fixture();
  const current = {
    ...source,
    rig: structuredClone(source.rig),
    skins: structuredClone(source.skins),
    animations: structuredClone(source.animations),
  };
  const baseline = fingerprints.compute(current);
  current.rig.bones[0]!.x = 12;
  const changedRig = fingerprints.compute(current);
  assert.notEqual(changedRig.Rig, baseline.Rig);
  assert.equal(changedRig.Animations, baseline.Animations);
  current.animations[0]!.tracks.root![0]!.x = 42;
  assert.notEqual(fingerprints.compute(current).Animations, baseline.Animations);
  assert.isFalse(Object.isFrozen(current.rig.bones));
  assert.isFalse(Object.isFrozen(current.animations[0]));
});

test('asset fingerprints detect alignment, binary and format changes while reusing other domains', () => {
  const digest = vi.fn(draftSource);
  const fingerprints = new PackageFingerprints(digest);
  const source = fixture();
  const replacement: PackageSnapshot['replacements'][number] = {
    assetKey: 'asset',
    reference: undefined,
    blob: new Blob(['image']),
    format: 'image/png',
    originScaleX: 1,
    originScaleY: 1,
  };
  const current = { ...source, replacements: [replacement] };
  const baseline = fingerprints.compute(current);
  digest.mockClear();
  assert.deepEqual(fingerprints.compute({ ...current, replacements: [{ ...replacement }] }), baseline);
  assert.equal(digest.mock.calls.length, 0);
  for (const patch of [
    { originScaleX: 2 },
    { blob: new Blob(['different image']) },
    { format: 'image/webp' as const },
  ]) {
    const changed = fingerprints.compute({ ...source, replacements: [{ ...replacement, ...patch }] });
    assert.notEqual(changed.Assets, baseline.Assets);
    assert.equal(changed.Animations, baseline.Animations);
    assert.equal(digest.mock.calls.length, 1);
    digest.mockClear();
  }
});
