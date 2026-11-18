import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { createAnimationVariation } from '../src/devtools/animation-editor/animationVariation.js';
import { AnimationVariationController } from '../src/devtools/animation-editor/AnimationVariationController.js';
import { graphKeys } from '../src/devtools/animation-editor/graphEditor.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { createBoneSymmetryMapping, inferBoneSymmetryPairs } from '../src/devtools/shared/boneSymmetry.js';
import { buildCharacterPackage, loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { AnimationStateController } from '../src/engine/AnimationStateController.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { evaluateIKClip } from '../src/engine/ik/AnimationIKPose.js';
import { Joint } from '../src/engine/Joint.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { ikBakeEditor, waitForIKBake } from './helpers/ikBakeEditor.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rigData = {
  version: 1 as const,
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'arm_L', parent: 'root', x: -10 },
    { id: 'elbow_L', parent: 'arm_L', y: 10 },
    { id: 'hand_L', parent: 'elbow_L', y: 10 },
    { id: 'arm_R', parent: 'root', x: 10 },
    { id: 'elbow_R', parent: 'arm_R', y: 10 },
    { id: 'hand_R', parent: 'elbow_R', y: 10 },
  ],
  ik: [{ name: 'reach', rootBone: 'arm_L', middleBone: 'elbow_L', endBone: 'hand_L' }],
};
const curve = { mode: 'bezier' as const, control1: { x: 0.2, y: 0.4 }, control2: { x: 0.7, y: 0.9 } };
function fixture() {
  const rig = new Rig(rigData);
  const source: AnimationClip = {
    name: 'attack-basic',
    duration: 1000,
    loop: false,
    interpolation: 'linear',
    playback: { mode: 'smooth' },
    tracks: {
      arm_L: [
        { time: 0, rotation: 0.1, curves: { rotation: curve } },
        { time: 250, rotation: 0.4, curves: { rotation: { mode: 'stepped' } } },
        { time: 1000, rotation: 0.8 },
      ],
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 20 },
      ],
    },
    ikTracks: {
      reach: [
        { time: 0, x: 10, y: 15, mix: 0.5, curves: { x: curve } },
        { time: 1000, x: 20, y: 5, mix: 1 },
      ],
    },
    disabledIKConstraints: ['reach'],
    events: [
      { time: 0, name: 'start' },
      { time: 250, name: 'impact', data: { nested: [{ damage: 2 }], text: 'attack' } },
      { time: 1000, name: 'end' },
    ],
  };
  const state = new AnimationEditorState(rig, [source]);
  assert.isTrue(state.selectAnimation(source.name));
  return { state, rig, source };
}

test('variation owns every authored branch and preserves curves, events, settings and baked IK suppression', () => {
  const { state, source } = fixture();
  const before = JSON.stringify(source);
  const original = state.workingAnimation!;
  const revision = state.sessionRevision;
  state.setBonePropertyKeyframe('root', 'y', 5);
  const authored = state.workingAnimation!;
  const listener = vi.fn();
  state.subscribe(listener);
  assert.isTrue(state.createVariation({ name: 'attack-heavy' }));
  const variation = state.workingAnimation!;
  assert.deepEqual(variation, { ...authored, name: 'attack-heavy' });
  assert.notStrictEqual(variation.tracks, authored.tracks);
  assert.notStrictEqual(variation.tracks.arm_L, authored.tracks.arm_L);
  assert.notStrictEqual(variation.tracks.arm_L![0]!.curves!.rotation, authored.tracks.arm_L![0]!.curves!.rotation);
  assert.notStrictEqual(variation.ikTracks!.reach, authored.ikTracks!.reach);
  assert.notStrictEqual(variation.events![1]!.data, authored.events![1]!.data);
  assert.notStrictEqual(variation.disabledIKConstraints, authored.disabledIKConstraints);
  const copiedCurve = variation.tracks.arm_L![0]!.curves!.rotation!;
  assert.equal(copiedCurve.mode, 'bezier');
  if (copiedCurve.mode === 'bezier') assert.isTrue(Object.isFrozen(copiedCurve.control1));
  assert.isTrue(Object.isFrozen(variation.events![1]!.data));
  assert.isTrue(state.isNewAnimation());
  assert.isTrue(state.dirty);
  assert.isFalse(state.canUndo);
  assert.equal(state.sessionRevision, revision + 1);
  assert.equal(listener.mock.calls.length, 1);
  assert.equal(JSON.stringify(source), before);
  assert.notDeepEqual(authored, original);
  state.selectAnimation('attack-basic', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, authored);
  assert.equal(state.historyLength, 1);
  state.undo();
  assert.deepEqual(state.workingAnimation, original);
  state.redo();
  assert.deepEqual(state.workingAnimation, authored);
});

