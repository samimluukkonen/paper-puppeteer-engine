import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { evaluateIKTarget } from '../src/devtools/animation-editor/ikInspectorSampling.js';
import { ikTrackKey } from '../src/devtools/animation-editor/ikTimeline.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(overrides: Partial<AnimationClip> = {}) {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 10, y: 5 },
      { id: 'arm', parent: 'root' },
      { id: 'lower', parent: 'arm', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
    ],
    ik: [
      { name: 'arm', rootBone: 'arm', middleBone: 'lower', endBone: 'hand', mix: 0.7 },
      { name: 'other', rootBone: 'arm', middleBone: 'lower', endBone: 'hand', enabled: false },
    ],
  });
  const clip: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 10 },
        { time: 1000, x: 20 },
      ],
    },
    events: [{ time: 500, name: 'event' }],
    ikTracks: { other: [{ time: 0, y: 90 }] },
    ...overrides,
  };
  const before = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'second' }]);
  state.selectAnimation('reach');
  return { rig, clip, before, state };
}

test('real constraint rows use separate identities, sparse markers, cached layout and independent expansion', () => {
  const { state } = fixture({
    ikTracks: {
      arm: [
        { time: 0, x: 10 },
        { time: 500, y: 20, mix: 0.5 },
      ],
    },
  });
  state.setTimelineBoneExpanded('arm', true);
  state.setTimelineIKExpanded('arm', true);
  const rows = state.timelineTracks;
  const parent = rows.find((row) => row.kind === 'ik' && row.constraintId === 'arm');
  assert.exists(parent);
  assert.isFalse('boneId' in parent);
  const channels = rows.filter((row) => row.kind === 'ik-property').filter((row) => row.constraintId === 'arm');
  assert.deepEqual(
    channels.map((row) => row.property),
    ['x', 'y', 'mix'],
  );
  assert.deepEqual(
    channels.map((row) => row.keyframes.map((key) => [key.kind, key.time, key.value])),
    [[['ik', 0, 10]], [['ik', 0.5, 20]], [['ik', 0.5, 0.5]]],
  );
  assert.isTrue(state.isTimelineBoneExpanded('arm'));
  assert.isTrue(state.isTimelineIKExpanded('arm'));
  assert.notEqual(ikTrackKey('arm'), JSON.stringify(['arm', null]));
  state.selectIKConstraint('arm');
  state.setCurrentTime(0.25);
  assert.strictEqual(state.timelineTracks, rows);
  state.setIKPropertyKeyframe('arm', 'x', 15);
  const other = rows.find((row) => row.kind === 'ik' && row.constraintId === 'other');
  assert.strictEqual(
    state.timelineTracks.find((row) => row.kind === 'ik' && row.constraintId === 'other'),
    other,
  );
});

test('typed IK selection clears bone keys and draft without dirtying the working copy', () => {
  const { state } = fixture();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  state.setTemporaryBoneProperty('y', 12);
  const working = state.workingAnimation;
  assert.isTrue(state.selectIKConstraint('arm', 'x'));
  assert.deepEqual(state.selectedTarget, { kind: 'ik', constraintId: 'arm', property: 'x' });
  assert.isNull(state.selectedBoneId);
  assert.lengthOf(state.selectedKeys, 0);
  assert.deepEqual(state.boneTransformDraft, {});
  assert.isFalse(state.commitBoneProperty('x'));
  assert.isFalse(state.selectIKConstraint('missing'));
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  state.selectBone('arm');
  assert.isNull(state.selectedIKConstraintId);
  assert.deepEqual(state.selectedTarget, { kind: 'bone', boneId: 'arm' });
});

