import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  findAdjacentBonePropertyKeyframe,
  findBonePropertyKeyframe,
  getEvaluatedBonePropertyValue,
  getEvaluatedBoneTransform,
  getKeyedPropertiesAtTime,
  hasKeyframeAtTime,
  KEYFRAME_TIME_TOLERANCE_MS,
  keyframeTimesMatch,
  removeBonePropertyKeyframe,
  removeBonePropertyKeyframes,
  setBonePropertyKeyframe,
} from '../src/devtools/animation-editor/keyframes.js';
import { freezeData } from '../src/devtools/shared/editorData.js';
import * as animationClip from '../src/engine/AnimationClip.js';
import { type AnimationClip, compileClip } from '../src/engine/AnimationClip.js';
import { ClipPoseBuffer, evaluateClip } from '../src/engine/AnimationPose.js';
import { validateAnimationDefinition } from '../src/engine/externalData.js';
import { Rig } from '../src/engine/Rig.js';
import { type TransformProperty, transformProperties } from '../src/engine/types.js';

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'root', x: 4, scaleY: 2 },
    { id: 'child', parent: 'root', y: 12 },
  ],
});
const clip = (patch: Partial<AnimationClip> = {}): AnimationClip & { version: 1 } => ({
  version: 1,
  name: 'move',
  duration: 2000,
  loop: false,
  tracks: {},
  events: [{ time: 0, name: 'start', data: { nested: [1, 2] } }],
  ...patch,
});

test('batch removal resolves original identities once and preserves sparse siblings and shared branches', () => {
  const near = 500 + KEYFRAME_TIME_TOLERANCE_MS / 2;
  const input = freezeData(
    clip({
      tracks: {
        root: [
          { time: 0, x: 1 },
          { time: 500, x: 2, y: 3 },
          { time: near, x: 4 },
        ],
        child: [{ time: 0, rotation: 1 }],
      },
    }),
  );
  const next = removeBonePropertyKeyframes(input, rig, [
    { boneId: 'root', property: 'x', timeMs: 500 },
    { boneId: 'root', property: 'x', timeMs: 500 },
    { boneId: 'root', property: 'x', timeMs: 0 },
  ]);
  assert.deepEqual(next.tracks.root, [
    { time: 500, y: 3 },
    { time: near, x: 4 },
  ]);
  assert.strictEqual(next.tracks.root![1], input.tracks.root![2]);
  assert.strictEqual(next.tracks.child, input.tracks.child);
  assert.strictEqual(next.events, input.events);
  assert.equal(input.tracks.root!.length, 3);
  assert.deepEqual(validateAnimationDefinition(next, rig), []);
  assert.strictEqual(removeBonePropertyKeyframes(next, rig, []), next);
  assert.strictEqual(removeBonePropertyKeyframes(next, rig, [{ boneId: 'child', property: 'x', timeMs: 0 }]), next);
});

test('batch removal rejects invalid targets atomically and never freezes mutable caller data', () => {
  const input = clip({ tracks: { root: [{ time: 0, x: 1, y: 2 }], child: [{ time: 0, x: 3 }] } });
  const before = structuredClone(input);
  assert.throws(
    () =>
      removeBonePropertyKeyframes(input, rig, [
        { boneId: 'root', property: 'x', timeMs: 0 },
        { boneId: 'missing', property: 'x', timeMs: 0 },
      ]),
    /Unknown bone/,
  );
  assert.deepEqual(input, before);
  const next = removeBonePropertyKeyframes(input, rig, [
    { boneId: 'root', property: 'x', timeMs: 0 },
    { boneId: 'root', property: 'y', timeMs: 0 },
    { boneId: 'child', property: 'x', timeMs: 0 },
  ]);
  assert.deepEqual(next.tracks, {});
  assert.deepEqual(input, before);
  assert.isFalse(Object.isFrozen(input.tracks.root));
});