test.each([0.5, 1, 2, 1.23456789])(
  'whole-clip scale %s preserves property sampling, every event and normalized curves',
  (scale) => {
    const { state, rig } = fixture();
    const source = state.workingAnimation!;
    const variation = createAnimationVariation(source, rig, { name: 'scaled', timeScale: scale });
    assert.equal(variation.duration, source.duration * scale);
    assert.deepEqual(
      variation.tracks.arm_L!.map((key) => key.time),
      [0, 250 * scale, 1000 * scale],
    );
    assert.deepEqual(
      variation.ikTracks!.reach!.map((key) => key.time),
      [0, 1000 * scale],
    );
    assert.deepEqual(
      variation.events!.map((event) => event.time),
      [0, 250 * scale, 1000 * scale],
    );
    assert.deepEqual(variation.events![1]!.data, source.events![1]!.data);
    assert.deepEqual(variation.playback, source.playback);
    const original = compileClip({ ...source, disabledIKConstraints: [] }, rig),
      copy = compileClip({ ...variation, disabledIKConstraints: [] }, rig);
    for (const time of [0, 83.75, 200, 250, 750, 1000]) {
      assert.closeTo(
        evaluateClip(original, time).get('arm_L')!.rotation!,
        evaluateClip(copy, time * scale).get('arm_L')!.rotation!,
        1e-12,
      );
      assert.closeTo(
        evaluateIKClip(original, time).get('reach')!.x!.value,
        evaluateIKClip(copy, time * scale).get('reach')!.x!.value,
        1e-12,
      );
    }
  },
);

test.each([0, -1, NaN, Infinity, Number.MAX_VALUE])(
  'invalid scale %s leaves documents and histories intact',
  (timeScale) => {
    const { state } = fixture();
    state.setBonePropertyKeyframe('root', 'y', 2);
    const before = state.workingAnimation,
      ids = state.animationIds,
      revision = state.sessionRevision;
    assert.isFalse(state.createVariation({ name: 'invalid', timeScale }));
    assert.strictEqual(state.workingAnimation, before);
    assert.strictEqual(state.animationIds, ids);
    assert.equal(state.sessionRevision, revision);
    assert.equal(state.historyLength, 1);
    assert.isNotEmpty(state.validationIssues);
  },
);

test('missing source, invalid names and duplicate IDs reject atomically', () => {
  assert.isFalse(new AnimationEditorState().createVariation({ name: 'absent' }));
  const { state } = fixture();
  const original = state.workingAnimation;
  for (const name of ['attack-basic', '', 'with spaces', '../bad', '__proto__']) {
    assert.isFalse(state.createVariation({ name }));
    assert.strictEqual(state.workingAnimation, original);
    assert.deepEqual(state.animationIds, ['attack-basic']);
  }
});

test('time scaling rejects distinct keys that collapse at floating-point precision', () => {
  const { state, rig } = fixture();
  const original = {
    ...state.workingAnimation!,
    tracks: {
      root: [
        { time: 1, x: 0 },
        { time: 1.1, x: 1 },
      ],
    },
  };
  assert.throws(
    () => createAnimationVariation(original, rig, { name: 'tiny', timeScale: Number.MIN_VALUE }),
    /precision/,
  );
  assert.deepEqual(
    original.tracks.root.map((key) => key.time),
    [1, 1.1],
  );
});

test('stepped playback retains FPS, sparse settings and event-free clips without inventing fields', () => {
  const { rig } = fixture();
  const state = new AnimationEditorState(rig, [
    { name: 'stepped', duration: 1000, loop: true, tracks: {}, playback: { mode: 'stepped', fps: 17 } },
  ]);
  state.selectAnimation('stepped');
  assert.isTrue(state.createVariation({ name: 'stepped-slow', timeScale: 2 }));
  assert.deepEqual(state.workingAnimation, {
    version: 1,
    name: 'stepped-slow',
    duration: 2000,
    loop: true,
    tracks: {},
    playback: { mode: 'stepped', fps: 17 },
  });
});

test('imported source names outside the creation convention still receive a usable unique suggestion', () => {
  const { state } = fixture();
  assert.isTrue(state.importJson(JSON.stringify({ ...state.workingAnimation, name: '$ Attack!' })));
  const controller = new AnimationVariationController();
  controller.bind(state);
  const name = controller.begin();
  assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
  assert.equal(controller.create({ name }), '');
  controller.dispose();
});

