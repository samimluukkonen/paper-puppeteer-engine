import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getAuthoredBoneProperties } from '../src/devtools/animation-editor/keyframes.js';
import { buildTimelineTracks } from '../src/devtools/animation-editor/timelineTracks.js';
import { boneHierarchy } from '../src/devtools/shared/boneHierarchy.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Rig } from '../src/engine/Rig.js';
import { type TransformProperty, transformProperties } from '../src/engine/types.js';
import { demoAnimations, demoRig } from './helpers/demoCharacter.js';

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'hand', parent: 'zArm' },
    { id: 'aLeg', parent: 'root' },
    { id: 'root' },
    { id: 'zArm', parent: 'root', x: 12, rotation: 0.5 },
    { id: 'foot', parent: 'aLeg' },
  ],
});

function clip(patch: Partial<AnimationClip> = {}): AnimationClip {
  return {
    name: 'move',
    duration: 2000,
    loop: false,
    tracks: {
      zArm: [{ time: 1500, rotation: 0, scaleX: 1 }],
      root: [{ time: 0, x: 0 }],
    },
    ...patch,
  };
}

function session() {
  const input = clip();
  const state = new AnimationEditorState(rig, [input, clip({ name: 'empty', tracks: {} })]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  return { state, input };
}

test('bone rows follow parent-first depth-first rig order, including unanimated bones', () => {
  const rows = buildTimelineTracks(rig, clip(), new Set());
  assert.deepEqual(
    rows.filter((row) => 'boneId' in row).map(({ boneId, depth }) => ({ id: boneId, depth })),
    boneHierarchy(rig),
  );
  assert.deepEqual(
    rows.map((row) => ('boneId' in row ? row.boneId : undefined)),
    ['root', 'zArm', 'hand', 'aLeg', 'foot'],
  );
  assert.isTrue(rows.every((row) => row.kind === 'bone' && !row.expanded));
  assert.deepEqual(
    rows.map((row) => row.hasKeys),
    [true, true, false, false, false],
  );
});

test('expansion inserts every supported property in stable runtime order, without hiding child bones', () => {
  const rows = buildTimelineTracks(rig, clip(), new Set(['zArm', 'aLeg', 'missing']));
  assert.lengthOf(rows, rig.bones.length + 2 * transformProperties.length);
  for (const boneId of ['aLeg', 'zArm']) {
    const index = rows.findIndex((row) => row.kind === 'bone' && row.boneId === boneId);
    const bone = rows[index]!;
    assert.isTrue(bone.kind === 'bone' && bone.expanded);
    assert.deepEqual(
      rows.slice(index + 1, index + 6),
      transformProperties.map((property) => ({
        kind: 'property',
        boneId,
        depth: bone.depth + 1,
        property,
        hasKeys: boneId === 'zArm' && ['rotation', 'scaleX'].includes(property),
        keyframes:
          boneId === 'zArm' && ['rotation', 'scaleX'].includes(property)
            ? [{ boneId, property, time: 1.5, value: property === 'rotation' ? 0 : 1 }]
            : [],
      })),
    );
  }
  assert.isTrue(rows.some((row) => row.kind === 'bone' && row.boneId === 'hand'));
  assert.isTrue(Object.isFrozen(rows));
  assert.isTrue(rows.every(Object.isFrozen));
});

test('authored presence ignores bind pose, playhead, time-only rows, and inherited track names', () => {
  const animation = clip({ tracks: { zArm: [{ time: 1500, rotation: 0 }], aLeg: [{ time: 0 }], foot: [] } });
  assert.deepEqual(getAuthoredBoneProperties(animation, 'zArm'), ['rotation']);
  for (const id of ['aLeg', 'foot', 'hand', 'toString']) assert.deepEqual(getAuthoredBoneProperties(animation, id), []);
  const { state } = session();
  state.setTimelineBoneExpanded('zArm', true);
  assert.isFalse(state.hasKeyframeAtTime('zArm', 'rotation'));
  const rows = state.timelineTracks;
  for (const time of [0, 0.5, 1.5, 2]) {
    state.setCurrentTime(time);
    assert.strictEqual(state.timelineTracks, rows);
    assert.isTrue(rows.some((row) => row.kind === 'property' && row.property === 'rotation' && row.hasKeys));
  }
});

test('bone/property selection share one owner, notify atomically, and reject unsupported targets', () => {
  const { state } = session();
  const observations: unknown[] = [];
  state.subscribe(() => observations.push([state.selectedBoneId, state.selectedTimelineProperty]));
  state.selectBone('root');
  state.selectTimelineProperty('zArm', 'rotation');
  state.selectTimelineProperty('zArm', 'rotation');
  assert.equal(state.selectedBoneId, 'zArm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  // Hierarchy/preview picking clears a prior property selection even when picking the same bone.
  state.selectBone('zArm');
  assert.isNull(state.selectedTimelineProperty);
  assert.isFalse(state.selectBone('missing'));
  assert.isFalse(state.selectTimelineProperty('missing', 'x'));
  assert.isFalse(state.selectTimelineProperty('root', 'opacity' as TransformProperty));
  assert.isFalse(state.setTimelineBoneExpanded('missing', true));
  state.selectTimelineProperty('hand', 'scaleY');
  state.selectBone(null);
  assert.deepEqual(observations, [
    ['root', null],
    ['zArm', 'rotation'],
    ['zArm', null],
    ['hand', 'scaleY'],
    [null, null],
  ]);
  assert.equal(state.currentTime, 0.5);
});

test('navigation preserves frozen snapshots, caller/source data, dirty state, authored history and redo', () => {
  const { state, input } = session();
  const before = JSON.stringify(input);
  const source = state.sourceAnimation;
  const sourceJson = JSON.stringify(source);
  state.keyframes.setBonePropertyKeyframe('hand', 'y', 5);
  state.undo();
  const working = state.workingAnimation;
  const history = state.historyLength;
  state.selectBone('zArm');
  state.setTemporaryBoneProperty('x', 42);
  state.selectTimelineProperty('root', 'x');
  assert.isFalse(state.hasTemporaryTransform);
  for (const id of ['root', 'zArm', 'hand']) {
    state.setTimelineBoneExpanded(id, true);
    state.selectTimelineProperty(id, 'rotation');
    state.setTimelineBoneExpanded(id, false);
  }
  assert.strictEqual(state.workingAnimation, working);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(source), sourceJson);
  assert.equal(JSON.stringify(input), before);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, history);
  assert.isTrue(state.canRedo);
  assert.isTrue(state.redo());
  assert.isTrue(state.dirty);
  state.selectBone('hand');
  state.setTimelineBoneExpanded('hand', true);
  assert.isTrue(state.dirty);
});