test('frozen property indexes avoid rescanning dense tracks and preserve sparse, duplicate, and unsorted matches', () => {
  const rows = Object.freeze(
    Array.from({ length: 4000 }, (_, index) =>
      Object.freeze({ time: 4000 - index, x: index, ...(index % 2 ? { y: index } : {}) }),
    ),
  );
  let reads = 0;
  const tracked = new Proxy(rows, {
    get(target, property, receiver): unknown {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const animation = Object.freeze({
    ...clip({ duration: 4000 }),
    events: Object.freeze([]),
    tracks: Object.freeze({ root: tracked }),
  });
  assert.deepEqual(findBonePropertyKeyframe(animation, 'root', 'x', 2), { time: 2, value: 3998 });
  reads = 0;
  for (const time of [4000, 1, 1000, 2500, 2, 2000]) {
    assert.deepEqual(findBonePropertyKeyframe(animation, 'root', 'x', time), { time, value: 4000 - time });
    assert.equal(hasKeyframeAtTime(animation, 'root', 'y', time), (4000 - time) % 2 === 1);
    assert.isUndefined(findBonePropertyKeyframe(animation, 'root', 'rotation', time));
  }
  assert.equal(reads, 0);
  for (const time of [1, 1000, 2500, 3999]) {
    assert.equal(
      findAdjacentBonePropertyKeyframe(animation, 'root', 'x', time, -1)?.time,
      time > 1 ? time - 1 : undefined,
    );
    assert.equal(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', time, 1)?.time, time + 1);
  }
  assert.equal(reads, 0, 'adjacent queries share the property index instead of visiting authored rows');
  const close = freezeData(
    clip({
      tracks: {
        root: [
          { time: 0.0000015, x: 2 },
          { time: 0, x: 1 },
          { time: 0, x: 3 },
        ],
      },
    }),
  );
  assert.deepEqual(findBonePropertyKeyframe(close, 'root', 'x', 0.00000075), { time: 0.0000015, value: 2 });
  assert.deepEqual(findBonePropertyKeyframe(close, 'root', 'x', 0.0000001), { time: 0, value: 1 });
  assert.deepEqual(findBonePropertyKeyframe(close, 'root', 'x', -KEYFRAME_TIME_TOLERANCE_MS), { time: 0, value: 1 });
});

test.each([false, true])(
  'adjacent property navigation skips close times and keeps mutable inputs fresh, frozen=%s',
  (frozen) => {
    const source = clip({
      tracks: {
        root: [
          { time: 0, x: 1 },
          { time: 1, x: 2 },
          { time: 1 + KEYFRAME_TIME_TOLERANCE_MS / 2, x: 3 },
          { time: 2, y: 4 },
          { time: 3, x: 5 },
        ],
      },
    });
    const animation = frozen ? freezeData(source) : source;
    assert.deepEqual(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', 1, -1), { time: 0, value: 1 });
    assert.deepEqual(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', 1, 1), { time: 3, value: 5 });
    assert.isUndefined(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', 0, -1));
    assert.isUndefined(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', 3, 1));
    assert.isUndefined(findAdjacentBonePropertyKeyframe(animation, 'root', 'rotation', 1, 1));
    if (!frozen) {
      source.tracks.root![4]!.time = 4;
      assert.equal(findAdjacentBonePropertyKeyframe(animation, 'root', 'x', 1, 1)?.time, 4);
    }
  },
);

test('mutable, shallow frozen, and accessor inputs keep keyframe queries fresh', () => {
  for (const shallow of [false, true]) {
    const animation = clip({ tracks: { root: [{ time: 0, x: 1 }] } });
    if (shallow) Object.freeze(animation);
    assert.deepEqual(findBonePropertyKeyframe(animation, 'root', 'x', 0), { time: 0, value: 1 });
    animation.tracks.root![0]!.time = 2;
    animation.tracks.root![0]!.x = 3;
    assert.isUndefined(findBonePropertyKeyframe(animation, 'root', 'x', 0));
    assert.deepEqual(findBonePropertyKeyframe(animation, 'root', 'x', 2), { time: 2, value: 3 });
  }
  let time = 0;
  const row = Object.freeze({
    get time() {
      return time;
    },
    x: 1,
  });
  const animation = Object.freeze({ ...clip({ events: [] }), tracks: Object.freeze({ root: Object.freeze([row]) }) });
  assert.isTrue(hasKeyframeAtTime(animation, 'root', 'x', 0));
  time = 2;
  assert.isFalse(hasKeyframeAtTime(animation, 'root', 'x', 0));
  assert.isTrue(hasKeyframeAtTime(animation, 'root', 'x', 2));
  const snapshot = freezeData(clip({ tracks: { root: [{ time: 0, x: 1 }] } }));
  const edited = freezeData(setBonePropertyKeyframe(snapshot, rig, 'root', 'x', 0, 4));
  assert.deepEqual(findBonePropertyKeyframe(snapshot, 'root', 'x', 0), { time: 0, value: 1 });
  assert.deepEqual(findBonePropertyKeyframe(edited, 'root', 'x', 0), { time: 0, value: 4 });
});

test.each(transformProperties)(
  'create/update/delete %s preserves the external format and caller/source ownership',
  (property) => {
    const source = freezeData(clip());
    const original = JSON.stringify(source);
    const working = structuredClone(source);
    const created = setBonePropertyKeyframe(working, rig, 'root', property, 500, 3);
    assert.deepEqual(created.tracks, { root: [{ time: 500, [property]: 3 }] });
    assert.deepEqual(validateAnimationDefinition(created, rig), []);
    assert.equal(JSON.stringify(working), original);
    assert.isFalse(Object.isFrozen(working.events![0]!.data));
    const updated = setBonePropertyKeyframe(created, rig, 'root', property, 500.0000001, 7);
    assert.deepEqual(updated.tracks, { root: [{ time: 500, [property]: 7 }] });
    assert.deepEqual(created.tracks, { root: [{ time: 500, [property]: 3 }] });
    const deleted = removeBonePropertyKeyframe(updated, rig, 'root', property, 500.0000001);
    assert.deepEqual(deleted.tracks, {});
    assert.deepEqual(validateAnimationDefinition(deleted, rig), []);
    assert.deepEqual(updated.tracks, { root: [{ time: 500, [property]: 7 }] });
    assert.equal(JSON.stringify(source), original);
    assert.equal(deleted.version, 1);
    assert.deepEqual(deleted.events, source.events);
  },
);

test('inserting in random order stays sorted, sparse, isolated, and continuous even for stepped clips', () => {
  const source = clip({ tracks: { child: [{ time: 0, y: 12 }] }, playback: { mode: 'stepped', fps: 10 } });
  let working = source;
  for (const time of [1000, 250, 500, 742.123456])
    working = setBonePropertyKeyframe(working, rig, 'root', 'rotation', time, time / 1000);
  assert.deepEqual(working.tracks.root, [
    { time: 250, rotation: 0.25 },
    { time: 500, rotation: 0.5 },
    { time: 742.123456, rotation: 742.123456 / 1000 },
    { time: 1000, rotation: 1 },
  ]);
  assert.strictEqual(working.tracks.child, source.tracks.child);
  assert.isFalse(Object.isFrozen(source.tracks.child));
  assert.deepEqual(validateAnimationDefinition(working, rig), []);
});

test('merge at a shared row and delete only the requested property, row, or final bone track', () => {
  const source = clip({
    tracks: {
      root: [
        { time: 500, x: 4 },
        { time: 1000, rotation: 1 },
      ],
      child: [{ time: 500, y: 12 }],
    },
  });
  const created = setBonePropertyKeyframe(source, rig, 'root', 'rotation', 500.0000001, 2);
  assert.deepEqual(created.tracks.root, [
    { time: 500, x: 4, rotation: 2 },
    { time: 1000, rotation: 1 },
  ]);
  assert.deepEqual(getKeyedPropertiesAtTime(created, 'root', 500), ['x', 'rotation']);
  const removed = removeBonePropertyKeyframe(created, rig, 'root', 'rotation', 500);
  assert.deepEqual(removed, source);
  const removedRow = removeBonePropertyKeyframe(removed, rig, 'root', 'rotation', 1000);
  assert.deepEqual(removedRow.tracks.root, [{ time: 500, x: 4 }]);
  const removedBone = removeBonePropertyKeyframe(removedRow, rig, 'root', 'x', 500);
  assert.deepEqual(removedBone.tracks, { child: [{ time: 500, y: 12 }] });
  assert.deepEqual(removedBone.events, source.events);
});

test('one centralized tolerance prevents duplicate rows without quantizing distinct times', () => {
  assert.isTrue(keyframeTimesMatch(500, 0.5000000001 * 1000));
  assert.isTrue(keyframeTimesMatch(0, KEYFRAME_TIME_TOLERANCE_MS));
  for (const time of [NaN, Infinity, -Infinity]) assert.isFalse(keyframeTimesMatch(time, time));
  const created = setBonePropertyKeyframe(clip(), rig, 'root', 'rotation', 500, 1);
  const updated = setBonePropertyKeyframe(created, rig, 'root', 'rotation', 0.5000000001 * 1000, 2);
  assert.equal(updated.tracks.root!.length, 1);
  assert.deepEqual(findBonePropertyKeyframe(updated, 'root', 'rotation', 500.0000001), { time: 500, value: 2 });
  assert.isTrue(hasKeyframeAtTime(updated, 'root', 'rotation', 500.0000001));
  assert.isFalse(hasKeyframeAtTime(updated, 'root', 'x', 500));
  assert.isFalse(hasKeyframeAtTime(updated, 'child', 'rotation', 500));
  assert.isFalse(hasKeyframeAtTime(updated, 'root', 'rotation', 500.00001));
  assert.deepEqual(getKeyedPropertiesAtTime(updated, 'root', 500.0000001), ['rotation']);
  assert.deepEqual(getKeyedPropertiesAtTime(updated, 'root', NaN), []);
  const distinct = setBonePropertyKeyframe(updated, rig, 'root', 'rotation', 500.00001, 3);
  assert.equal(distinct.tracks.root!.length, 2);
});

test('existing close rows match nearest property keys consistently, ties favor earlier time', () => {
  const source = clip({
    tracks: {
      root: [
        { time: 0, x: 1 },
        { time: 0.0000015, rotation: 2 },
      ],
    },
  });
  const time = 0.00000075;
  assert.deepEqual(getKeyedPropertiesAtTime(source, 'root', time), ['x', 'rotation']);
  const updated = setBonePropertyKeyframe(source, rig, 'root', 'rotation', time, 3);
  assert.deepEqual(updated.tracks.root, [
    { time: 0, x: 1 },
    { time: 0.0000015, rotation: 3 },
  ]);
  assert.deepEqual(removeBonePropertyKeyframe(updated, rig, 'root', 'rotation', time).tracks.root, [{ time: 0, x: 1 }]);
  const merged = setBonePropertyKeyframe(source, rig, 'root', 'y', time, 4);
  assert.deepEqual(merged.tracks.root, [
    { time: 0, x: 1, y: 4 },
    { time: 0.0000015, rotation: 2 },
  ]);
});

test('no-op set/delete preserve animation identity', () => {
  const source = clip({ tracks: { root: [{ time: 500, rotation: 1 }] } });
  assert.strictEqual(setBonePropertyKeyframe(source, rig, 'root', 'rotation', 500.0000001, 1), source);
  assert.strictEqual(removeBonePropertyKeyframe(source, rig, 'root', 'x', 500), source);
  assert.strictEqual(removeBonePropertyKeyframe(source, rig, 'child', 'rotation', 500), source);
});

test.each([NaN, Infinity, -Infinity, -1, 2001])('invalid authored time %s fails without mutating input', (time) => {
  const source = clip();
  const original = JSON.stringify(source);
  assert.throws(() => setBonePropertyKeyframe(source, rig, 'root', 'x', time, 1));
  assert.throws(() => removeBonePropertyKeyframe(source, rig, 'root', 'x', time));
  assert.equal(JSON.stringify(source), original);
});

test('endpoint floating error clamps within tolerance, otherwise mutation uses the shared validator', () => {
  let working = setBonePropertyKeyframe(clip(), rig, 'root', 'x', -0.0000001, 1);
  working = setBonePropertyKeyframe(working, rig, 'root', 'x', 2000.0000001, 2);
  assert.deepEqual(working.tracks.root, [
    { time: 0, x: 1 },
    { time: 2000, x: 2 },
  ]);
  for (const value of [NaN, Infinity, -Infinity])
    assert.throws(() => setBonePropertyKeyframe(working, rig, 'root', 'x', 500, value));
  for (const bone of ['missing', '', '__proto__']) {
    assert.throws(() => setBonePropertyKeyframe(working, rig, bone, 'x', 500, 1));
    assert.throws(() => removeBonePropertyKeyframe(working, rig, bone, 'x', 500));
  }
  assert.throws(() => setBonePropertyKeyframe(working, rig, 'root', 'opacity' as TransformProperty, 500, 1));
  assert.throws(() => setBonePropertyKeyframe({ ...working, version: 99 }, rig, 'root', 'x', 500, 1));
  for (const invalid of [
    clip({
      tracks: {
        root: [
          { time: 500, x: 1 },
          { time: 0, x: 2 },
        ],
      },
    }),
    clip({
      tracks: {
        root: [
          { time: 0, x: 1 },
          { time: 0, y: 2 },
        ],
      },
    }),
    clip({ tracks: { missing: [{ time: 0, x: 1 }] } }),
    clip({ events: [{ time: 0, name: 'bad', data: () => 1 }] }),
  ]) {
    assert.throws(() => setBonePropertyKeyframe(invalid, rig, 'root', 'x', 500, 1));
    assert.throws(() => removeBonePropertyKeyframe(invalid, rig, 'root', 'x', 500));
  }
});

test('evaluation reuses sparse runtime interpolation, rotation path, holds, and bind fallback', () => {
  const source = clip({
    tracks: {
      root: [
        { time: 250, x: 10, rotation: 3.1 },
        { time: 1000, x: 100, rotation: -3.1 },
      ],
    },
  });
  const original = JSON.stringify(source);
  const compiled = compileClip(source, rig);
  for (const time of [0, 250, 500, 1000, 2000]) {
    for (const property of ['x', 'rotation'] as const)
      assert.equal(
        getEvaluatedBonePropertyValue(source, rig, 'root', property, time),
        evaluateClip(compiled, time).get('root')![property],
      );
    assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'scaleY', time), 2);
    assert.equal(getEvaluatedBonePropertyValue(source, rig, 'child', 'y', time), 12);
  }
  assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'x', 0), 10);
  assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'x', 2000), 100);
  assert.approximately(getEvaluatedBonePropertyValue(source, rig, 'root', 'rotation', 625), Math.PI, 1e-12);
  assert.equal(JSON.stringify(source), original);
});

test('stepped value queries preserve preview endpoint semantics and explicit unsnapped authored times', () => {
  const source = clip({
    duration: 1050,
    loop: true,
    playback: { mode: 'stepped', fps: 10 },
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1050, x: 105 },
      ],
    },
  });
  assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'x', 742.123456), 70);
  assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'x', 1050), 105);
  assert.equal(getEvaluatedBonePropertyValue(source, rig, 'root', 'scaleX', 742.123456), 1);
});

