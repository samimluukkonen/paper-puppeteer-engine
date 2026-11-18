import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { retimeSelectedKeys, type RetimeKeySelection } from '../src/devtools/animation-editor/keyframeRetiming.js';
import { KeyframeRetimingController } from '../src/devtools/animation-editor/KeyframeRetimingController.js';
import type { KeyframeSelection } from '../src/devtools/animation-editor/timelineTracks.js';
import { compileClip, type AnimationClip } from '../src/engine/AnimationClip.js';
import { parseAnimationClip } from '../src/engine/externalData.js';
import { KEYFRAME_TIME_TOLERANCE_MS } from '../src/engine/keyframeAuthoring.js';
import { Rig } from '../src/engine/Rig.js';
import { transformProperties } from '../src/engine/types.js';

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }, { id: 'hand', parent: 'arm' }],
  ik: [{ name: 'reach', rootBone: 'root', middleBone: 'arm', endBone: 'hand' }],
});
const key = (time: number, property: KeyframeSelection['property'] = 'x', boneId = 'root'): KeyframeSelection => ({
  boneId,
  property,
  time,
});
const group = [key(0.2), key(0.5), key(0.8), key(0.35, 'rotation', 'arm'), key(0.5, 'y')];
function clip(): AnimationClip {
  return {
    name: 'retime',
    duration: 2000,
    loop: false,
    interpolation: 'linear',
    playback: { mode: 'stepped', fps: 24 },
    tracks: {
      root: [
        { time: 200, x: 1, y: 8 },
        { time: 500, x: 2, y: 9 },
        { time: 800, x: 3 },
        { time: 1100, x: 99, y: 10 },
      ],
      arm: [{ time: 350, rotation: 0.7, scaleY: -1 }],
      hand: [{ time: 0, scaleX: 1.3 }],
    },
    ikTracks: {
      reach: [
        { time: 200, x: 50, y: 60, mix: 0.3 },
        { time: 800, x: 70, y: 90, mix: 0.8 },
      ],
    },
    events: [{ time: 500, name: 'cue', data: { nested: [1, 2] } }],
  };
}
function session() {
  const input = clip();
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'other' }]);
  state.selectAnimation('retime');
  state.selectKeyframes(group);
  return { input, state };
}

test.each(transformProperties)('retiming preserves authored %s values without pose sampling', (property) => {
  const input = clip();
  input.tracks = {
    root: [
      { time: 200, [property]: -0.3 },
      { time: 800, [property]: 1.7 },
    ],
  };
  const result = retimeSelectedKeys(input, rig, [key(0.2, property), key(0.8, property)], {
    scale: 0.5,
    anchor: 'earliest',
  });
  assert.deepEqual(result.animation.tracks.root, [
    { time: 200, [property]: -0.3 },
    { time: 500, [property]: 1.7 },
  ]);
});

test.each([0.5, 0.75, 1.25, 1.5, 2])('scale %s preserves values and proportional times across bone tracks', (scale) => {
  const input = clip();
  const before = JSON.stringify(input);
  const result = retimeSelectedKeys(input, rig, group, { scale, anchor: 'earliest' });
  assert.equal(result.anchorTimeMs, 200);
  for (const [index, change] of result.changes.entries()) {
    const after = change.after as KeyframeSelection;
    const row = result.animation.tracks[after.boneId]!.find((row) => row.time === change.afterTimeMs)!;
    assert.equal(row[after.property], [1, 2, 3, 0.7, 9][index]);
    assert.equal(change.afterTimeMs, 200 + (change.beforeTimeMs - 200) * scale);
  }
  assert.equal(result.animation.duration, input.duration);
  assert.strictEqual(result.animation.playback, input.playback);
  assert.equal(result.animation.interpolation, input.interpolation);
  assert.strictEqual(result.animation.events, input.events);
  assert.strictEqual(result.animation.ikTracks, input.ikTracks);
  assert.strictEqual(result.animation.tracks.hand, input.tracks.hand);
  assert.equal(result.animation.tracks.root!.find((row) => row.time === 200)?.y, 8);
  assert.equal(result.animation.tracks.arm!.find((row) => row.time === 350)?.scaleY, -1);
  assert.equal(JSON.stringify(input), before);
  assert.isFalse(Object.isFrozen(input));
  assert.isFalse(Object.isFrozen(input.tracks.root));
});