test('inspector evaluation shares sparse IK interpolation, stepped timing, endpoints and animated fallback', () => {
  const { state } = fixture({
    playback: { mode: 'stepped', fps: 10 },
    ikTracks: {
      arm: [
        { time: 0, x: 30 },
        { time: 1000, x: 80, mix: 0.2 },
      ],
    },
  });
  state.selectIKConstraint('arm');
  state.setCurrentTime(0.55);
  assert.deepEqual(state.selectedIKTargetValues, { x: 55, y: 115, mix: 0.2 });
  state.setCurrentTime(1);
  assert.deepEqual(state.selectedIKTargetValues, { x: 80, y: 115, mix: 0.2 });
  state.deleteIKPropertyKey('x');
  state.setCurrentTime(0.55);
  // One surviving x key holds its value; deleting it restores the current bone endpoint.
  assert.equal(state.selectedIKTargetValues!.x, 30);
  state.setCurrentTime(0);
  state.deleteIKPropertyKey('x');
  state.setCurrentTime(0.55);
  assert.deepEqual(state.selectedIKTargetValues, { x: 15, y: 115, mix: 0.2 });
});

test.each([1001, 1003, 1001.123456789])('inspectors and canvas retain the exact %s ms stepped endpoint', (duration) => {
  const { state, rig } = fixture({
    duration,
    playback: { mode: 'stepped', fps: 10 },
    tracks: {
      root: [
        { time: 0, x: 10 },
        { time: duration, x: 20 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 30 },
        { time: duration, x: 80 },
      ],
    },
  });
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  state.selectIKConstraint('arm');
  state.setCurrentTime(state.duration);
  assert.equal(state.currentTimeMilliseconds, duration);
  assert.equal(state.selectedIKTargetValues!.x, 80);
  assert.equal(puppet.getIK('arm').resolvedTarget!.x, 80);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), 20);
  assert.equal(state.getEvaluatedBoneTransform('root')!.x, 20);
  assert.equal(puppet.getBone('root').pose.x, 20);
  const working = state.workingAnimation;
  assert.isTrue(state.commitIKProperty('x'));
  assert.strictEqual(state.workingAnimation, working);
  assert.isTrue(state.setIKPropertyKeyframe('arm', 'y', 75));
  assert.equal(state.workingAnimation!.ikTracks!.arm!.at(-1)!.time, duration);
  assert.isTrue(state.setBonePropertyKeyframe('root', 'y', 12));
  assert.equal(state.workingAnimation!.tracks.root!.at(-1)!.time, duration);
  preview.dispose();
  puppet.destroy();
});

test('numeric edits hold playback; commits create/update independent channels with one history entry each', () => {
  const { state, clip, before } = fixture();
  const source = state.sourceAnimation;
  const working = state.workingAnimation!;
  state.selectIKConstraint('arm');
  state.setCurrentTime(0.5);
  state.play();
  state.beginIKEdit();
  assert.isFalse(state.isPlaying);
  for (const value of [1, 12, 120]) state.setTemporaryIKProperty('x', value);
  state.setTemporaryIKProperty('y', 35);
  state.advancePlayback(1);
  assert.equal(state.currentTime, 0.5);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.isTrue(state.commitIKProperty('x'));
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm, [{ time: 500, x: 120 }]);
  assert.deepEqual(state.ikTargetDraft, { y: 35 });
  assert.equal(state.historyLength, 1);
  state.setTemporaryIKProperty('x', 60);
  state.commitIKProperty('x');
  state.commitIKProperty('mix');
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm, [{ time: 500, x: 60, mix: 0.7 }]);
  assert.equal(state.historyLength, 3);
  assert.isTrue(state.dirty);
  assert.isFalse(state.isPlaying);
  assert.strictEqual(state.workingAnimation!.tracks, working.tracks);
  assert.strictEqual(state.workingAnimation!.events, working.events);
  assert.strictEqual(state.workingAnimation!.ikTracks!.other, working.ikTracks!.other);
  assert.strictEqual(state.sourceAnimation, source);
  assert.equal(JSON.stringify(clip), before);
  assert.isTrue(state.undo());
  assert.isUndefined(state.findIKPropertyKeyframe('arm', 'mix'));
  assert.isTrue(state.redo());
  assert.equal(state.findIKPropertyKeyframe('arm', 'mix')!.value, 0.7);
});