test('state authoring changes only working snapshots, uses history/dirty state, and queries never notify', () => {
  const input = clip();
  const original = JSON.stringify(input);
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  const source = state.sourceAnimation;
  const sourceSnapshot = JSON.stringify(source);
  const baseline = state.workingAnimation;
  const listener = vi.fn();
  state.subscribe(listener);
  assert.isFalse(state.hasKeyframeAtTime('root', 'rotation'));
  assert.isUndefined(state.findBonePropertyKeyframe('root', 'rotation'));
  assert.deepEqual(state.getKeyedPropertiesAtTime('root'), []);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 4);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.equal(listener.mock.calls.length, 0);

  assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'rotation', 1));
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.deepEqual(state.workingAnimation!.tracks.root, [{ time: 500, rotation: 1 }]);
  assert.equal(JSON.stringify(state.sourceAnimation), sourceSnapshot);
  assert.deepEqual(state.findBonePropertyKeyframe('root', 'rotation'), { time: 500, value: 1 });
  assert.isTrue(state.hasKeyframeAtTime('root', 'rotation', 0.5000000001));
  assert.deepEqual(state.getKeyedPropertiesAtTime('root'), ['rotation']);
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'rotation', 2, 0.5000000001));
  assert.equal(state.historyLength, 2);
  assert.isTrue(state.dirty);
  assert.deepEqual(state.workingAnimation!.tracks.root, [{ time: 500, rotation: 2 }]);
  assert.equal(JSON.stringify(state.sourceAnimation), sourceSnapshot);
  state.markSaved();
  assert.isFalse(state.dirty);
  assert.isTrue(state.keyframes.removeBonePropertyKeyframe('root', 'rotation'));
  assert.isTrue(state.dirty);
  assert.deepEqual(state.workingAnimation!.tracks, {});
  assert.equal(JSON.stringify(state.sourceAnimation), sourceSnapshot);
  assert.equal(state.historyLength, 3);
  assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'rotation'), 2);
  state.undo();
  state.undo();
  assert.strictEqual(state.workingAnimation, baseline);
  assert.isTrue(state.redo());
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'rotation'), 1);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(source, input);
});

