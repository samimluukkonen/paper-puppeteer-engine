import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getEvaluatedAnimationPose } from '../src/devtools/animation-editor/animationValues.js';
import type { PropertyKeyframeTarget } from '../src/devtools/animation-editor/keyframeEdits.js';
import {
  mirrorCurrentPoseToKeys,
  mirrorSelectedKeyframes,
} from '../src/devtools/animation-editor/keyframeMirroring.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/devtools/animation-editor/keyframeTargets.js';
import {
  createBoneSymmetryMapping,
  inferBoneSymmetryPairs,
  type BoneSymmetryMapping,
} from '../src/devtools/shared/boneSymmetry.js';
import { mirrorPose, type MirrorDirection } from '../src/devtools/shared/poseMirroring.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { validateAnimationDefinition } from '../src/engine/externalData.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { demoRig, walk } from './helpers/demoCharacter.js';

function mappingFor(rig: Rig): BoneSymmetryMapping {
  const result = createBoneSymmetryMapping(rig, { manualPairs: inferBoneSymmetryPairs(rig).pairs });
  assert.isTrue(result.success);
  return result.mapping;
}

function fixture() {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'leftArm', parent: 'root', x: 10, y: 3, rotation: 0.2 },
      { id: 'rightArm', parent: 'root', x: -12, y: 5, rotation: -0.4 },
      { id: 'leftHand', parent: 'leftArm', x: 2, y: 20, rotation: 0.1 },
      { id: 'rightHand', parent: 'rightArm', x: -4, y: 25, rotation: -0.15 },
      { id: 'head', parent: 'root' },
    ],
  });
  const animation: AnimationClip = {
    name: 'wave',
    duration: 1000,
    loop: false,
    interpolation: 'linear',
    tracks: {
      leftArm: [
        { time: 0, rotation: 0.2 },
        { time: 300, rotation: 0.5, x: 14 },
        { time: 700, rotation: 0.8 },
        { time: 1000, rotation: 1 },
      ],
      rightArm: [
        { time: 300, rotation: 0.1, y: 9 },
        { time: 1000, rotation: -0.8 },
      ],
      leftHand: [
        { time: 0, x: 2, y: 20 },
        { time: 300, x: 5 },
        { time: 1000, y: 30, rotation: 0.7 },
      ],
      rightHand: [{ time: 300, rotation: 0.3 }],
      head: [{ time: 0, y: -10 }],
    },
    events: [{ time: 300, name: 'weapon', data: { slot: 'hand', attachment: 'sword', facing: -1 } }],
  };
  const mapping = mappingFor(rig);
  const state = new AnimationEditorState(rig, [animation]);
  state.selectAnimation('wave');
  state.setSymmetryMapping(mapping);
  return { rig, animation, mapping, state };
}

const key = (boneId: string, property: PropertyKeyframeTarget['property'], timeMs: number): PropertyKeyframeTarget => ({
  boneId,
  property,
  timeMs,
});