test('preview scrubs the real canvas evaluator without authored clocks, event delivery, registration or history', () => {
  const { state, rig } = fixture();
  const puppet = new Puppet(puppetScene(), { rig });
  const preview = new AnimationEditorPreview(state, puppet);
  const controller = new AnimationVariationController();
  controller.bind(state);
  state.setCurrentTime(0.2);
  const original = state.workingAnimation!,
    json = state.exportJson(),
    pose = puppet.getBone('root').pose.x;
  const events = vi.fn();
  state.onAnimationEvent(events);
  assert.equal(controller.begin(), 'attack-basic-variation');
  assert.equal(controller.preview({ name: 'heavy', timeScale: 2 }, 0.75), '');
  assert.equal(state.previewTimeMilliseconds, 1500);
  assert.equal(puppet.getBone('root').pose.x, 15);
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.exportJson(), json);
  assert.equal(state.currentTime, 0.2);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.deepEqual(state.animationIds, ['attack-basic']);
  assert.equal(events.mock.calls.length, 0);
  controller.cancel();
  assert.strictEqual(state.previewAnimation, original);
  assert.equal(puppet.getBone('root').pose.x, pose);
  assert.match(controller.create({ name: 'cancelled' }), /Reopen/);
  controller.begin();
  assert.equal(controller.preview({ name: 'heavy', timeScale: 0 }, 0.5).includes('greater than zero'), true);
  assert.strictEqual(state.previewAnimation, original);
  assert.equal(controller.create({ name: 'heavy', timeScale: 2 }), '');
  assert.equal(state.selectedAnimationId, 'heavy');
  assert.equal(state.currentTime, 0);
  assert.equal(puppet.getBone('root').pose.x, 0);
  controller.dispose();
  preview.dispose();
  puppet.destroy();
});

test.each(['edit', 'selection', 'mode', 'rig', 'undo', 'unbind'])(
  'preview and stale dialog proposals are discarded on %s',
  (action) => {
    const { state } = fixture();
    state.setBonePropertyKeyframe('root', 'y', 2);
    const controller = new AnimationVariationController();
    controller.bind(state);
    controller.begin();
    controller.preview({ name: 'proposed' }, 0.5);
    switch (action) {
      case 'edit':
        state.setBonePropertyKeyframe('root', 'y', 3);
        break;
      case 'selection':
        state.selectAnimation('attack-basic', { keepChanges: true });
        break;
      case 'mode':
        state.setEditorMode('rig-tweak');
        break;
      case 'rig':
        state.updatePreviewRig(new Rig(rigData));
        break;
      case 'undo':
        state.undo();
        break;
      case 'unbind':
        controller.unbind();
        break;
    }
    assert.strictEqual(state.previewAnimation, state.workingAnimation);
    assert.isNotEmpty(controller.create({ name: 'stale' }));
    assert.deepEqual(state.animationIds, ['attack-basic']);
    controller.dispose();
  },
);

test('variations retain independent Graph Editor, Pose Library, mirroring, IK and Undo/Redo workflows', () => {
  const { state, rig } = fixture();
  assert.isTrue(
    state.setSymmetryMapping(
      createBoneSymmetryMapping(rig, { automaticCandidates: inferBoneSymmetryPairs(rig).pairs }).mapping!,
    ),
  );
  const original = state.workingAnimation!;
  state.createVariation({ name: 'heavy' });
  const baseline = state.workingAnimation!;
  const ref = { channel: { kind: 'bone' as const, id: 'arm_L', property: 'rotation' as const }, time: 0 };
  assert.lengthOf(graphKeys(baseline, ref.channel), 3);
  assert.isTrue(state.editGraphKey(ref, { value: 45, curve: { mode: 'linear' } }));
  const edited = state.workingAnimation;
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation, baseline);
  assert.isTrue(state.redo());
  assert.deepEqual(state.workingAnimation, edited);
  const pose = state.saveCurrentPose('Heavy attack');
  state.setCurrentTime(0.5);
  assert.isTrue(state.applyLibraryPose(pose));
  assert.isTrue(state.ik.setIKPropertyKeyframe('reach', 'x', 25));
  assert.isTrue(state.mirrorCurrentPoseToKeys('left-to-right', { boneIds: ['arm_L'], properties: ['rotation'] }));
  const first = state.workingAnimation!;
  assert.isTrue(state.createVariation({ name: 'heavy-final', timeScale: 0.5 }));
  assert.deepEqual(state.animationIds, ['attack-basic', 'heavy', 'heavy-final']);
  assert.isFalse(state.canUndo);
  state.selectAnimation('heavy', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, first);
  assert.isTrue(state.canUndo);
  state.selectAnimation('attack-basic', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.canUndo);
  state.setBonePropertyKeyframe('root', 'y', 100);
  state.selectAnimation('heavy', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, first, 'later source edits do not propagate');
});