test('state no-op and invalid edits preserve working data, playback, history, and redo', () => {
  const state = new AnimationEditorState(rig, [clip({ tracks: { root: [{ time: 500, x: 4 }] } })]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  state.playback.play();
  state.keyframes.setBonePropertyKeyframe('root', 'x', 5);
  state.undo();
  const working = state.workingAnimation;
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'x', 4));
  assert.isTrue(state.keyframes.removeBonePropertyKeyframe('root', 'rotation'));
  assert.isTrue(state.canRedo);
  assert.isFalse(state.dirty);
  for (const edit of [
    () => state.keyframes.setBonePropertyKeyframe('missing', 'x', 1),
    () => state.keyframes.setBonePropertyKeyframe('root', 'x', NaN),
    () => state.keyframes.setBonePropertyKeyframe('root', 'x', 1, 3),
    () => state.keyframes.removeBonePropertyKeyframe('root', 'x', Infinity),
  ]) {
    assert.isFalse(edit());
    assert.isNotEmpty(state.validationIssues);
    assert.strictEqual(state.workingAnimation, working);
    assert.isFalse(state.dirty);
    assert.isTrue(state.canRedo);
    assert.isFalse(state.canUndo);
    assert.isTrue(state.playback.isPlaying);
    assert.equal(state.currentTime, 0.5);
  }
  assert.isTrue(state.redo());
  assert.isTrue(state.dirty);
  assert.equal(state.currentTime, 0.5);
  assert.isTrue(state.playback.isPlaying);
  state.playback.advancePlayback(0.25);
  assert.equal(state.currentTime, 0.75);
});

