import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { IKBakeController } from '../src/devtools/animation-editor/IKBakeController.js';
import { planIKBake } from '../src/devtools/animation-editor/ikBakePlanning.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { getAuthoredBoneProperties } from '../src/devtools/animation-editor/keyframeQueries.js';
import { KeyframeRetimingController } from '../src/devtools/animation-editor/KeyframeRetimingController.js';
import { MirrorToolsController } from '../src/devtools/animation-editor/MirrorToolsController.js';
import { TimelineSessionController } from '../src/devtools/animation-editor/TimelineSessionController.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { transformProperties } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';
import { EditorElement, stubRigEditorDom } from './helpers/rigEditorDom.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const definition = {
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'leftArm', parent: 'root', x: -10 },
    { id: 'rightArm', parent: 'root', x: 10 },
    { id: 'upper', parent: 'root' },
    { id: 'lower', parent: 'upper', y: 60 },
    { id: 'hand', parent: 'lower', y: 50 },
  ],
  ik: [{ name: 'reach', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
};
function fixture() {
  const rig = new Rig(definition);
  const clip: AnimationClip = {
    name: 'motion',
    duration: 1000,
    loop: false,
    tracks: {
      leftArm: [
        { time: 0, rotation: 0.1 },
        { time: 800, rotation: 0.4 },
      ],
    },
    ikTracks: {
      reach: [
        { time: 0, x: 60, y: 60 },
        { time: 1000, x: -30, y: 75 },
      ],
    },
    events: [{ time: 500, name: 'cue', data: { retain: [true, null] } }],
  };
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('motion');
  const mapping = createBoneSymmetryMapping(rig, { manualPairs: [{ leftBoneId: 'leftArm', rightBoneId: 'rightArm' }] });
  assert.isTrue(mapping.success);
  state.setSymmetryMapping(mapping.mapping);
  return { state, rig, clip };
}

test('toolbar availability and deletion follow bone, hidden, IK, event and empty selections', async () => {
  const { state } = fixture();
  const query = stubRigEditorDom();
  vi.stubGlobal('Option', EditorElement);
  const controller = new TimelineSessionController(query('#editor-app') as unknown as HTMLElement, () => state, {
    endScrub() {},
  });
  const release = state.subscribe(() => controller.render());
  try {
    controller.render();
    assert.isTrue(query('#timeline-delete-key').disabled);
    assert.include(query('#timeline-delete-key').getAttribute('title')!, 'Select keys');
    assert.isTrue(query('#animation-retime-open').disabled);
    assert.isFalse(query('#animation-mirror-open').disabled);
    assert.isFalse(query('#animation-bake-open').disabled);
    state.selectKeyframe({ boneId: 'leftArm', property: 'rotation', time: 0 });
    state.setTimelineFilters({ search: 'no match' });
    assert.isFalse(query('#animation-retime-open').disabled);
    assert.include(query('#timeline-delete-key').textContent, '1 hidden');
    assert.isFalse(query('#timeline-copy-keys').disabled);
    const bone = state.workingAnimation;
    await query('#timeline-delete-key').click();
    assert.lengthOf(state.selectedKeys, 0);
    assert.equal(state.historyLength, 1);
    state.undo();
    assert.strictEqual(state.workingAnimation, bone);
    state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'reach', property: 'x', time: 0 });
    const ik = state.workingAnimation;
    assert.isFalse(query('#timeline-delete-key').disabled);
    assert.isFalse(query('#animation-retime-open').disabled);
    assert.isTrue(query('#timeline-copy-keys').disabled);
    assert.include(query('#timeline-copy-keys').getAttribute('title')!, 'IK clipboard');
    await query('#timeline-delete-key').click();
    assert.isNull(state.ik.selectedIKKeyframe);
    assert.isUndefined(state.workingAnimation!.ikTracks!.reach![0]!.x);
    assert.strictEqual(state.workingAnimation!.tracks, ik!.tracks);
    assert.equal(state.historyLength, 1);
    state.undo();
    assert.strictEqual(state.workingAnimation, ik);
    state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'reach', property: 'x', time: 0 });
    state.clearTimelineSelection();
    assert.isNull(state.ik.selectedIKKeyframe);
    assert.isTrue(query('#timeline-delete-key').disabled);
    state.selectAnimationEvent(state.eventTimelineTrack.markers[0]!.ref);
    assert.isTrue(query('#animation-retime-open').disabled);
    assert.include(query('#animation-retime-open').getAttribute('title')!, 'Events cannot');
    assert.equal(query('#timeline-delete-key').textContent, 'Delete Event');
    await query('#timeline-delete-key').click();
    assert.isNull(state.selectedEvent);
    state.undo();
    state.selectAnimation(null);
    assert.isTrue(query('#animation-bake-open').disabled);
    assert.isTrue(query('#animation-mirror-open').disabled);
    assert.isTrue(query('#animation-retime-open').disabled);
  } finally {
    release();
    controller.dispose();
  }
});