test('ordinary IK baking commits on a variation and carries suppression into another independent variation', async () => {
  const { state, controller } = ikBakeEditor();
  const original = state.workingAnimation!;
  state.createVariation({ name: 'bake-variation' });
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.commit());
  const baked = state.workingAnimation!;
  assert.include(baked.disabledIKConstraints!, 'arm');
  assert.isTrue(state.undo());
  assert.isUndefined(state.workingAnimation!.disabledIKConstraints);
  assert.isTrue(state.redo());
  state.createVariation({ name: 'baked-slower', timeScale: 2 });
  assert.deepEqual(state.workingAnimation!.disabledIKConstraints, baked.disabledIKConstraints);
  assert.equal(state.workingAnimation!.tracks.upper!.length, baked.tracks.upper!.length);
  assert.equal(state.workingAnimation!.tracks.upper!.at(-1)!.time, 2000);
  state.selectAnimation('reach', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, original);
  controller.dispose();
});

test('runtime queue and animation states resolve variation IDs as ordinary clips', () => {
  const { state, rig } = fixture();
  state.createVariation({ name: 'heavy', timeScale: 2 });
  const player = new AnimationPlayer(rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)])));
  for (const clip of state.packageAnimations()) player.addAnimation(clip);
  player.queue('attack-basic');
  player.queue('heavy');
  player.update(1000);
  assert.equal(player.currentAnimation, 'heavy');
  const controller = new AnimationStateController(player, {
    initialState: 'basic',
    states: { basic: { animation: 'attack-basic' }, heavy: { animation: 'heavy' } },
  });
  controller.setState('heavy');
  assert.equal(player.currentAnimation, 'heavy');
  assert.equal(controller.currentState, 'heavy');
  controller.dispose();
  player.dispose();
});

test('bridge suggests unique names, keeps one subscription and refuses unfinished source gestures', () => {
  const { state } = fixture();
  const controller = new AnimationVariationController();
  const release = vi.fn();
  const subscribe = vi.spyOn(state, 'subscribe').mockReturnValue(release);
  controller.bind(state);
  controller.bind(state);
  assert.equal(release.mock.calls.length, 1);
  subscribe.mockRestore();
  controller.bind(state);
  const name = controller.begin();
  controller.create({ name });
  state.selectAnimation('attack-basic', { keepChanges: true });
  assert.equal(controller.begin(), 'attack-basic-variation-2');
  state.selectBone('root');
  state.setTemporaryBoneProperty('x', 50);
  assert.match(controller.getSnapshot().reason, /temporary edits/);
  assert.isFalse(state.createVariation({ name: 'unfinished' }));
  assert.notInclude(state.animationIds, 'unfinished');
  controller.dispose();
});

test('variation JSON, character ZIP, project ZIP and Scene Editor animation references round trip', async () => {
  const { state } = fixture();
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'base',
      skins: { base: 'skin.json' },
      textures: {},
      animations: [],
    },
    rig: rigData,
    skins: { 'skin.json': { version: 1, name: 'base', slots: {} } },
  });
  state.createVariation({ name: 'heavy', timeScale: 2 });
  const variation = state.workingAnimation!;
  const reloaded = new AnimationEditorState(definition.rig);
  assert.isTrue(reloaded.importJson(state.exportJson()));
  assert.deepEqual(reloaded.workingAnimation, variation);
  state.createVariation({ name: 'heavy-final' });
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
  const loaded = await loadPackageDefinition(files);
  assert.deepEqual(
    loaded.animations.map((clip) => clip.name),
    ['attack-basic', 'heavy', 'heavy-final'],
  );
  const project = new ProjectWorkspace('Variations');
  await project.addCharacter(files);
  const scene = new SceneEditorDocument();
  assert.isTrue(
    scene.importJson(
      JSON.stringify({
        ...createEmptyScene({ id: 'attack-scene' }),
        actors: [{ id: 'hero', character: { manifest: project.characterReference('hero') }, position: { x: 0, y: 0 } }],
        actions: [
          {
            id: 'attack',
            type: 'animation',
            actorId: 'hero',
            time: 0,
            animation: 'heavy',
            duration: 2000,
            speed: 1,
            loop: false,
          },
        ],
      }),
    ),
  );
  project.addScene(scene.workingScene!);
  const packed = await buildProjectPackage(project);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(packed.files)));
  assert.deepEqual(restored.character('hero').definition.animations, loaded.animations);
  const puppet = new Puppet(puppetScene(), { definition: restored.character('hero').definition });
  puppet.play('heavy');
  puppet.sampleAnimation(1500);
  assert.equal(puppet.getBone('root').pose.x, 15);
  puppet.play('attack-basic');
  puppet.sampleAnimation(750);
  assert.equal(puppet.getBone('root').pose.x, 15);
  puppet.destroy();
});
