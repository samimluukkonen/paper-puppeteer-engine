import { assert, test } from 'vitest';
import { setBonePropertyKeyframe } from '../src/devtools/animation-editor/keyframes.js';
import { getCompiledPreviewClip } from '../src/devtools/animation-editor/previewClip.js';
import {
  getValidatedEditorAnimation,
  validateEditedAnimation,
} from '../src/devtools/animation-editor/validatedAnimation.js';
import { freezeData, isFullyFrozen } from '../src/devtools/shared/editorData.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clip = (): AnimationClip => ({
  name: 'move',
  duration: 1000,
  loop: false,
  tracks: { root: [{ time: 0, x: 1 }] },
});

test('deeply frozen files share immutable validation results only for the same rig', () => {
  const animation = freezeData(clip());
  const parsed = getValidatedEditorAnimation(animation, rig);
  assert.strictEqual(getValidatedEditorAnimation(animation, rig), parsed);
  assert.isTrue(Object.isFrozen(parsed.tracks.root![0]));
  assert.throws(
    () => getValidatedEditorAnimation(animation, new Rig({ root: 'other', bones: [{ id: 'other' }] })),
    /unknown bone/i,
  );
});

test.each([false, true])('mutable nested files remain validated after every change, shallow freeze=%s', (shallow) => {
  const animation = clip();
  if (shallow) Object.freeze(animation);
  const parsed = getValidatedEditorAnimation(animation, rig);
  assert.isFalse(Object.isFrozen(animation.tracks.root![0]));
  (animation.tracks.root![0] as { x: number }).x = 7;
  assert.equal(getValidatedEditorAnimation(animation, rig).tracks.root![0]!.x, 7);
  assert.equal(parsed.tracks.root![0]!.x, 1);
  (animation.tracks.root![0] as { time: number }).time = 1001;
  assert.throws(() => getValidatedEditorAnimation(animation, rig), /duration/i);
  freezeData(animation);
  assert.throws(() => getValidatedEditorAnimation(animation, rig), /duration/i);
});

test('key edits reuse unchanged compiled property maps and preserve independent samples', () => {
  const skeleton = new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] });
  const source = freezeData({ ...clip(), tracks: { ...clip().tracks, child: [{ time: 0, x: 3 }] } });
  const before = getCompiledPreviewClip(source, skeleton);
  const next = setBonePropertyKeyframe(source, skeleton, 'root', 'x', 0, 8);
  const after = getCompiledPreviewClip(next, skeleton);
  assert.notStrictEqual(after.tracks[0]!.properties, before.tracks[0]!.properties);
  assert.strictEqual(after.tracks[1]!.properties, before.tracks[1]!.properties);
  assert.equal(before.tracks[0]!.properties.get('x')![0]!.value, 1);
  assert.equal(after.tracks[0]!.properties.get('x')![0]!.value, 8);
  const settings = freezeData({ ...next, playback: { mode: 'stepped' as const, fps: 20 } });
  const stepped = getCompiledPreviewClip(settings, skeleton);
  assert.strictEqual(stepped.tracks[0]!.properties, after.tracks[0]!.properties);
  assert.strictEqual(stepped.tracks[1]!.properties, after.tracks[1]!.properties);
});

test('preview compilation never caches mutable or shallow-frozen track rows', () => {
  const animation = clip();
  Object.freeze(animation.tracks.root);
  const before = getCompiledPreviewClip(animation, rig);
  animation.tracks.root![0]!.x = 9;
  const after = getCompiledPreviewClip(animation, rig);
  assert.equal(before.tracks[0]!.properties.get('x')![0]!.value, 1);
  assert.equal(after.tracks[0]!.properties.get('x')![0]!.value, 9);
});

test('incremental validation still rejects changed keys, metadata, events, and rig references', () => {
  const source = freezeData({ ...clip(), events: [{ time: 900, name: 'late' }] });
  getValidatedEditorAnimation(source, rig);
  for (const next of [
    { ...source, duration: 500 },
    { ...source, playback: { mode: 'stepped', fps: 0 } },
    { ...source, version: 999 },
    { ...source, extra: true },
    { ...source, events: [{ time: 1001, name: 'late' }] },
    { ...source, tracks: { root: [{ time: 0, x: Infinity }] } },
    {
      ...source,
      tracks: {
        root: [
          { time: 500, x: 1 },
          { time: 0, x: 2 },
        ],
      },
    },
    { ...source, tracks: { ...source.tracks, missing: source.tracks.root } },
  ]) {
    assert.throws(() => validateEditedAnimation(next as AnimationClip, source, rig));
  }
  assert.throws(() =>
    validateEditedAnimation({ ...source }, source, new Rig({ root: 'other', bones: [{ id: 'other' }] })),
  );
});

test('incremental validation does not hide accessors, symbols, or hidden dictionary fields', () => {
  const source = freezeData(clip());
  getValidatedEditorAnimation(source, rig);
  let reads = 0;
  const accessor = { ...source };
  Object.defineProperty(accessor, 'duration', {
    enumerable: true,
    get: () => {
      reads++;
      return 1000;
    },
  });
  const hidden = { ...source, tracks: { ...source.tracks } };
  Object.defineProperty(hidden.tracks, 'hidden', { value: [], enumerable: false });
  const symbol = { ...source, [Symbol('extra')]: true };
  for (const next of [accessor, hidden, symbol]) assert.throws(() => validateEditedAnimation(next, source, rig));
  assert.equal(reads, 0);
});

test('failed deep-freeze checks do not cache parents or invoke frozen getters', () => {
  const child = { x: 1 };
  const parent = Object.freeze({ child });
  assert.isFalse(isFullyFrozen(parent));
  Object.freeze(child);
  assert.isTrue(isFullyFrozen(parent));
  let reads = 0;
  const accessor = Object.freeze({
    get x() {
      reads++;
      return {};
    },
  });
  assert.isFalse(isFullyFrozen(accessor));
  assert.equal(reads, 0);
});