test('mixed authored commands each publish one coherent history entry and exported playback loads normally', async () => {
  const { state, rig, clip } = fixture();
  const source = state.sourceAnimation;
  const sourceJson = JSON.stringify(clip);
  const rigJson = JSON.stringify(rig);
  const snapshots = [state.workingAnimation];
  const notifications = vi.fn();
  state.subscribe(notifications);
  const commit = (action: () => boolean) => {
    notifications.mockClear();
    assert.isTrue(action());
    snapshots.push(state.workingAnimation);
    assert.equal(state.historyLength, snapshots.length - 1);
    assert.equal(notifications.mock.calls.length, 1);
    assert.strictEqual(state.sourceAnimation, source);
  };
  commit(() => state.keyframes.setBonePropertyKeyframe('leftArm', 'rotation', 0.6, 0.4));
  state.ik.selectIKConstraint('reach');
  state.setCurrentTime(0.4);
  state.ik.setTemporaryIKProperty('x', 35);
  state.ik.setTemporaryIKProperty('y', 65);
  commit(() => state.ik.commitIKTarget());
  commit(() => state.setAuthoredInterpolation('linear'));
  const event = state.eventTimelineTrack.markers[0]!.ref;
  commit(() => state.updateAnimationEvent(event, { time: 550, name: 'contact', data: { retain: [true, null] } }));
  state.selectKeyframes([0, 0.4, 0.8].map((time) => ({ boneId: 'leftArm', property: 'rotation', time })));
  commit(() => state.keyframes.mirrorSelectedKeyframes('left-to-right'));
  state.setTimelineFilters({ search: 'no matching row', showIK: false, showEvents: false });
  state.setTimelineSnapSettings({ enabled: true, frames: false, keyframes: true, events: true, playhead: true });
  commit(() => state.keyframes.retimeSelectedKeyframes({ scale: 0.5, anchor: 'earliest' }));
  const plan = planIKBake({ rig: definition, animation: state.workingAnimation!, constraintIds: ['reach'], fps: 10 });
  assert.isTrue(plan.success);
  if (!plan.success) return;
  commit(() => state.commitIKBake(plan.plan));
  state.markSaved();
  const exported = state.exportJson();
  for (let index = snapshots.length - 2; index >= 0; --index) {
    notifications.mockClear();
    assert.isTrue(state.undo());
    assert.strictEqual(state.workingAnimation, snapshots[index]);
    assert.equal(notifications.mock.calls.length, 1);
    for (const key of state.selectedKeys)
      assert.exists(state.findBonePropertyKeyframe(key.boneId, key.property, key.time));
  }
  for (let index = 1; index < snapshots.length; ++index) {
    assert.isTrue(state.redo());
    assert.strictEqual(state.workingAnimation, snapshots[index]);
  }
  assert.isFalse(state.dirty);
  assert.equal(state.exportJson(), exported);
  assert.equal(JSON.stringify(clip), sourceJson);
  assert.equal(JSON.stringify(rig), rigJson);
  const files: Record<string, string> = {
    'character.json': JSON.stringify({
      version: 1,
      id: 'edited',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['animation.json'],
      textures: {},
    }),
    'rig.json': JSON.stringify({ version: 1, ...definition }),
    'skin.json': JSON.stringify({ version: 1, name: 'default', slots: {} }),
    'animation.json': exported,
  };
  const fetcher: typeof fetch = async (input) =>
    new Response(
      files[
        new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname.slice(1)
      ],
    );
  const loaded = await CharacterLoader.load('https://fixture.test/character.json', fetcher);
  const puppet = new Puppet(puppetScene(), { definition: loaded, autoUpdate: false });
  try {
    puppet.play('motion');
    for (const time of [0, 200, 400, 600, 800, 1000]) {
      puppet.sampleAnimation(time, { mode: 'playback' });
      for (const bone of rig.bones) {
        const expected = state.getEvaluatedBoneTransform(bone.id, time / 1000)!;
        for (const property of transformProperties)
          assert.closeTo(puppet.getBone(bone.id).pose[property], expected[property], 1e-9);
      }
    }
    assert.deepEqual(loaded.animations[0]!.disabledIKConstraints, ['reach']);
    assert.deepEqual(loaded.animations[0]!.events, state.workingAnimation!.events);
  } finally {
    puppet.destroy();
  }
  assert.isTrue(state.importJson(exported));
  assert.isNull(state.selectedTarget);
  assert.lengthOf(state.selectedKeys, 0);
  assert.isNull(state.ik.selectedIKKeyframe);
  assert.isNull(state.selectedEvent);
  assert.equal(state.historyLength, 0);
  assert.equal(state.currentTime, 0);
});