test('single selected bone commits bind-relative authored rotation, ignores drafts, and never seeks', () => {
  const { rig, animation, state } = fixture();
  state.selectBone('leftArm');
  state.setCurrentTime(0.5);
  state.setTemporaryBoneProperty('rotation', 2.9);
  const before = state.workingAnimation!;
  const source = state.sourceAnimation;
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  const notified = vi.fn();
  state.subscribe(notified);
  assert.isTrue(state.keyframes.mirrorCurrentPoseToKeys('left-to-right', { properties: ['rotation'] }));
  assert.closeTo(state.findBonePropertyKeyframe('rightArm', 'rotation', 0.5)!.value, -0.85, 1e-9);
  assert.deepEqual(state.selectedKeys, [{ boneId: 'rightArm', property: 'rotation', time: 0.5 }]);
  assert.equal(state.selectedBoneId, 'rightArm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.hasTemporaryTransform);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.equal(notified.mock.calls.length, 1);
  assert.strictEqual(state.sourceAnimation, source);
  assert.strictEqual(state.workingAnimation!.tracks.leftArm, before.tracks.leftArm);
  assert.deepEqual(animation.tracks.leftArm, before.tracks.leftArm);
  assert.deepEqual(validateAnimationDefinition(state.workingAnimation, rig), []);
});

test('current-pose sparse defaults key only authored source properties, with explicit rest-property opt-in', () => {
  const { rig, mapping, animation } = fixture();
  const result = mirrorCurrentPoseToKeys(animation, rig, mapping, 500, 'left-to-right', { boneIds: ['leftArm'] });
  assert.deepEqual(
    result.keys.map((entry) => entry.property),
    ['x', 'rotation'],
  );
  assert.deepEqual(Object.keys(result.animation.tracks.rightArm!.find((row) => row.time === 500)!).sort(), [
    'rotation',
    'time',
    'x',
  ]);
  const rest: AnimationClip = { ...animation, tracks: {} };
  assert.strictEqual(mirrorCurrentPoseToKeys(rest, rig, mapping, 500, 'left-to-right').animation, rest);
  const full = mirrorCurrentPoseToKeys(rest, rig, mapping, 500, 'left-to-right', {
    boneIds: ['leftArm'],
    properties: ['scaleX', 'scaleY'],
  });
  assert.equal(full.animation.tracks.rightArm![0]!.time, 500);
  assert.closeTo(full.animation.tracks.rightArm![0]!.scaleX!, 1, 1e-9);
  assert.closeTo(full.animation.tracks.rightArm![0]!.scaleY!, 1, 1e-9);
});

test.each(['left-to-right', 'right-to-left', 'swap'] as const)(
  'selected keys support %s from an unchanged snapshot',
  (direction) => {
    const { rig, mapping, animation } = fixture();
    const sources =
      direction === 'left-to-right'
        ? [key('leftArm', 'rotation', 300)]
        : direction === 'right-to-left'
          ? [key('rightArm', 'rotation', 300)]
          : [key('leftArm', 'rotation', 300), key('rightArm', 'rotation', 300)];
    const result = mirrorSelectedKeyframes(animation, rig, mapping, sources, direction);
    const left = result.animation.tracks.leftArm!.find((row) => row.time === 300)!;
    const right = result.animation.tracks.rightArm!.find((row) => row.time === 300)!;
    if (direction !== 'right-to-left') assert.closeTo(right.rotation!, -0.7, 1e-9);
    if (direction !== 'left-to-right') assert.closeTo(left.rotation!, -0.3, 1e-9);
    assert.equal(left.x, 14);
    assert.equal(right.y, 9);
    assert.equal(animation.tracks.leftArm![1]!.rotation, 0.5);
    assert.equal(animation.tracks.rightArm![0]!.rotation, 0.1);
  },
);

test.each(['left-to-right', 'right-to-left', 'swap'] as const)(
  'current-pose %s preserves source snapshot and duration',
  (direction) => {
    const { rig, mapping, animation } = fixture();
    const original = structuredClone(animation);
    const expected = mirrorPose(getEvaluatedAnimationPose(animation, rig, 500), rig, mapping, direction);
    assert.isTrue(expected.success);
    const result = mirrorCurrentPoseToKeys(animation, rig, mapping, 500, direction, { properties: ['rotation'] });
    for (const ref of result.keys)
      assert.closeTo(
        result.animation.tracks[ref.boneId]!.find((row) => row.time === 500)!.rotation!,
        expected.pose.get(ref.boneId)!.rotation!,
        1e-9,
      );
    assert.equal(result.animation.duration, animation.duration);
    assert.deepEqual(animation, original);
  },
);

test('multi-key mirroring preserves times and clip metadata across bones/properties and uses evaluated context', () => {
  const { rig, mapping, animation } = fixture();
  const sources = [
    key('leftArm', 'rotation', 0),
    key('leftArm', 'rotation', 300),
    key('leftArm', 'rotation', 700),
    key('leftArm', 'rotation', 1000),
    key('leftHand', 'x', 300),
    key('leftHand', 'rotation', 1000),
  ];
  const original = structuredClone(animation);
  const rigBefore = JSON.stringify(rig);
  const result = mirrorSelectedKeyframes(animation, rig, mapping, sources, 'left-to-right');
  assert.deepEqual(
    result.keys.map((entry) => entry.timeMs),
    sources.map((entry) => entry.timeMs),
  );
  assert.deepEqual(
    result.animation.tracks.rightArm!.map((row) => row.time),
    [0, 300, 700, 1000],
  );
  const expected = mirrorPose(evaluateClip(compileClip(animation, rig), 300), rig, mapping, 'left-to-right');
  assert.isTrue(expected.success);
  const hand = result.animation.tracks.rightHand!.find((row) => row.time === 300)!;
  assert.closeTo(hand.x!, expected.pose.get('rightHand')!.x!, 1e-9);
  assert.isUndefined(hand.y, 'evaluated Y contributes to mirror X without authoring Y');
  assert.notEqual(hand.x, -5, 'bind/parent frames and evaluated Y are required');
  assert.equal(result.animation.interpolation, 'linear');
  assert.strictEqual(result.animation.events, animation.events);
  assert.strictEqual(result.animation.tracks.head, animation.tracks.head);
  assert.equal(result.animation.duration, 1000);
  assert.deepEqual(validateAnimationDefinition({ version: 1, ...result.animation }, rig), []);
  assert.deepEqual(animation, original);
  assert.equal(JSON.stringify(rig), rigBefore);
  assert.isFalse(Object.isFrozen(animation));
});

test('all selected transform properties are mirrored without creating unselected tracks', () => {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }, { id: 'rightArm', parent: 'root' }],
  });
  const mapping = mappingFor(rig);
  const animation: AnimationClip = {
    name: 'all',
    duration: 1000,
    loop: false,
    tracks: { leftArm: [{ time: 300, x: 3, y: 7, rotation: 0.4, scaleX: 2, scaleY: 3 }] },
  };
  const selected = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;
  const result = mirrorSelectedKeyframes(
    animation,
    rig,
    mapping,
    selected.map((property) => key('leftArm', property, 300)),
    'left-to-right',
  );
  const row = result.animation.tracks.rightArm![0]!;
  assert.closeTo(row.x!, -3, 1e-9);
  assert.closeTo(row.y!, 7, 1e-9);
  assert.closeTo(row.rotation!, -0.4, 1e-9);
  assert.closeTo(row.scaleX!, 2, 1e-9);
  assert.closeTo(row.scaleY!, 3, 1e-9);
  assert.isFalse(Object.hasOwn(result.animation, 'interpolation'), 'implicit linear remains implicit');
});