test('playhead anchor scales both earlier and later keys without individual frame snaps', () => {
  const result = retimeSelectedKeys(clip(), rig, group, { scale: 0.5, anchor: 'playhead', playheadTimeMs: 500 });
  assert.equal(result.anchorTimeMs, 500);
  assert.deepEqual(
    result.changes.map((change) => change.afterTimeMs),
    [350, 500, 650, 425, 500],
  );
});

test('bone and typed IK x/y/mix groups retime together, retaining sparse siblings and metadata', () => {
  const input = clip();
  const selected: RetimeKeySelection[] = [
    ...group,
    { kind: 'ik', constraintId: 'reach', property: 'x', time: 0.2 },
    { kind: 'ik', constraintId: 'reach', property: 'x', time: 0.8 },
    { kind: 'ik', constraintId: 'reach', property: 'y', time: 0.8 },
    { kind: 'ik', constraintId: 'reach', property: 'mix', time: 0.8 },
  ];
  const result = retimeSelectedKeys(input, rig, selected, { scale: 0.5, anchor: 'earliest' });
  assert.deepEqual(result.animation.ikTracks!.reach, [
    { time: 200, y: 60, mix: 0.3, x: 50 },
    { time: 500, x: 70, y: 90, mix: 0.8 },
  ]);
  assert.equal(result.keys.length, selected.length);
  assert.strictEqual(result.animation.events, input.events);
  assert.isFalse(Object.isFrozen(input.ikTracks!.reach));
});

test('source positions are removed together; tolerant external collisions replace only matching channels', () => {
  const epsilon = KEYFRAME_TIME_TOLERANCE_MS / 2;
  const input = clip();
  input.tracks = { ...input.tracks, root: [...input.tracks.root!, { time: 1400 + epsilon, x: 88, rotation: 0.9 }] };
  const result = retimeSelectedKeys(input, rig, group.slice(0, 3), { scale: 2, anchor: 'earliest' });
  assert.deepEqual(
    result.changes.map((change) => change.afterTimeMs),
    [200, 800, 1400],
  );
  assert.equal(
    result.animation.tracks.root!.find((row) => row.time === 800)?.x,
    2,
    'selected source is not a collision',
  );
  assert.equal(result.animation.tracks.root!.find((row) => row.time === 1400)?.x, 3);
  assert.deepEqual(
    result.animation.tracks.root!.find((row) => row.time === 1400 + epsilon),
    { time: 1400 + epsilon, rotation: 0.9 },
  );
  assert.equal(result.replacedKeys, 1);
});

test('IK external collision follows the same atomic property replacement policy', () => {
  const input = clip();
  const result = retimeSelectedKeys(input, rig, [{ kind: 'ik', constraintId: 'reach', property: 'mix', time: 0.2 }], {
    scale: 4,
    anchor: 'playhead',
    playheadTimeMs: 0,
  });
  assert.deepEqual(result.animation.ikTracks!.reach, [
    { time: 200, x: 50, y: 60 },
    { time: 800, x: 70, y: 90, mix: 0.3 },
  ]);
  assert.equal(result.replacedKeys, 1);
  assert.strictEqual(result.animation.tracks, input.tracks);
});

test('nearby selected keys stay distinct even inside lookup tolerance', () => {
  const input = clip();
  input.tracks = {
    root: [
      { time: 500, x: 1 },
      { time: 500 + 1e-7, x: 2 },
    ],
  };
  const result = retimeSelectedKeys(input, rig, [key(0.5), key((500 + 1e-7) / 1000)], {
    scale: 0.5,
    anchor: 'earliest',
  });
  assert.equal(result.animation.tracks.root!.length, 2);
  assert.deepEqual(
    result.animation.tracks.root!.map((row) => row.x),
    [1, 2],
  );
});

test('fractional authored milliseconds survive source resolution without a lossy unit roundtrip', () => {
  const input = clip();
  const time = 1000.123456789;
  input.tracks = {
    root: [
      { time, x: 1 },
      { time: 1700.123456789, x: 2 },
    ],
  };
  const result = retimeSelectedKeys(input, rig, [key(time / 1000), key(1700.123456789 / 1000)], {
    scale: 0.5,
    anchor: 'earliest',
  });
  assert.equal(result.changes[0]!.beforeTimeMs, time);
  assert.equal(result.animation.tracks.root![0]!.time, time);
  assert.deepEqual(
    result.animation.tracks.root!.map((row) => row.x),
    [1, 2],
  );
});