test('keyframe state APIs handle unloaded and unselected sessions', () => {
  for (const state of [new AnimationEditorState(), new AnimationEditorState(rig, [clip()])]) {
    assert.isFalse(state.keyframes.setBonePropertyKeyframe('root', 'x', 1));
    assert.isFalse(state.keyframes.removeBonePropertyKeyframe('root', 'x'));
    assert.isUndefined(state.findBonePropertyKeyframe('root', 'x'));
    assert.isUndefined(state.getEvaluatedBonePropertyValue('root', 'x'));
    assert.isUndefined(state.getEvaluatedBoneTransform('root'));
    assert.isFalse(state.hasKeyframeAtTime('root', 'x'));
    assert.deepEqual(state.getKeyedPropertiesAtTime('root'), []);
    assert.isFalse(state.dirty);
  }
});

test('frozen value queries share compilation and stepped-frame evaluation without exposing cached poses', () => {
  const animation = freezeData(
    clip({
      playback: { mode: 'stepped', fps: 10 },
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 2000, x: 200 },
        ],
      },
    }),
  );
  const compile = vi.spyOn(animationClip, 'compileValidatedClip');
  const evaluate = vi.spyOn(ClipPoseBuffer.prototype, 'evaluate');
  try {
    const transform = getEvaluatedBoneTransform(animation, rig, 'root', 742);
    assert.deepEqual(transform, { x: 70, y: 0, rotation: 0, scaleX: 1, scaleY: 2 });
    for (const property of transformProperties)
      assert.equal(getEvaluatedBonePropertyValue(animation, rig, 'root', property, 749), transform[property]);
    assert.equal(getEvaluatedBonePropertyValue(animation, rig, 'child', 'y', 749), 12);
    transform.x = -100;
    assert.equal(getEvaluatedBoneTransform(animation, rig, 'root', 749).x, 70);
    assert.equal(compile.mock.calls.length, 1);
    assert.equal(evaluate.mock.calls.length, 1);
    assert.deepEqual(compile.mock.calls[0]![0].events, []);
    assert.isFalse(compile.mock.calls[0]![0].loop);

    assert.equal(getEvaluatedBonePropertyValue(animation, rig, 'root', 'x', 850), 80);
    assert.equal(evaluate.mock.calls.length, 2);
    assert.equal(getEvaluatedBonePropertyValue(animation, rig, 'root', 'x', 749), 70);
    assert.equal(evaluate.mock.calls.length, 2, 'returning to a cached stepped frame reuses its detached pose');
    assert.equal(compile.mock.calls.length, 1);
  } finally {
    compile.mockRestore();
    evaluate.mockRestore();
  }
});