test('property deletion retains siblings, events, other constraints and history fallback', () => {
  const { state } = fixture({ ikTracks: { arm: [{ time: 0, x: 50, y: 60, mix: 0.8 }], other: [{ time: 0, y: 90 }] } });
  state.selectIKConstraint('arm');
  state.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0 });
  const other = state.workingAnimation!.ikTracks!.other;
  assert.isTrue(state.deleteSelectedIKKeyframe());
  assert.isNull(state.selectedIKKeyframe);
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm, [{ time: 0, y: 60, mix: 0.8 }]);
  assert.deepEqual(state.selectedIKTargetValues, { x: 10, y: 60, mix: 0.8 });
  assert.strictEqual(state.workingAnimation!.ikTracks!.other, other);
  state.undo();
  assert.isNull(state.selectedIKKeyframe, 'history does not restore transient selection');
  assert.isFalse(state.dirty);
  assert.equal(state.selectedIKTargetValues!.x, 50);
  state.redo();
  assert.isTrue(state.dirty);
});

test('single key movement uses snapping/collision semantics and never moves sparse siblings', () => {
  const { state } = fixture({
    playback: { mode: 'stepped', fps: 10 },
    ikTracks: {
      arm: [
        { time: 0, x: 50, y: 60 },
        { time: 500, x: 20 },
      ],
    },
  });
  assert.isTrue(state.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0.0000000001 }));
  assert.equal(state.selectedIKKeyframe!.time, 0);
  state.setKeyframeSnapMode('frame');
  assert.isTrue(state.moveSelectedIKKeyframe(0.49));
  assert.deepEqual(state.workingAnimation!.ikTracks!.arm, [
    { time: 0, y: 60 },
    { time: 500, x: 50 },
  ]);
  assert.equal(state.selectedIKKeyframe!.time, 0.5);
  assert.equal(state.currentTime, 0.5);
  assert.equal(state.historyLength, 1);
  state.undo();
  assert.equal(state.selectedIKKeyframe!.time, 0.5, 'selection reconciles to surviving authored destination');
  state.redo();
  state.nudgeSelectedIKKeyframe(1);
  assert.equal(state.selectedIKKeyframe!.time, 0.6);
  assert.equal(state.historyLength, 2);
});

test('invalid IK edits and deferred clipboard commands preserve data and bone keys', () => {
  const { state } = fixture();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  state.copyTimelineSelection();
  state.selectIKConstraint('arm');
  const working = state.workingAnimation;
  assert.isFalse(state.setTemporaryIKProperty('mix', 2));
  assert.isFalse(state.setIKPropertyKeyframe('arm', 'mix', -1));
  assert.isFalse(state.setIKPropertyKeyframe('missing', 'x', 1));
  assert.isFalse(state.selectIKKeyframe({ kind: 'ik', constraintId: 'missing', property: 'x', time: 0 }));
  assert.isFalse(state.removeIKPropertyKeyframe('missing', 'x'));
  assert.isFalse(state.pasteTimelineClipboard());
  assert.isFalse(state.duplicateTimelineSelection());
  assert.isFalse(state.copyTimelineSelection());
  assert.strictEqual(state.workingAnimation, working);
  assert.equal(state.historyLength, 0);
});

test('navigation, playback, animation changes and history cancel IK numeric drafts', () => {
  const { state } = fixture();
  for (const cancel of [
    () => state.setCurrentTime(0),
    () => state.undo(),
    () => state.play(),
    () => state.selectBone('arm'),
    () => state.selectAnimation('second'),
  ]) {
    state.pause();
    state.selectIKConstraint('arm');
    state.setTemporaryIKProperty('x', 77);
    cancel();
    assert.deepEqual(state.ikTargetDraft, {});
    assert.isFalse(state.dirty);
  }
  assert.isNull(state.selectedIKConstraintId);
});