test('clock notifications retain panel snapshots, avoid hidden IK sampling and detach replaced sessions', () => {
  const { state } = fixture();
  const ik = new IKInspectorController();
  const retime = new KeyframeRetimingController();
  const mirror = new MirrorToolsController(vi.fn(), () => ({ getItem: () => null, setItem() {} }));
  const planning = vi.fn();
  const bake = new IKBakeController(vi.fn(), () => [], planning);
  ik.bind(state);
  retime.bind(state);
  mirror.bind(state, 'fixture');
  bake.bind(state);
  const listeners = [ik, retime, mirror, bake].map((controller) => {
    const notify = vi.fn();
    controller.subscribe(notify);
    return notify;
  });
  const snapshots = [ik.getSnapshot(), retime.getSnapshot(), mirror.getSnapshot(), bake.getSnapshot()];
  const sample = vi.spyOn(state.ik, 'selectedIKTargetValues', 'get');
  state.play();
  for (let index = 0; index < 30; ++index) state.advancePlayback(1 / 60);
  assert.equal(sample.mock.calls.length, 0);
  assert.deepEqual(
    listeners.map((listener) => listener.mock.calls.length),
    [0, 0, 0, 0],
  );
  assert.deepEqual([ik.getSnapshot(), retime.getSnapshot(), mirror.getSnapshot(), bake.getSnapshot()], snapshots);
  assert.equal(planning.mock.calls.length, 0);
  state.ik.selectIKKeyframe({ kind: 'ik', constraintId: 'reach', property: 'x', time: 0 });
  assert.isTrue(ik.getSnapshot().ready);
  state.setTimelineFilters({ showIK: false });
  assert.isTrue(ik.getSnapshot().ready, 'a hidden selected track still has a valid inspector');
  const replacement = fixture().state;
  ik.bind(replacement);
  retime.bind(replacement);
  mirror.bind(replacement, 'replacement');
  bake.bind(replacement);
  const after = [ik.getSnapshot(), retime.getSnapshot(), mirror.getSnapshot(), bake.getSnapshot()];
  state.setCurrentTime(0.9);
  state.ik.setIKPropertyKeyframe('reach', 'x', 90, 0.9);
  assert.deepEqual([ik.getSnapshot(), retime.getSnapshot(), mirror.getSnapshot(), bake.getSnapshot()], after);
  for (const controller of [ik, retime, mirror, bake]) controller.dispose();
  replacement.ik.selectIKConstraint('reach');
  assert.isNull(ik.getSnapshot().constraintId);
  assert.lengthOf(bake.getSnapshot().constraints, 0);
  assert.lengthOf(mirror.getSnapshot().boneIds, 0);
});