test('property indexes reuse shared immutable tracks across metadata and unrelated edits', () => {
  const animation = freezeData(clip({ tracks: { root: [{ time: 0, x: 10, y: 20 }] } }));
  const metadataEdit = freezeData({ ...animation, playback: { mode: 'stepped' as const, fps: 10 } });
  const unrelatedEdit = freezeData({ ...metadataEdit, tracks: { ...animation.tracks, child: [{ time: 0, x: 30 }] } });
  const changedTrack = freezeData({ ...animation, tracks: { root: [{ time: 0, x: 40 }] } });
  const sort = vi.spyOn(Array.prototype, 'sort');
  try {
    assert.equal(findBonePropertyKeyframe(animation, 'root', 'x', 0)!.value, 10);
    const builds = sort.mock.calls.length;
    assert.isAbove(builds, 0);
    assert.equal(findBonePropertyKeyframe(metadataEdit, 'root', 'y', 0)!.value, 20);
    assert.equal(findBonePropertyKeyframe(unrelatedEdit, 'root', 'x', 0)!.value, 10);
    assert.equal(sort.mock.calls.length, builds);
    assert.equal(findBonePropertyKeyframe(changedTrack, 'root', 'x', 0)!.value, 40);
    assert.isAbove(sort.mock.calls.length, builds);
    sort.mockClear();
    assert.equal(findBonePropertyKeyframe(animation, 'root', 'x', 0)!.value, 10);
    assert.equal(sort.mock.calls.length, 0);
  } finally {
    sort.mockRestore();
  }
});