test('selected authored times bypass stepped quantization while current pose samples held playback values', () => {
  const { rig, mapping, animation } = fixture();
  const stepped: AnimationClip = {
    ...animation,
    playback: { mode: 'stepped', fps: 10 },
    tracks: {
      leftArm: [
        { time: 0, rotation: 0.2 },
        { time: 350, rotation: 0.9 },
      ],
    },
  };
  const selected = mirrorSelectedKeyframes(stepped, rig, mapping, [key('leftArm', 'rotation', 350)], 'left-to-right');
  assert.closeTo(selected.animation.tracks.rightArm![0]!.rotation!, -1.1, 1e-9);
  assert.equal(selected.animation.tracks.rightArm![0]!.time, 350);
  assert.strictEqual(selected.animation.playback, stepped.playback);
  const current = mirrorCurrentPoseToKeys(stepped, rig, mapping, 350, 'left-to-right');
  assert.closeTo(current.animation.tracks.rightArm![0]!.rotation!, -1, 1e-9);
  assert.equal(current.animation.tracks.rightArm![0]!.time, 350);
  assert.strictEqual(current.animation.playback, stepped.playback);
});

test('collisions replace destination properties with exact source timing and retain nearby siblings and group keys', () => {
  const { rig, mapping, animation } = fixture();
  const step = KEYFRAME_TIME_TOLERANCE_MS / 2;
  const clip: AnimationClip = {
    ...animation,
    tracks: {
      leftArm: [
        { time: 300, rotation: 0.5 },
        { time: 300 + step, rotation: 0.8 },
      ],
      rightArm: [
        { time: 300 - step, rotation: 1, y: 9 },
        { time: 300 + step, rotation: 2, x: 17 },
      ],
    },
  };
  const result = mirrorSelectedKeyframes(
    clip,
    rig,
    mapping,
    [key('leftArm', 'rotation', 300), key('leftArm', 'rotation', 300 + step)],
    'left-to-right',
  );
  assert.deepEqual(
    result.animation.tracks.rightArm!.map((row) => row.time),
    [300 - step, 300, 300 + step],
  );
  assert.deepEqual(result.animation.tracks.rightArm![0], { time: 300 - step, y: 9 });
  assert.equal(result.animation.tracks.rightArm![2]!.x, 17);
  assert.closeTo(result.animation.tracks.rightArm![1]!.rotation!, -0.7, 1e-9);
  assert.closeTo(result.animation.tracks.rightArm![2]!.rotation!, -1, 1e-9);
});