test('playback and scrub retain row identity, property selection and expansion using the existing clock', () => {
  const { state } = session();
  state.setTimelineBoneExpanded('zArm', true);
  state.selectTimelineProperty('zArm', 'rotation');
  const rows = state.timelineTracks;
  state.play();
  state.setTimelineBoneExpanded('hand', true);
  assert.equal(state.currentTime, 0.5);
  assert.isTrue(state.isPlaying);
  state.advancePlayback(0.25);
  assert.equal(state.currentTime, 0.75);
  state.setTimelineBoneExpanded('hand', false);
  assert.deepEqual(state.timelineTracks, rows);
  const expandedRows = state.timelineTracks;
  state.beginScrub();
  state.setCurrentTime(1.1);
  state.advancePlayback(0.5);
  assert.equal(state.currentTime, 1.1);
  state.endScrub();
  state.advancePlayback(0.2);
  assert.approximately(state.currentTime, 1.3, 1e-12);
  assert.strictEqual(state.timelineTracks, expandedRows);
  assert.equal(state.selectedBoneId, 'zArm');
  assert.equal(state.selectedTimelineProperty, 'rotation');
  assert.isTrue(state.isTimelineBoneExpanded('zArm'));
  assert.isFalse(state.dirty);
});

test('authored edits and undo/redo refresh key presence while keeping track navigation state', () => {
  const { state } = session();
  state.setTimelineBoneExpanded('hand', true);
  state.selectTimelineProperty('hand', 'y');
  const hasKeys = () => state.timelineTracks.some((row) => 'boneId' in row && row.boneId === 'hand' && row.hasKeys);
  assert.isFalse(hasKeys());
  state.keyframes.setBonePropertyKeyframe('hand', 'y', 4);
  assert.isTrue(hasKeys());
  state.undo();
  assert.isFalse(hasKeys());
  state.redo();
  assert.isTrue(hasKeys());
  state.keyframes.removeBonePropertyKeyframe('hand', 'y');
  assert.isFalse(hasKeys());
  assert.isTrue(state.isTimelineBoneExpanded('hand'));
  assert.equal(state.selectedTimelineProperty, 'y');
  assert.isFalse(state.dirty);
});