test.each([0, -1, NaN, Infinity, -Infinity])('invalid scale %s changes no source, history or selection', (scale) => {
  const { input, state } = session();
  const before = state.workingAnimation;
  const selection = state.selectedKeys;
  const original = JSON.stringify(input);
  assert.throws(() => state.previewKeyframeRetiming({ scale, anchor: 'earliest' }));
  assert.isFalse(state.retimeSelectedKeyframes({ scale, anchor: 'earliest' }));
  assert.strictEqual(state.workingAnimation, before);
  assert.strictEqual(state.selectedKeys, selection);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.equal(JSON.stringify(input), original);
});

test.each([
  { scale: 4, anchor: 'earliest' as const },
  { scale: 2, anchor: 'playhead' as const, playheadTimeMs: 500 },
])('bounds failure is atomic even when earlier proposed keys hit external collisions: %j', (options) => {
  const input = clip();
  const before = JSON.stringify(input);
  assert.throws(() => retimeSelectedKeys(input, rig, group, options), /outside the animation duration/);
  assert.equal(JSON.stringify(input), before);
});

test('floating point duplicate destinations reject all bone and IK edits atomically', () => {
  const input = clip();
  input.duration = 1e20;
  input.tracks = {
    root: [
      { time: 1, x: 1 },
      { time: 2, x: 2 },
    ],
  };
  const before = JSON.stringify(input);
  assert.throws(
    () =>
      retimeSelectedKeys(
        input,
        rig,
        [key(0.001), key(0.002), { kind: 'ik', constraintId: 'reach', property: 'x', time: 0.2 }],
        { scale: 0.5, anchor: 'playhead', playheadTimeMs: 1e20 },
      ),
    /preserve distinct keys/,
  );
  assert.equal(JSON.stringify(input), before);
});

test('zero span, scale one, empty selection and repeated references avoid redundant snapshots', () => {
  const { state } = session();
  state.selectKeyframes([key(0.5), key(0.5, 'y')]);
  const before = state.workingAnimation;
  assert.isFalse(state.retimeSelectedKeyframes({ scale: 2, anchor: 'earliest' }));
  assert.isFalse(state.retimeSelectedKeyframes({ scale: 1, anchor: 'playhead' }));
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.equal(
    retimeSelectedKeys(clip(), rig, [group[0]!, group[0]!], { scale: 0.5, anchor: 'earliest' }).keys.length,
    1,
  );
  const input = clip();
  assert.strictEqual(retimeSelectedKeys(input, rig, [], { scale: 0.5, anchor: 'earliest' }).animation, input);
});

test.each(['missing', 'bone', 'property', 'ik', 'anchor', 'playhead'])(
  'invalid %s reference/options fails before applying any edit',
  (invalid) => {
    const input = clip();
    const refs: RetimeKeySelection[] = [...group];
    if (invalid === 'missing') refs.push(key(0.7));
    if (invalid === 'bone') refs.push(key(0.5, 'x', 'missing'));
    if (invalid === 'property') refs.push({ ...key(0.5), property: 'mix' } as unknown as KeyframeSelection);
    if (invalid === 'ik') refs.push({ kind: 'ik', constraintId: 'missing', property: 'x', time: 0.2 });
    const before = JSON.stringify(input);
    const anchor = invalid === 'anchor' ? ('invalid' as 'earliest') : invalid === 'playhead' ? 'playhead' : 'earliest';
    assert.throws(() => retimeSelectedKeys(input, rig, refs, { scale: 0.5, anchor }));
    assert.equal(JSON.stringify(input), before);
  },
);

test('commit keeps primary and new keys selected, synchronizes preview once and restores exact history/export', () => {
  const { input, state } = session();
  state.beginKeyframeDrag(group[3]!);
  state.commitKeyframeDrag();
  state.setCurrentTime(0.7);
  state.setKeyframeSnapMode('frame');
  state.play();
  const before = state.workingAnimation;
  const original = JSON.stringify(input);
  const events = vi.fn();
  const notify = vi.fn();
  state.onAnimationEvent(events);
  state.subscribe(notify);
  const candidate = state.previewKeyframeRetiming({ scale: 0.5, anchor: 'earliest' });
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.isTrue(state.isPlaying);
  assert.equal(notify.mock.calls.length, 0);
  assert.isTrue(state.retimeSelectedKeyframes({ scale: 0.5, anchor: 'earliest' }));
  assert.equal(notify.mock.calls.length, 1);
  assert.isFalse(state.isPlaying);
  assert.equal(state.currentTime, 0.7);
  assert.deepEqual(state.primaryKey, key(0.275, 'rotation', 'arm'));
  assert.deepEqual(state.selectedKeys, candidate.keys);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  for (const ref of state.selectedKeys)
    assert.isDefined(state.findBonePropertyKeyframe(ref.boneId, ref.property, ref.time));
  assert.equal(events.mock.calls.length, 0);
  assert.equal(JSON.stringify(input), original);
  const after = state.workingAnimation;
  assert.deepEqual(parseAnimationClip(JSON.parse(state.exportJson()), rig).tracks, after!.tracks);
  assert.equal(compileClip(after!, rig).tracks.length, 3);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
  assert.isFalse(state.dirty);
  state.redo();
  assert.strictEqual(state.workingAnimation, after);
  for (const ref of state.selectedKeys)
    assert.isDefined(state.findBonePropertyKeyframe(ref.boneId, ref.property, ref.time));
});