test('IK commands notify once after coordinating playback, selection and history', () => {
  const { state } = fixture({ ikTracks: {} });
  state.play();
  const observations: { playing: boolean; selected: string | null; x: number | undefined; history: number }[] = [];
  state.subscribe(() =>
    observations.push({
      playing: state.isPlaying,
      selected: state.selectedIKConstraintId,
      x: state.workingAnimation?.ikTracks?.arm?.[0]?.x,
      history: state.historyLength,
    }),
  );
  state.selectIKConstraint('arm');
  assert.lengthOf(observations, 1);
  observations.length = 0;
  assert.isTrue(state.setTemporaryIKProperty('x', 70));
  assert.deepEqual(observations, [{ playing: false, selected: 'arm', x: undefined, history: 0 }]);
  observations.length = 0;
  assert.isTrue(state.commitIKProperty('x'));
  assert.deepEqual(observations, [{ playing: false, selected: 'arm', x: 70, history: 1 }]);
});

test('history reconciliation removes missing IK markers and retains unrelated constraint selection', () => {
  const { state } = fixture();
  state.selectIKConstraint('arm');
  state.setIKPropertyKeyframe('arm', 'x', 60, 0.5);
  state.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0.5 });
  state.undo();
  assert.isNull(state.selectedIKKeyframe);
  assert.equal(state.selectedIKConstraintId, 'arm');
  state.redo();
  assert.isNull(state.selectedIKKeyframe);
  state.selectIKKeyframe({ kind: 'ik', constraintId: 'arm', property: 'x', time: 0.5 });
  const next = { ...state.workingAnimation!, ikTracks: { other: [{ time: 0, y: 90 }] } };
  state.replaceWorkingAnimation(next);
  assert.isNull(state.selectedIKKeyframe);
  assert.equal(state.selectedIKConstraintId, 'arm');
});

test('inspector fallback honors earlier constraints, affine ancestors and end offsets with the existing solver', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 10, y: 5, rotation: 0.2, scaleX: 1.1, scaleY: 0.9 },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
      { id: 'gripUpper', parent: 'hand' },
      { id: 'gripLower', parent: 'gripUpper', y: 20 },
      { id: 'gripHand', parent: 'gripLower', y: 15 },
    ],
    ik: [
      {
        name: 'grip',
        rootBone: 'gripUpper',
        middleBone: 'gripLower',
        endBone: 'gripHand',
        priority: 2,
        endOffset: { x: 4, y: 2 },
      },
      { name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', priority: 1 },
    ],
  });
  const clip: AnimationClip = {
    name: 'nested',
    duration: 1000,
    loop: false,
    tracks: {},
    ikTracks: { arm: [{ time: 0, x: 60, y: 60 }], grip: [{ time: 0, x: 20 }] },
  };
  const before = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation('nested');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  state.selectIKConstraint('grip');
  assert.approximately(state.selectedIKTargetValues!.y, puppet.getIK('grip').resolvedTarget!.y, 1e-8);
  assert.equal(state.selectedIKTargetValues!.x, 20);
  assert.equal(JSON.stringify(clip), before);
  assert.equal(rig.getBone('upper').rotation, undefined);
  preview.dispose();
  puppet.destroy();
});

test('inspector sampling stays fresh for mutable API inputs without freezing the source', () => {
  const { clip, rig } = fixture({ ikTracks: { arm: [{ time: 0, x: 50 }] } });
  assert.equal(evaluateIKTarget(clip, rig, 'arm', 0)!.x, 50);
  clip.ikTracks!.arm![0]!.x = 70;
  assert.equal(evaluateIKTarget(clip, rig, 'arm', 0)!.x, 70);
  assert.isFalse(Object.isFrozen(clip));
});

