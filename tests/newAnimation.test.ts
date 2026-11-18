import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  createEmptyAnimation,
  type NewAnimationOptions,
} from '../src/devtools/animation-editor/createEmptyAnimation.js';
import { NewAnimationController } from '../src/devtools/animation-editor/NewAnimationController.js';
import {
  buildCharacterPackage,
  loadPackageDefinition,
  packageJson,
} from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/devtools/shared/package/packageZip.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { validateAnimationDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function rig() {
  return new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 15, rotation: 0.2 },
      { id: 'head', parent: 'root', y: 30, rotation: 0.3 },
      { id: 'tip', parent: 'head', y: 20 },
    ],
    ik: [{ name: 'reach', rootBone: 'root', middleBone: 'head', endBone: 'tip' }],
  });
}
const existing: AnimationClip = {
  name: 'existing',
  duration: 2000,
  loop: false,
  tracks: { head: [{ time: 0, x: 3 }] },
};

test.each([{ clips: [] }, { clips: [existing, { ...existing, name: 'other' }] }])(
  'creates a valid empty document with no JSON prerequisite (%j)',
  ({ clips }) => {
    const skeleton = rig();
    const before = JSON.stringify(skeleton);
    const state = new AnimationEditorState(skeleton, clips);
    assert.isTrue(state.createAnimation({ name: 'idle' }));
    assert.equal(state.selectedAnimationId, 'idle');
    assert.deepEqual(validateAnimationDefinition(state.workingAnimation, skeleton), []);
    assert.deepEqual(state.workingAnimation, {
      version: 1,
      name: 'idle',
      duration: 1000,
      loop: true,
      playback: { mode: 'stepped', fps: 12 },
      tracks: {},
      events: [],
    });
    assert.isUndefined(state.workingAnimation!.ikTracks);
    assert.isTrue(Object.isFrozen(state.workingAnimation));
    assert.isTrue(state.dirty);
    assert.isTrue(state.isNewAnimation());
    assert.isTrue(state.hasUnsavedChanges);
    assert.isFalse(state.canUndo);
    assert.isFalse(state.undo(), 'creation is not a history edit');
    assert.equal(state.selectedAnimationId, 'idle');
    assert.isTrue(state.timelineTracks.some((row) => row.kind === 'bone' && row.boneId === 'head'));
    assert.isTrue(state.timelineTracks.every((row) => !('keyframes' in row) || row.keyframes.length === 0));
    state.selectBone('head');
    assert.equal(state.selectedBoneTransform!.rotation, 0.3);
    const puppet = new Puppet(puppetScene(), { rig: skeleton });
    const preview = new AnimationEditorPreview(state, puppet);
    for (const time of [0, 0.5, 1]) {
      state.setCurrentTime(time);
      assert.equal(puppet.getBone('head').pose.rotation, 0.3);
      assert.equal(puppet.getBone('root').pose.x, 15);
    }
    state.play();
    state.advancePlayback(0.2);
    assert.equal(puppet.getBone('head').pose.rotation, 0.3);
    preview.dispose();
    puppet.destroy();
    assert.equal(JSON.stringify(skeleton), before);
  },
);

test('creation resets session atomically and preserves earlier work and independent histories', () => {
  const state = new AnimationEditorState(rig(), [existing]);
  state.selectAnimation('existing');
  state.selectBone('head');
  state.setBonePropertyKeyframe('head', 'rotation', 0.7);
  const previous = state.workingAnimation;
  state.selectKeyframe({ boneId: 'head', property: 'rotation', time: 0 });
  state.setCurrentTime(0.5);
  state.play();
  const revision = state.sessionRevision;
  const listener = vi.fn(() => {
    assert.equal(state.selectedAnimationId, 'idle');
    assert.equal(state.currentTime, 0);
    assert.isFalse(state.isPlaying);
    assert.isNull(state.selectedBoneId);
    assert.lengthOf(state.selectedKeys, 0);
    assert.isNull(state.selectedEvent);
  });
  const release = state.subscribe(listener);
  state.createAnimation({ name: 'idle', durationSeconds: 2, fps: 24, loop: false });
  assert.equal(state.duration, 2);
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps: 24 });
  assert.isFalse(state.loop);
  assert.equal(listener.mock.calls.length, 1);
  assert.equal(state.sessionRevision, revision + 1);
  release();
  state.selectBone('head');
  for (const time of [0, 0.5, 1]) {
    state.setCurrentTime(time);
    assert.isTrue(state.setBonePropertyKeyframe('head', 'rotation', time + 0.2));
  }
  const authored = state.workingAnimation;
  assert.isTrue(state.createAnimation({ name: 'walk' }));
  assert.deepEqual(state.animationIds, ['existing', 'idle', 'walk']);
  assert.isFalse(state.canUndo);
  state.selectAnimation('existing', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, previous);
  assert.equal(state.historyLength, 1);
  state.undo();
  assert.isFalse(state.dirty);
  assert.isTrue(state.hasUnsavedChanges, 'inactive new documents protect navigation');
  state.selectAnimation('idle', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, authored);
  assert.equal(state.historyLength, 3);
  for (let i = 0; i < 3; i++) assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation!.tracks, {});
  assert.isTrue(state.dirty, 'undo to an empty new document remains unsaved');
  state.redo();
  assert.lengthOf(state.workingAnimation!.tracks.head!, 1);
  assert.isTrue(state.revertAnimation({ discardChanges: true }));
  assert.isTrue(state.isNewAnimation());
  assert.isTrue(state.dirty);
  state.markSaved();
  assert.isFalse(state.isNewAnimation());
  assert.isFalse(state.dirty);
  assert.isTrue(state.hasUnsavedChanges, 'second new document remains unsaved');
  state.selectAnimation('walk', { keepChanges: true });
  state.selectAnimation('walk', { discardChanges: true });
  assert.exists(state.workingAnimation, 'discard never deletes a new document');
  assert.isTrue(state.isNewAnimation());
});

