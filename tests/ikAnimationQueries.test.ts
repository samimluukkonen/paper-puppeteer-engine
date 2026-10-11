import { afterEach, assert, test, vi } from 'vitest';
import { inspectEditorAnimation } from '../src/devtools/animation-editor/validatedAnimation.js';
import * as externalData from '../src/engine/externalData.js';
import {
  findIKPropertyKeyframe,
  getIKKeyedPropertiesAtTime,
  getIKPropertyKeyframes,
} from '../src/engine/ik/animationKeyframes.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/engine/keyframeAuthoring.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.restoreAllMocks());

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'middle', parent: 'root', x: 10 }, { id: 'end', parent: 'middle', x: 10 }],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
});
const animation = () => ({
  version: 1 as const,
  name: 'reach',
  duration: 10000,
  loop: false,
  tracks: { root: [{ time: 0, x: 0 }] },
  ikTracks: { arm: [{ time: 0, x: 1, y: 2, mix: 0.5 }] },
});

test('editor snapshots reuse boundary validation for repeated IK queries without cloning the animation', () => {
  const input = {
    ...animation(),
    tracks: { root: Array.from({ length: 10000 }, (_, time) => ({ time, x: time })) },
  };
  const snapshot = inspectEditorAnimation(input, rig).data!;
  const parse = vi.spyOn(externalData, 'parseAnimationClip');
  const clone = vi.spyOn(globalThis, 'structuredClone');
  for (let query = 0; query < 30; ++query) {
    assert.deepEqual(findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', 0), { time: 0, value: 1 });
    assert.deepEqual(getIKKeyedPropertiesAtTime(snapshot, rig, 'arm', 0), ['x', 'y', 'mix']);
    assert.deepEqual(getIKPropertyKeyframes(snapshot, rig, 'arm', 'y'), [{ time: 0, value: 2 }]);
  }
  assert.equal(parse.mock.calls.length, 0);
  assert.equal(clone.mock.calls.length, 0);
});

test('caller-owned immutable animations validate once per rig', () => {
  const snapshot = freezeData(animation());
  const parse = vi.spyOn(externalData, 'parseAnimationClip');
  assert.deepEqual(findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', 0), { time: 0, value: 1 });
  assert.deepEqual(getIKPropertyKeyframes(snapshot, rig, 'arm', 'x'), [{ time: 0, value: 1 }]);
  assert.deepEqual(getIKKeyedPropertiesAtTime(snapshot, rig, 'arm', 0), ['x', 'y', 'mix']);
  assert.equal(parse.mock.calls.length, 1);
  const otherRig = new Rig({ root: 'root', bones: rig.bones });
  assert.throws(() => findIKPropertyKeyframe(snapshot, otherRig, 'arm', 'x', 0), /Unknown IK/i);
  assert.equal(parse.mock.calls.length, 2);
});

test.each([false, true])(
  'mutable nested rows stay fresh and invalid mutations are rejected, shallow freeze=%s',
  (shallow) => {
    const input = animation();
    if (shallow) Object.freeze(input);
    assert.deepEqual(findIKPropertyKeyframe(input, rig, 'arm', 'x', 0), { time: 0, value: 1 });
    input.ikTracks.arm[0]!.x = 9;
    assert.deepEqual(findIKPropertyKeyframe(input, rig, 'arm', 'x', 0), { time: 0, value: 9 });
    input.ikTracks.arm[0]!.time = 1;
    assert.isUndefined(findIKPropertyKeyframe(input, rig, 'arm', 'x', 0));
    assert.deepEqual(getIKKeyedPropertiesAtTime(input, rig, 'arm', 1), ['x', 'y', 'mix']);
    input.tracks.root[0]!.time = input.duration + 1;
    assert.throws(() => findIKPropertyKeyframe(input, rig, 'arm', 'x', 1), /duration/i);
    assert.isFalse(Object.isFrozen(input.ikTracks.arm[0]));
  },
);

test('indexed queries retain sparse-channel matching, nearby keys, earlier ties, and exact stored times', () => {
  const gap = KEYFRAME_TIME_TOLERANCE_MS / 2;
  const input = {
    ...animation(),
    ikTracks: {
      arm: [
        { time: 0, x: 1 },
        { time: gap, y: 2 },
        { time: gap * 2, x: 3 },
        { time: 10000, mix: 0.5 },
      ],
    },
  };
  const snapshot = freezeData(structuredClone(input));
  for (const time of [-gap, 0, gap, gap * 1.5, gap * 2, 100, 10000, NaN, Infinity]) {
    for (const property of ['x', 'y', 'mix'] as const)
      assert.deepEqual(
        findIKPropertyKeyframe(snapshot, rig, 'arm', property, time),
        findIKPropertyKeyframe(input, rig, 'arm', property, time),
      );
    assert.deepEqual(
      getIKKeyedPropertiesAtTime(snapshot, rig, 'arm', time),
      getIKKeyedPropertiesAtTime(input, rig, 'arm', time),
    );
  }
  assert.deepEqual(findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', gap), { time: 0, value: 1 });
  assert.deepEqual(findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', gap * 1.5), { time: gap * 2, value: 3 });
  const found = findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', 0)!;
  Object.assign(found, { value: 99 });
  const listed = getIKPropertyKeyframes(snapshot, rig, 'arm', 'x');
  Object.assign(listed[0]!, { value: 99 });
  assert.deepEqual(findIKPropertyKeyframe(snapshot, rig, 'arm', 'x', 0), { time: 0, value: 1 });
});

test('IK validation rejects unsafe root descriptors without reading accessors', () => {
  const input = animation();
  let reads = 0;
  Object.defineProperty(input, 'duration', {
    enumerable: true,
    get: () => {
      ++reads;
      return 10000;
    },
  });
  assert.throws(() => findIKPropertyKeyframe(input, rig, 'arm', 'x', 0), /accessor/i);
  assert.equal(reads, 0);
});