test('one mirror action restores replaced destinations exactly through Undo/Redo and reconciles selection', () => {
  const { state } = fixture();
  state.selectKeyframes([
    { boneId: 'leftArm', property: 'rotation', time: 0.3 },
    { boneId: 'leftHand', property: 'x', time: 0.3 },
    { boneId: 'leftArm', property: 'rotation', time: 0.7 },
  ]);
  state.selectKeyframe({ boneId: 'leftHand', property: 'x', time: 0.3 }, { range: true });
  const selected = state.selectedKeys;
  assert.equal(state.primaryKey!.boneId, 'leftHand');
  state.setCurrentTime(0.55);
  const before = state.workingAnimation!;
  const notify = vi.fn();
  state.subscribe(notify);
  assert.isTrue(state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  const after = state.workingAnimation!;
  assert.equal(state.historyLength, 1);
  assert.equal(notify.mock.calls.length, 1);
  assert.equal(state.currentTime, 0.55);
  assert.equal(state.selectedKeys.length, selected.length);
  assert.equal(state.primaryKey!.boneId, 'rightHand');
  assert.equal(state.selectedBoneId, 'rightHand');
  assert.equal(state.selectedTimelineProperty, 'x');
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  assert.isTrue(state.selectedKeys.every((ref) => state.hasKeyframeAtTime(ref.boneId, ref.property, ref.time)));
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, after);
  assert.isTrue(state.dirty);
  assert.equal(state.currentTime, 0.55);
  state.markSaved();
  assert.isTrue(state.keyframes.mirrorSelectedKeyframes('right-to-left'));
  state.undo();
  assert.isFalse(state.dirty, 'history returns to the saved mirror checkpoint');
});

test.each(['missing-bone', 'missing-key', 'wrong-side', 'unpaired', 'unsupported-scale', 'invalid-transform'] as const)(
  'invalid %s rejects the whole selected-key operation',
  (kind) => {
    const { rig, mapping, animation } = fixture();
    const clip: AnimationClip =
      kind === 'unsupported-scale'
        ? { ...animation, tracks: { ...animation.tracks, leftHand: [{ time: 300, x: 5, scaleX: 0 }] } }
        : kind === 'invalid-transform'
          ? { ...animation, tracks: { ...animation.tracks, leftHand: [{ time: 300, x: NaN }] } }
          : animation;
    const invalid =
      kind === 'missing-bone'
        ? key('missing', 'rotation', 300)
        : kind === 'missing-key'
          ? key('leftHand', 'rotation', 300)
          : kind === 'wrong-side'
            ? key('rightArm', 'rotation', 300)
            : kind === 'unpaired'
              ? key('head', 'y', 0)
              : key('leftHand', 'x', 300);
    const original = structuredClone(clip);
    assert.throws(() =>
      mirrorSelectedKeyframes(clip, rig, mapping, [key('leftArm', 'rotation', 300), invalid], 'left-to-right'),
    );
    assert.deepEqual(clip, original);
  },
);

test('failed commands retain drafts, gestures, playback, selection, history and dirty state while reporting errors', () => {
  const { state } = fixture();
  state.selectBone('leftArm');
  state.setCurrentTime(0.5);
  state.setTemporaryBoneProperty('rotation', 1.5);
  const before = state.workingAnimation;
  const notify = vi.fn();
  state.subscribe(notify);
  assert.isFalse(state.keyframes.mirrorCurrentPoseToKeys('right-to-left'));
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.boneTransformDraft.rotation, 1.5);
  assert.equal(state.selectedBoneId, 'leftArm');
  assert.equal(state.currentTime, 0.5);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.include(state.validationIssues[0]!.message, 'source side');
  assert.equal(notify.mock.calls.length, 1);
  state.keyframes.beginKeyframeDrag({ boneId: 'rightArm', property: 'rotation', time: 0.3 });
  state.keyframes.previewKeyframeDrag(0.6);
  const drag = state.keyframes.keyframeDrag;
  const keys = state.selectedKeys;
  assert.isFalse(state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  assert.strictEqual(state.keyframes.keyframeDrag, drag);
  assert.strictEqual(state.selectedKeys, keys);
  assert.equal(state.currentTime, 0.6);
  state.keyframes.cancelKeyframeDrag();
  state.selectBone('leftArm');
  state.playback.play();
  assert.isFalse(state.keyframes.mirrorCurrentPoseToKeys('right-to-left'));
  assert.isTrue(state.playback.isPlaying);
});