test('React adapter caches snapshots, validates text, synchronizes edits and releases replaced sessions', () => {
  const { state } = fixture();
  const controller = new IKInspectorController();
  controller.bind(state);
  const changed = vi.fn();
  const release = controller.subscribe(changed);
  assert.strictEqual(controller.getSnapshot(), controller.getSnapshot());
  state.selectIKConstraint('arm');
  state.setCurrentTime(0.5);
  assert.equal(controller.getSnapshot().fields[0]!.text, '15');
  state.play();
  controller.beginEdit();
  assert.isFalse(state.isPlaying);
  controller.edit('x', '70.0');
  assert.equal(controller.getSnapshot().fields[0]!.text, '70.0');
  controller.edit('mix', '2');
  assert.isFalse(controller.commit('mix'));
  assert.isFalse(state.dirty);
  assert.isTrue(controller.commit('x'));
  assert.equal(state.historyLength, 1);
  assert.isTrue(controller.getSnapshot().fields[0]!.keyed);
  assert.isTrue(controller.remove('x'));
  assert.equal(controller.getSnapshot().fields[0]!.text, '15');
  state.undo();
  assert.equal(controller.getSnapshot().fields[0]!.text, '70');
  controller.edit('y', '');
  assert.isFalse(controller.getSnapshot().fields[1]!.valid);
  state.setCurrentTime(state.currentTime);
  assert.isTrue(controller.getSnapshot().fields[1]!.valid, 'navigation cancels even invalid UI text');
  controller.edit('y', '');
  controller.cancel();
  assert.isTrue(controller.getSnapshot().fields[1]!.valid);
  const next = fixture().state;
  controller.bind(next);
  const snapshot = controller.getSnapshot();
  state.setCurrentTime(1);
  assert.strictEqual(controller.getSnapshot(), snapshot);
  release();
  changed.mockClear();
  next.selectIKConstraint('arm');
  assert.equal(changed.mock.calls.length, 0);
  controller.dispose();
  assert.isFalse(controller.getSnapshot().ready);
});

test.each(['x', 'y', 'mix'] as const)(
  'untouched IK %s commits preserve precise and tiny authored values',
  (property) => {
    for (const value of [0.123456789, 1e-7]) {
      const { state } = fixture({ ikTracks: { arm: [{ time: 0, [property]: value }] } });
      state.selectIKConstraint('arm');
      const controller = new IKInspectorController();
      controller.bind(state);
      const working = state.workingAnimation;
      assert.isTrue(controller.commit(property));
      assert.strictEqual(state.workingAnimation, working);
      assert.equal(state.workingAnimation!.ikTracks!.arm![0]![property], value);
      assert.isFalse(state.dirty);
      assert.equal(state.historyLength, 0);
      controller.dispose();
    }
  },
);

test('committed IK authoring immediately refreshes the existing puppet/solver and supports A/B/C playback', () => {
  const { state, rig, clip, before } = fixture({ ikTracks: {}, tracks: {} });
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const constraint = puppet.getIK('arm');
  const check = (x: number, y: number) => {
    const matrix = puppet.getBone('hand').container.getWorldTransformMatrix();
    const endpoint = { x: matrix.tx, y: matrix.ty };
    assert.approximately(endpoint.x, x, 1e-7);
    assert.approximately(endpoint.y, y, 1e-7);
  };
  state.selectIKConstraint('arm');
  state.setTemporaryIKProperty('mix', 1);
  state.commitIKProperty('mix');
  for (const [time, x, y] of [
    [0, 60, 65],
    [0.5, 30, 85],
    [1, -40, 75],
  ]) {
    state.setCurrentTime(time!);
    state.setTemporaryIKProperty('x', x!);
    state.setTemporaryIKProperty('y', y!);
    state.commitIKProperty('x');
    state.commitIKProperty('y');
    check(x!, y!);
    assert.strictEqual(puppet.getIK('arm'), constraint);
  }
  state.restart();
  state.play();
  state.advancePlayback(0.5);
  check(30, 85);
  state.pause();
  state.setCurrentTime(1);
  state.deleteIKPropertyKey('x');
  check(30, 75);
  state.undo();
  check(-40, 75);
  state.redo();
  check(30, 75);
  assert.equal(JSON.stringify(clip), before);
  preview.dispose();
  puppet.destroy();
});