const invalid: NewAnimationOptions[] = [
  { name: '' },
  { name: 'with spaces' },
  { name: '../bad' },
  { name: '__proto__' },
  { name: 'idle', durationSeconds: 0 },
  { name: 'idle', durationSeconds: -1 },
  { name: 'idle', durationSeconds: NaN },
  { name: 'idle', durationSeconds: Infinity },
  { name: 'idle', fps: 0 },
  { name: 'idle', fps: Infinity },
  { name: 'idle', fps: 241 },
];
test.each(invalid)('invalid input leaves registration, selection, clock and history unchanged: %j', (options) => {
  const state = new AnimationEditorState(rig(), [existing]);
  state.selectAnimation('existing');
  state.selectBone('head');
  state.commitBoneProperty('rotation');
  state.setCurrentTime(0.5);
  state.play();
  const held = state.workingAnimation,
    ids = state.animationIds,
    revision = state.sessionRevision;
  assert.isFalse(state.createAnimation(options));
  assert.strictEqual(state.workingAnimation, held);
  assert.strictEqual(state.animationIds, ids);
  assert.equal(state.sessionRevision, revision);
  assert.equal(state.selectedAnimationId, 'existing');
  assert.equal(state.currentTime, 0.5);
  assert.isTrue(state.isPlaying);
  assert.equal(state.historyLength, 1);
  assert.isNotEmpty(state.validationIssues);
});

test.each(['bone draft', 'key drag', 'event drag', 'IK drag', 'scrub'])(
  'new session cancels %s without leaking transient authoring into its empty tracks',
  (gesture) => {
    const state = new AnimationEditorState(rig(), [existing]);
    state.selectAnimation('existing');
    state.selectBone('head');
    switch (gesture) {
      case 'bone draft':
        state.setTemporaryBoneProperty('rotation', 2);
        break;
      case 'key drag':
        state.beginKeyframeDrag({ boneId: 'head', property: 'x', time: 0 });
        break;
      case 'event drag':
        state.createAnimationEvent();
        state.beginEventDrag(state.eventTimelineTrack.markers[0]!.ref);
        break;
      case 'IK drag':
        state.ik.selectIKConstraint('reach');
        state.ik.beginIKTargetDrag('reach');
        state.ik.previewIKTargetDrag({ x: 15, y: 25 });
        break;
      case 'scrub':
        state.play();
        state.beginScrub();
        state.setCurrentTime(0.7);
        break;
    }
    assert.isTrue(state.createAnimation({ name: 'idle' }));
    assert.isFalse(state.hasPendingAnimationEdits);
    assert.isFalse(state.isScrubbing);
    assert.isFalse(state.isPlaying);
    assert.equal(state.currentTime, 0);
    assert.isNull(state.selectedEvent);
    assert.isNull(state.ik.selectedIKConstraintId);
    assert.deepEqual(state.workingAnimation!.tracks, {});
    assert.deepEqual(state.workingAnimation!.events, []);
    assert.isUndefined(state.workingAnimation!.ikTracks);
    assert.isFalse(state.canUndo);
  },
);