test('animation switching keeps expansion, clears property selection, and supports empty tracks/no selection', () => {
  const { state } = session();
  state.setTimelineBoneExpanded('zArm', true);
  state.selectTimelineProperty('zArm', 'rotation');
  state.selectAnimation('empty');
  assert.isNull(state.selectedTimelineProperty);
  assert.isTrue(state.isTimelineBoneExpanded('zArm'));
  assert.isTrue(state.timelineTracks.every((row) => !row.hasKeys));
  state.selectAnimation(null);
  assert.equal(state.duration, 0);
  assert.lengthOf(state.timelineTracks, rig.bones.length + transformProperties.length);
  assert.isTrue(state.timelineTracks.every((row) => !row.hasKeys));
  assert.isFalse(state.dirty);
});

test('missing rig and rejected zero-duration/invalid animation leave stable navigation rows', () => {
  assert.deepEqual(new AnimationEditorState().timelineTracks, []);
  const state = new AnimationEditorState(rig, [clip({ duration: 0 })]);
  state.setTimelineBoneExpanded('zArm', true);
  const rows = state.timelineTracks;
  assert.isFalse(state.selectAnimation('move'));
  assert.isTrue(state.validationIssues.length > 0);
  assert.strictEqual(state.timelineTracks, rows);
  state.setCurrentTime(10);
  assert.equal(state.currentTime, 0);
  assert.isTrue(rows.every((row) => !row.hasKeys));
  assert.isFalse(state.dirty);
});

test('demo timeline includes every expected bone in the same order as the hierarchy', () => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  state.selectAnimation('idle');
  assert.deepEqual(
    state.timelineTracks.filter((row) => row.kind === 'bone').map((row) => row.boneId),
    boneHierarchy(demoRig).map((row) => row.id),
  );
  assert.lengthOf(
    state.timelineTracks.filter((row) => row.kind === 'bone'),
    demoRig.bones.length,
  );
  for (const bone of demoRig.bones) state.setTimelineBoneExpanded(bone.id, true);
  assert.lengthOf(
    state.timelineTracks.filter((row) => 'boneId' in row),
    demoRig.bones.length * (1 + transformProperties.length),
  );
});

test('editing one bone retains unrelated row identity through history and expansion changes', () => {
  const { state } = session();
  for (const id of ['root', 'zArm']) state.setTimelineBoneExpanded(id, true);
  const before = state.timelineTracks;
  const armRows = before.filter((row) => 'boneId' in row && row.boneId === 'zArm');
  state.keyframes.setBonePropertyKeyframe('root', 'x', 42, 0);
  for (const read of [() => {}, () => state.undo(), () => state.redo()]) {
    read();
    const rows = state.timelineTracks.filter((row) => 'boneId' in row && row.boneId === 'zArm');
    assert.isTrue(rows.every((row, index) => row === armRows[index]));
  }
  state.setTimelineBoneExpanded('hand', true);
  assert.isTrue(
    state.timelineTracks
      .filter((row) => 'boneId' in row && row.boneId === 'zArm')
      .every((row, index) => row === armRows[index]),
  );
  assert.notStrictEqual(
    state.timelineTracks.find((row) => row.kind === 'property' && row.boneId === 'root' && row.property === 'x'),
    before.find((row) => row.kind === 'property' && row.boneId === 'root' && row.property === 'x'),
  );
});

test.each([false, true])('mutable track rows remain fresh when reusing layout, shallow freeze=%s', (shallow) => {
  const keys = [{ time: 0, x: 1 }];
  if (shallow) Object.freeze(keys);
  const animation = clip({ tracks: { root: keys } });
  const before = buildTimelineTracks(rig, animation, new Set(['root']));
  keys[0]!.x = 2;
  const after = buildTimelineTracks(rig, animation, new Set(['root']), before);
  const track = after.find((row) => row.kind === 'property' && row.property === 'x');
  assert.isTrue(track?.kind === 'property');
  if (track?.kind === 'property') assert.equal(track.keyframes[0]!.value, 2);
});