test('bone inspector unbind releases old hierarchy handlers and can bind a fresh rig', async () => {
  const { BoneInspectorController } = await import('../src/devtools/animation-editor/BoneInspectorController.js');
  const { state } = fixture();
  const query = stubRigEditorDom();
  Object.assign(query('#animation-bone-title'), { closest: () => null });
  vi.stubGlobal('document', {
    activeElement: null,
    createElement: () => Object.assign(new EditorElement(), { validity: { valid: true } }),
  });
  const controller = new BoneInspectorController(query('#editor-app') as unknown as HTMLElement);
  try {
    controller.bind(state);
    const staleButton = query('#animation-bones').children[1]!;
    await staleButton.click();
    assert.equal(state.selectedBoneId, 'leftArm');
    assert.equal(query('#animation-bone-title').textContent, 'Bone: leftArm');
    const working = state.workingAnimation;
    state.setTemporaryBoneProperty('x', 25);
    await staleButton.click();
    assert.isNull(state.selectedBoneId);
    assert.equal(query('#animation-bone-title').textContent, 'Select a bone');
    assert.equal(staleButton.getAttribute('aria-pressed'), 'false');
    assert.isTrue(query('#animation-bone-fields').disabled);
    assert.deepEqual(state.boneTransformDraft, {});
    assert.strictEqual(state.workingAnimation, working);
    assert.isFalse(state.dirty);
    assert.equal(state.historyLength, 0);
    await staleButton.click();
    assert.equal(state.selectedBoneId, 'leftArm');
    controller.unbind();
    assert.equal(query('#animation-bones').childElementCount, 0);
    assert.isTrue(query('#animation-bone-fields').disabled);
    state.selectBone('rightArm');
    await staleButton.click();
    assert.equal(state.selectedBoneId, 'rightArm');
    assert.equal(query('#animation-bone-title').textContent, 'Select a bone');
    const replacement = fixture().state;
    controller.bind(replacement);
    await query('#animation-bones').children[1]!.click();
    assert.equal(replacement.selectedBoneId, 'leftArm');
    assert.equal(state.selectedBoneId, 'rightArm');
    controller.dispose();
    replacement.selectBone('rightArm');
    assert.equal(query('#animation-bones').childElementCount, 0);
  } finally {
    controller.dispose();
  }
});

test('authored-property queries preserve immutable sources and stay fresh for caller-owned mutable tracks', () => {
  const { state, clip } = fixture();
  const before = JSON.stringify(clip);
  const source = state.sourceAnimation!;
  const properties = getAuthoredBoneProperties(source, 'leftArm');
  assert.deepEqual(properties, ['rotation']);
  properties.push('x');
  assert.deepEqual(getAuthoredBoneProperties(source, 'leftArm'), ['rotation']);
  assert.deepEqual(getAuthoredBoneProperties(source, 'absent'), []);
  state.keyframes.setBonePropertyKeyframe('leftArm', 'y', 4, 0.5);
  assert.deepEqual(getAuthoredBoneProperties(state.workingAnimation!, 'leftArm'), ['y', 'rotation']);
  assert.deepEqual(getAuthoredBoneProperties(source, 'leftArm'), ['rotation']);
  assert.equal(JSON.stringify(clip), before);
  assert.deepEqual(getAuthoredBoneProperties(clip, 'leftArm'), ['rotation']);
  clip.tracks.leftArm![0]!.scaleX = 2;
  assert.deepEqual(getAuthoredBoneProperties(clip, 'leftArm'), ['rotation', 'scaleX']);
  assert.deepEqual(getAuthoredBoneProperties(source, 'leftArm'), ['rotation']);
});