test('selected IK key retimes with coherent typed selection and one Undo', () => {
  const { state } = session();
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'reach', property: 'mix', time: 0.8 });
  state.setCurrentTime(0.2);
  const before = state.workingAnimation;
  assert.isTrue(state.retimeSelectedKeyframes({ scale: 0.5, anchor: 'playhead' }));
  assert.deepEqual(state.ik.selectedIKKeyframe, { kind: 'ik', constraintId: 'reach', property: 'mix', time: 0.5 });
  assert.equal(state.ik.findIKPropertyKeyframe('reach', 'mix', 0.5)?.value, 0.8);
  assert.equal(state.historyLength, 1);
  assert.strictEqual(state.workingAnimation!.tracks, before!.tracks);
  state.undo();
  assert.strictEqual(state.workingAnimation, before);
});

test('rejected apply retains navigation, playback, drafts, history and redo', () => {
  const { state } = session();
  state.retimeSelectedKeyframes({ scale: 0.5, anchor: 'earliest' });
  state.undo();
  state.selectKeyframes(group);
  state.setTemporaryBoneProperty('x', 42);
  const draft = state.boneTransformDraft;
  assert.isFalse(state.retimeSelectedKeyframes({ scale: 4, anchor: 'earliest' }));
  assert.strictEqual(state.boneTransformDraft, draft);
  state.play();
  const before = state.workingAnimation;
  const keys = state.selectedKeys;
  const time = state.currentTime;
  assert.isFalse(state.retimeSelectedKeyframes({ scale: 4, anchor: 'earliest' }));
  assert.strictEqual(state.workingAnimation, before);
  assert.strictEqual(state.selectedKeys, keys);
  assert.equal(state.currentTime, time);
  assert.isTrue(state.isPlaying);
  assert.isTrue(state.canRedo);
  assert.equal(state.historyLength, 0);
});

test('controller preview is read-only, caches clock-only changes and invalidates changed anchors/options/session', () => {
  const { state } = session();
  const controller = new KeyframeRetimingController();
  controller.bind(state);
  const source = state.workingAnimation;
  assert.equal(controller.getSnapshot().count, 5);
  assert.isTrue(controller.previewRetiming());
  const preview = controller.getSnapshot().preview;
  state.setCurrentTime(0.6);
  assert.strictEqual(controller.getSnapshot().preview, preview, 'earliest anchor is independent of clock');
  assert.strictEqual(state.workingAnimation, source);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.setAnchor('playhead');
  assert.isNull(controller.getSnapshot().preview);
  assert.isTrue(controller.previewRetiming());
  state.setCurrentTime(0.7);
  assert.isNull(controller.getSnapshot().preview);
  controller.setScale('0');
  assert.match(controller.getSnapshot().reason, /greater than zero/);
  assert.isFalse(controller.apply());
  controller.setScale('0.5');
  assert.isTrue(controller.apply());
  assert.match(controller.getSnapshot().feedback, /Retimed 5/);
  assert.isNull(controller.getSnapshot().preview);
  assert.equal(state.historyLength, 1);
  state.undo();
  state.selectKeyframes(group);
  assert.isTrue(controller.previewRetiming());
  state.selectAnimation('other');
  assert.isNull(controller.getSnapshot().preview);
  assert.equal(controller.getSnapshot().count, 0);
  controller.unbind();
  state.selectKeyframes(group);
  assert.equal(controller.getSnapshot().count, 0);
  controller.dispose();
});

test('controller rejection reports bounds without dirtying the document or clearing redo', () => {
  const { state } = session();
  const controller = new KeyframeRetimingController();
  controller.bind(state);
  controller.setScale('4');
  const before = state.workingAnimation;
  assert.isFalse(controller.previewRetiming());
  assert.match(controller.getSnapshot().feedback, /outside the animation duration/);
  assert.isFalse(controller.apply());
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});