test('missing rig, duplicate IDs and cancelled replacement preserve documents', () => {
  const empty = new AnimationEditorState();
  assert.isFalse(empty.createAnimation({ name: 'idle' }));
  assert.deepEqual(empty.animationIds, []);
  assert.throws(() => createEmptyAnimation(undefined, { name: 'idle' }), /valid character rig/);
  const state = new AnimationEditorState(rig(), [existing]);
  assert.isFalse(state.createAnimation({ name: 'existing' }));
  state.createAnimation({ name: 'idle' });
  const baseline = state.workingAnimation;
  assert.isFalse(state.createAnimation({ name: 'idle' }));
  assert.strictEqual(state.workingAnimation, baseline);
  state.createAnimation({ name: 'walk' });
  state.selectAnimation('existing', { keepChanges: true });
  assert.isFalse(state.dirty);
  const confirmDiscard = vi.fn(() => false);
  assert.isFalse(state.importJson(JSON.stringify(baseline), { confirmDiscard }));
  assert.equal(confirmDiscard.mock.calls.length, 1);
  assert.equal(state.selectedAnimationId, 'existing');
  assert.isTrue(state.isNewAnimation('idle'));
});

test('empty documents accept events and IK keys through ordinary history and serialization', () => {
  const state = new AnimationEditorState(rig());
  state.createAnimation({ name: 'reach' });
  assert.isTrue(state.createAnimationEvent());
  state.ik.selectIKConstraint('reach');
  assert.isTrue(state.ik.setIKPropertyKeyframe('reach', 'x', 20));
  const exported = state.exportJson();
  state.undo();
  assert.isUndefined(state.workingAnimation!.ikTracks?.reach);
  state.redo();
  const reloaded = new AnimationEditorState(rig());
  assert.isTrue(reloaded.importJson(exported));
  assert.deepEqual(reloaded.workingAnimation, state.workingAnimation);
  assert.isFalse(reloaded.dirty);
  const empty = createEmptyAnimation(rig(), { name: 'empty' });
  assert.isTrue(reloaded.importJson(JSON.stringify(empty)));
  assert.deepEqual(reloaded.workingAnimation, empty);
});

test('new in-memory animations register manifest paths and play through CharacterLoader and Puppet after ZIP round trip', async () => {
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'new-character',
      rig: 'rig.json',
      defaultSkin: 'base',
      skins: { base: 'skin.json' },
      textures: {},
      animations: [],
    },
    rig: { version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'head', parent: 'root', y: 30 }] },
    skins: { 'skin.json': { version: 1, name: 'base', slots: {} } },
  });
  const source = JSON.stringify(definition.manifest);
  const state = new AnimationEditorState(definition.rig);
  state.createAnimation({ name: 'idle' });
  for (const time of [0, 0.5, 1]) state.setBonePropertyKeyframe('head', 'rotation', time, time);
  const authored = state.workingAnimation;
  state.createAnimation({ name: 'second' });
  const files = decodePackageZip(
    encodePackageZip(
      await buildCharacterPackage({
        definition,
        rig: definition.rigFile!,
        skins: definition.standaloneSkins,
        animations: state.packageAnimations(),
        replacements: [],
      }),
    ),
  );
  assert.deepEqual(packageJson(files, 'character.json'), {
    ...definition.manifest,
    animations: ['animations/idle.json', 'animations/second.json'],
  });
  const loaded = await loadPackageDefinition(files);
  assert.deepEqual(
    loaded.animations.map((clip) => clip.name),
    ['idle', 'second'],
  );
  assert.deepEqual(packageJson(files, 'animations/idle.json'), authored);
  const puppet = new Puppet(puppetScene(), { definition: loaded });
  puppet.play('idle');
  puppet.sampleAnimation(500);
  assert.equal(puppet.getBone('head').pose.rotation, 0.5);
  puppet.play('second');
  puppet.sampleAnimation(500);
  assert.equal(puppet.getBone('head').pose.rotation, 0);
  puppet.destroy();
  assert.equal(JSON.stringify(definition.manifest), source);
  assert.isTrue(state.dirty, 'package export has its own checkpoint');
});

test('React bridge disables without a rig and releases subscriptions across repeated bindings', () => {
  const controller = new NewAnimationController();
  const state = new AnimationEditorState(rig());
  assert.match(controller.getSnapshot(), /valid character rig/);
  const subscribe = vi.spyOn(state, 'subscribe');
  const release = vi.fn();
  subscribe.mockReturnValue(release);
  controller.bind(state);
  controller.bind(state);
  assert.equal(release.mock.calls.length, 1);
  assert.equal(controller.getSnapshot(), '');
  assert.equal(controller.create({ name: 'idle' }), '');
  assert.match(controller.create({ name: 'idle' }), /already registered/);
  controller.unbind();
  assert.equal(release.mock.calls.length, 2);
  assert.match(controller.getSnapshot(), /valid character rig/);
  controller.dispose();
});