test.each([false, true])('mutable nested data stays fresh with shallow-frozen root=%s', (shallowFreeze) => {
  const animation = clip({ tracks: { root: [{ time: 0, x: 10 }] } });
  if (shallowFreeze) Object.freeze(animation);
  assert.equal(getEvaluatedBonePropertyValue(animation, rig, 'root', 'x', 0), 10);
  animation.tracks.root![0]!.x = 20;
  assert.equal(getEvaluatedBoneTransform(animation, rig, 'root', 0).x, 20);
  (animation.events![0]!.data as { nested: unknown[] }).nested.push(() => 1);
  assert.throws(() => getEvaluatedBonePropertyValue(animation, rig, 'root', 'x', 0), /JSON/);
});

test('cached queries remain independent across rigs, edits, selection, and undo/redo', () => {
  const input = clip({ tracks: { root: [{ time: 0, x: 10 }] } });
  const state = new AnimationEditorState(rig, [input, clip({ name: 'other', tracks: {} })]);
  state.selectAnimation('move');
  const listener = vi.fn();
  state.subscribe(listener);
  const compile = vi.spyOn(animationClip, 'compileValidatedClip');
  try {
    assert.equal(state.getEvaluatedBoneTransform('root')!.x, 10);
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 10);
    assert.equal(compile.mock.calls.length, 1);
    assert.equal(listener.mock.calls.length, 0);
    const otherRig = new Rig({
      root: 'root',
      bones: [
        { id: 'root', scaleY: 3 },
        { id: 'child', parent: 'root' },
      ],
    });
    assert.equal(getEvaluatedBoneTransform(state.workingAnimation!, otherRig, 'root', 0).scaleY, 3);
    assert.equal(state.getEvaluatedBoneTransform('root')!.scaleY, 2);
    assert.equal(compile.mock.calls.length, 2);

    state.keyframes.setBonePropertyKeyframe('root', 'x', 20);
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 20);
    assert.equal(compile.mock.calls.length, 3);
    state.undo();
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 10);
    state.redo();
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 20);
    assert.equal(compile.mock.calls.length, 3);
    state.undo();
    state.selectAnimation('other');
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 4);
    state.selectAnimation(null);
    assert.isUndefined(state.getEvaluatedBoneTransform('root'));
    const compilations = compile.mock.calls.length;
    state.selectAnimation('move');
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 10);
    assert.equal(compile.mock.calls.length, compilations, 'selection reuses the saved snapshot compilation');
    assert.equal(input.tracks.root![0]!.x, 10);
  } finally {
    compile.mockRestore();
  }
});