test('invalid mapping, direction, target property and current time fail atomically', () => {
  const { rig, animation, mapping } = fixture();
  const invalidMappings: BoneSymmetryMapping[] = [
    { ...mapping, rig: fixture().rig },
    { ...mapping, getMirroredBoneId: () => null },
    { ...mapping, pairs: [{ leftBoneId: 'leftArm', rightBoneId: 'missing' }] },
    {
      ...mapping,
      pairs: [{ leftBoneId: 'leftArm', rightBoneId: 'rightHand' }],
      getMirroredBoneId: (id) => (id === 'leftArm' ? 'rightHand' : id === 'rightHand' ? 'leftArm' : null),
    },
  ];
  for (const invalid of invalidMappings)
    assert.throws(() =>
      mirrorSelectedKeyframes(animation, rig, invalid, [key('leftArm', 'rotation', 300)], 'left-to-right'),
    );
  assert.throws(() => mirrorCurrentPoseToKeys(animation, rig, mapping, 500, 'invalid' as MirrorDirection), /Choose/);
  for (const time of [NaN, Infinity, -1, 1001])
    assert.throws(() => mirrorCurrentPoseToKeys(animation, rig, mapping, time, 'left-to-right'));
  assert.throws(
    () => mirrorCurrentPoseToKeys(animation, rig, mapping, 500, 'left-to-right', { properties: ['invalid' as 'x'] }),
    /Unknown transform property/,
  );
});

test('scoped mirroring excludes unsupported unrelated source transforms and empty selection creates no transaction', () => {
  const { rig, mapping, animation, state } = fixture();
  const clip = { ...animation, tracks: { ...animation.tracks, leftHand: [{ time: 300, scaleX: 0 }] } };
  assert.doesNotThrow(() =>
    mirrorSelectedKeyframes(clip, rig, mapping, [key('leftArm', 'rotation', 300)], 'left-to-right'),
  );
  assert.strictEqual(mirrorSelectedKeyframes(animation, rig, mapping, [], 'swap').animation, animation);
  assert.isFalse(state.keyframes.mirrorSelectedKeyframes('swap'));
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
});

test('shipped mirrored keys use pre-IK authored values and leave events, attachments, skins and IK targets unchanged', () => {
  const state = new AnimationEditorState(demoRig, [walk]);
  state.selectAnimation(walk.name);
  state.setSymmetryMapping(mappingFor(demoRig));
  state.selectBone('leftUpperArm');
  state.setCurrentTime(0.25);
  const original = state.workingAnimation!;
  const pose = getEvaluatedAnimationPose(original, demoRig, 250);
  const joints = new Map(demoRig.bones.map((bone) => [bone.id, new Joint(bone.id, { ...bone, ...pose.get(bone.id) })]));
  const constraint = new TwoBoneIKConstraint(
    { name: 'leftArm', rootBone: 'leftUpperArm', middleBone: 'leftForearm', endBone: 'leftHand', bendDirection: 1 },
    demoRig,
    joints,
  );
  constraint.setTarget(0, 0);
  const target = constraint.target;
  const rigBefore = JSON.stringify(demoRig);
  const expected = mirrorPose(pose, demoRig, mappingFor(demoRig), 'left-to-right', { sourceBoneIds: ['leftUpperArm'] });
  assert.isTrue(expected.success);
  constraint.apply({ worldToParent: (_id, point) => point });
  assert.notEqual(joints.get('leftUpperArm')!.pose.rotation, pose.get('leftUpperArm')!.rotation);
  assert.isTrue(state.keyframes.mirrorCurrentPoseToKeys('left-to-right', { properties: ['rotation'] }));
  assert.closeTo(
    state.findBonePropertyKeyframe('rightUpperArm', 'rotation')!.value,
    expected.pose.get('rightUpperArm')!.rotation!,
    1e-9,
  );
  assert.strictEqual(state.workingAnimation!.events, original.events);
  assert.deepEqual(constraint.target, target);
  assert.equal(JSON.stringify(demoRig), rigBefore);
  assert.strictEqual(state.workingAnimation!.tracks.leftUpperArm, original.tracks.leftUpperArm);
});