test('keyframe edits and history retain unchanged frozen tracks, rows, events, and playback settings', () => {
  const input = clip({
    tracks: {
      root: [
        { time: 0, x: 1 },
        { time: 500, x: 3 },
      ],
      child: [{ time: 0, y: 12 }],
    },
    playback: { mode: 'stepped', fps: 10 },
  });
  const inputSnapshot = JSON.stringify(input);
  const state = new AnimationEditorState(rig, [input]);
  state.selectAnimation('move');
  const baseline = state.workingAnimation!;
  assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'rotation', 0.5, 0.5));
  const created = state.workingAnimation!;
  assert.notStrictEqual(created.tracks, baseline.tracks);
  assert.notStrictEqual(created.tracks.root, baseline.tracks.root);
  assert.strictEqual(created.tracks.root![0], baseline.tracks.root![0]);
  assert.notStrictEqual(created.tracks.root![1], baseline.tracks.root![1]);
  assert.strictEqual(created.tracks.child, baseline.tracks.child);
  assert.strictEqual(created.events, baseline.events);
  assert.strictEqual(created.playback, baseline.playback);
  assert.isTrue(Object.isFrozen(created.tracks.root![1]));
  assert.deepEqual(validateAnimationDefinition(created, rig), []);

  state.keyframes.setBonePropertyKeyframe('root', 'rotation', 1, 0.5);
  const updated = state.workingAnimation!;
  assert.strictEqual(updated.tracks.child, baseline.tracks.child);
  assert.strictEqual(updated.tracks.root![0], baseline.tracks.root![0]);
  state.keyframes.removeBonePropertyKeyframe('root', 'rotation', 0.5);
  const removed = state.workingAnimation!;
  assert.deepEqual(removed, baseline);
  assert.strictEqual(removed.tracks.child, baseline.tracks.child);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 3);
  for (const snapshot of [updated, created, baseline]) {
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingAnimation, snapshot);
  }
  for (const snapshot of [created, updated, removed]) {
    assert.isTrue(state.redo());
    assert.strictEqual(state.workingAnimation, snapshot);
    assert.strictEqual(snapshot.tracks.child, baseline.tracks.child);
  }
  assert.equal(JSON.stringify(input), inputSnapshot);
  assert.isFalse(Object.isFrozen(input.tracks.child));
});

test('mode and FPS edits reuse tracks/events, clear prior errors, and undo to the saved snapshot', () => {
  const state = new AnimationEditorState(rig, [clip({ tracks: { root: [{ time: 0, x: 1 }] } })]);
  state.selectAnimation('move');
  const baseline = state.workingAnimation!;
  state.playback.setAuthoredPlaybackMode('stepped');
  const stepped = state.workingAnimation!;
  assert.strictEqual(stepped.tracks, baseline.tracks);
  assert.strictEqual(stepped.events, baseline.events);
  assert.isFalse(state.playback.setAuthoredFPS(NaN));
  assert.isNotEmpty(state.validationIssues);
  assert.isTrue(state.playback.setAuthoredFPS(20));
  const faster = state.workingAnimation!;
  assert.isEmpty(state.validationIssues);
  assert.strictEqual(faster.tracks, baseline.tracks);
  assert.strictEqual(faster.events, baseline.events);
  assert.deepEqual(validateAnimationDefinition(faster, rig), []);
  state.markSaved();
  state.undo();
  assert.strictEqual(state.workingAnimation, stepped);
  assert.isTrue(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, faster);
  assert.isFalse(state.dirty);
});

test('external replacements still validate and own nested caller data independently', () => {
  const state = new AnimationEditorState(rig, [clip()]);
  state.selectAnimation('move');
  const replacement = clip({ tracks: { root: [{ time: 0, x: 10 }] } });
  assert.isTrue(state.replaceWorkingAnimation(replacement));
  const working = state.workingAnimation!;
  assert.notStrictEqual(working.tracks, replacement.tracks);
  assert.notStrictEqual(working.events![0]!.data, replacement.events![0]!.data);
  replacement.tracks.root![0]!.x = 20;
  (replacement.events![0]!.data as { nested: number[] }).nested.push(3);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 10);
  assert.deepEqual(working.events![0]!.data, { nested: [1, 2] });
  assert.isFalse(state.replaceWorkingAnimation({ ...replacement, version: 99 }));
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(Object.isFrozen(replacement.tracks.root));
});