test('twelve selected keys form one transaction and restore every replaced destination on Undo/Redo', () => {
  const { rig, mapping, animation } = fixture();
  const times = Array.from({ length: 12 }, (_, index) => index * 80);
  const clip: AnimationClip = {
    ...animation,
    tracks: {
      leftArm: times.map((time, index) => ({ time, rotation: 0.2 + index / 20 })),
      rightArm: times.map((time) => ({ time, rotation: 0.3, y: 19 })),
    },
  };
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation(clip.name);
  state.setSymmetryMapping(mapping);
  state.selectKeyframes(times.map((time) => ({ boneId: 'leftArm', property: 'rotation', time: time / 1000 })));
  state.setCurrentTime(0.99);
  const before = state.workingAnimation;
  assert.isTrue(state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  const after = state.workingAnimation;
  assert.equal(state.historyLength, 1);
  assert.equal(state.selectedKeys.length, 12);
  assert.equal(state.currentTime, 0.99);
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  assert.equal(state.selectedKeys.length, 12, 'replaced destination identities survive history reconciliation');
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, after);
});

test('later-time mirror math failure leaves an earlier valid key uncommitted and history unchanged', () => {
  const { rig, mapping, animation } = fixture();
  const clip: AnimationClip = {
    ...animation,
    tracks: {
      leftArm: [
        { time: 0, rotation: 0.2, scaleX: 1 },
        { time: 1000, rotation: 0.7, scaleX: 0 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation(clip.name);
  state.setSymmetryMapping(mapping);
  state.selectKeyframes([
    { boneId: 'leftArm', property: 'rotation', time: 0 },
    { boneId: 'leftArm', property: 'rotation', time: 1 },
  ]);
  const before = state.workingAnimation;
  const selected = state.selectedKeys;
  assert.isFalse(state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  assert.strictEqual(state.workingAnimation, before);
  assert.strictEqual(state.selectedKeys, selected);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.include(state.validationIssues[0]!.message, 'Zero scales');
});

test('swap command is one undoable snapshot and successful gesture cancellation retains the held time', () => {
  const { state } = fixture();
  state.selectKeyframes([
    { boneId: 'leftArm', property: 'rotation', time: 0.3 },
    { boneId: 'rightArm', property: 'rotation', time: 0.3 },
  ]);
  state.keyframes.beginKeyframeDrag(state.primaryKey!);
  state.keyframes.previewKeyframeDrag(0.6);
  const before = state.workingAnimation;
  const notified = vi.fn();
  state.subscribe(notified);
  assert.isTrue(state.keyframes.mirrorSelectedKeyframes('swap'));
  assert.equal(state.currentTime, 0.6);
  assert.isNull(state.keyframes.keyframeDrag);
  assert.equal(state.historyLength, 1);
  assert.equal(notified.mock.calls.length, 1);
  assert.closeTo(state.findBonePropertyKeyframe('leftArm', 'rotation', 0.3)!.value, -0.3, 1e-9);
  assert.closeTo(state.findBonePropertyKeyframe('rightArm', 'rotation', 0.3)!.value, -0.7, 1e-9);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
});

test('scoped pure pose mirroring rejects invalid sources and never changes unrequested destinations', () => {
  const { rig, mapping, animation } = fixture();
  const pose = getEvaluatedAnimationPose(animation, rig, 300);
  const result = mirrorPose(pose, rig, mapping, 'left-to-right', { sourceBoneIds: ['leftArm'] });
  assert.isTrue(result.success);
  assert.deepEqual(result.pose.get('rightHand'), pose.get('rightHand'));
  for (const source of ['rightArm', 'head', 'missing']) {
    const invalid = mirrorPose(pose, rig, mapping, 'left-to-right', { sourceBoneIds: [source] });
    assert.isFalse(invalid.success);
    assert.isNull(invalid.pose);
    assert.equal(invalid.issues[0]!.code, 'invalid-source');
  }
  assert.deepEqual(mirrorPose(pose, rig, mapping, 'swap', { sourceBoneIds: [] }).pose, pose);
});
