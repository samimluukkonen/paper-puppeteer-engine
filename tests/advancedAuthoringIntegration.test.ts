import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationVariationController } from '../src/devtools/animation-editor/AnimationVariationController.js';
import { DEFAULT_GRAPH_CURVE } from '../src/devtools/animation-editor/graphEditor.js';
import { MotionDiagnosticsController } from '../src/devtools/animation-editor/MotionDiagnosticsController.js';
import { PoseLibraryController } from '../src/devtools/animation-editor/PoseLibraryController.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { buildCharacterPackage, loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import { Actor } from '../src/engine/Actor.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rigData = { version: 1 as const, root: 'root', bones: [{ id: 'root' }, { id: 'free', parent: 'root' }] };
function fixture() {
  const rig = new Rig(rigData);
  const state = new AnimationEditorState(rig, [
    {
      name: 'source',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 20 },
        ],
        free: [
          { time: 0, x: 0 },
          { time: 500, x: 5 },
          { time: 1000, x: 10 },
        ],
      },
      events: [{ time: 250, name: 'impact', data: { values: [1, 2] } }],
    },
  ]);
  state.selectAnimation('source');
  const diagnostics = new MotionDiagnosticsController();
  diagnostics.bind(state);
  return { rig, state, diagnostics };
}

test('pose, variation and cleanup previews hand off one canvas clock and playback restores authored motion', () => {
  const { rig, state, diagnostics } = fixture();
  const puppet = new Puppet(puppetScene(), { rig });
  const preview = new AnimationEditorPreview(state, puppet);
  state.setCurrentTime(1);
  const pose = state.saveCurrentPose('End', ['free']);
  state.setCurrentTime(0.25);
  const authored = state.workingAnimation;
  const events = vi.fn();
  state.onAnimationEvent(events);
  state.previewVariation({ name: 'temporary', timeScale: 2 }, 0.75);
  assert.equal(state.previewTimeMilliseconds, 1500);
  assert.isTrue(state.previewLibraryPose(pose));
  assert.strictEqual(state.previewAnimation, authored);
  assert.equal(state.previewTimeMilliseconds, 250, 'pose preview releases the variation clock');
  assert.equal(puppet.getBone('free').pose.x, 10);
  diagnostics.run();
  assert.isTrue(diagnostics.previewCleanup());
  assert.isNull(state.previewedPose);
  state.previewVariation({ name: 'temporary' }, 0.75);
  assert.isNull(diagnostics.getSnapshot().preview);
  assert.isTrue(state.previewLibraryPose(pose));
  state.play();
  assert.isNull(state.previewedPose, 'playback must show authored motion instead of a held library pose');
  assert.equal(puppet.getBone('free').pose.x, 2.5);
  state.advancePlayback(0.25);
  assert.equal(puppet.getBone('free').pose.x, 5);
  state.pause();
  assert.strictEqual(state.workingAnimation, authored);
  assert.isFalse(state.canUndo);
  assert.lengthOf(events.mock.calls, 0);
  diagnostics.dispose();
  preview.dispose();
  puppet.destroy();
});

test('cleanup comparison synchronizes the selected IK inspector with the same preview time', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'mid', parent: 'root', x: 10 },
      { id: 'tip', parent: 'mid', x: 10 },
      { id: 'free', parent: 'root' },
    ],
    ik: [{ name: 'reach', rootBone: 'root', middleBone: 'mid', endBone: 'tip' }],
  });
  const state = new AnimationEditorState(rig, [
    {
      name: 'motion',
      duration: 1000,
      loop: false,
      tracks: {
        free: [
          { time: 0, x: 0 },
          { time: 500, x: 5 },
          { time: 1000, x: 10 },
        ],
      },
      ikTracks: {
        reach: [
          { time: 0, x: 0 },
          { time: 1000, x: 20 },
        ],
      },
    },
  ]);
  state.selectAnimation('motion');
  state.selectIKConstraint('reach');
  const controller = new MotionDiagnosticsController();
  controller.bind(state);
  controller.run();
  controller.previewCleanup();
  controller.compare(750, true);
  assert.equal(state.selectedIKTargetValues!.x, 15);
  controller.compare(500, false);
  assert.equal(state.selectedIKTargetValues!.x, 10);
  controller.cancel();
  assert.equal(state.selectedIKTargetValues!.x, 0);
  controller.dispose();
});

test('library bridge ignores clocks and invalidates on immutable rig/library changes without scanning all poses', () => {
  const { state, diagnostics } = fixture();
  const id = state.saveCurrentPose('Pose');
  const library = new PoseLibraryController();
  library.bind(state);
  const compatibility = vi.spyOn(state.poseLibrary, 'compatibility');
  const changed = vi.fn();
  library.subscribe(changed);
  const version = library.getSnapshot();
  for (let i = 0; i < 100; i++) state.setCurrentTime(i / 100);
  assert.equal(library.getSnapshot(), version);
  assert.equal(compatibility.mock.calls.length, 0);
  assert.equal(changed.mock.calls.length, 0);
  state.updatePreviewRig(new Rig({ ...rigData, bones: [{ id: 'root' }, { id: 'free', parent: 'root', x: 4 }] }));
  assert.isAbove(library.getSnapshot(), version);
  assert.match(state.poseLibrary.compatibility(id, state.rig)!, /bind transforms/);
  assert.isFalse(state.previewLibraryPose(id));
  assert.isFalse(state.applyLibraryPose(id));
  const afterRig = library.getSnapshot();
  state.poseLibrary.rename(id, 'Renamed');
  assert.isAbove(library.getSnapshot(), afterRig);
  library.unbind();
  const unbound = library.getSnapshot();
  state.poseLibrary.undo();
  assert.equal(library.getSnapshot(), unbound);
  library.bind(state);
  library.dispose();
  diagnostics.dispose();
});

test('repeated character/project owner replacement releases subscriptions and every temporary proposal', () => {
  const owners = [fixture(), fixture()];
  let active = 0;
  for (const { state, diagnostics } of owners) {
    diagnostics.dispose();
    const subscribe = state.subscribe.bind(state);
    vi.spyOn(state, 'subscribe').mockImplementation((listener) => {
      active++;
      const release = subscribe(listener);
      return () => {
        active--;
        release();
      };
    });
    state.saveCurrentPose('Pose');
  }
  const library = new PoseLibraryController();
  const diagnostics = new MotionDiagnosticsController();
  const variation = new AnimationVariationController();
  for (let index = 0; index < 12; index++) {
    const state = owners[index % 2]!.state;
    library.bind(state);
    diagnostics.bind(state);
    variation.bind(state);
    assert.equal(active, 3);
    diagnostics.run();
    diagnostics.previewCleanup();
    variation.begin();
    variation.preview({ name: 'temporary', timeScale: 2 }, 0.75);
    state.previewLibraryPose(state.poseLibrary.poses[0]!.id);
    library.unbind();
    diagnostics.unbind();
    variation.unbind();
    assert.equal(active, 0);
    assert.isNull(state.previewedPose);
    assert.isNull(diagnostics.getSnapshot().preview);
    assert.isNull(diagnostics.getSnapshot().report);
    assert.strictEqual(state.previewAnimation, state.workingAnimation);
    assert.match(variation.create({ name: 'stale' }), /Select a valid source/);
    assert.isFalse(state.canUndo);
    assert.deepEqual(state.animationIds, ['source']);
  }
  library.dispose();
  diagnostics.dispose();
  variation.dispose();
  assert.equal(active, 0);
});

test('pose → graph → independent variation → cleanup → package/CharacterLoader → SceneRunner round trip', async () => {
  const { state, diagnostics } = fixture();
  state.setCurrentTime(0.5);
  const pose = state.saveCurrentPose('Middle', ['free']);
  state.setCurrentTime(0.5);
  assert.isTrue(state.applyLibraryPose(pose));
  const applied = state.workingAnimation;
  state.undo();
  state.redo();
  assert.deepEqual(state.workingAnimation, applied);
  const ref = { channel: { kind: 'bone', id: 'root', property: 'x' } as const, time: 0 };
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0 });
  state.beginGraphEdit(ref);
  state.previewGraphEdit({ curve: DEFAULT_GRAPH_CURVE });
  assert.isUndefined(state.workingAnimation!.tracks.root![0]!.curves);
  assert.isTrue(state.commitGraphEdit());
  const source = state.workingAnimation!;
  state.createVariation({ name: 'variant', timeScale: 2 });
  state.setBonePropertyKeyframe('root', 'y', 7, 0);
  diagnostics.run();
  const candidates = diagnostics.getSnapshot().report!.candidates;
  assert.isNotEmpty(candidates);
  assert.isTrue(candidates.every((key) => key.boneId === 'free'));
  const before = state.workingAnimation!;
  assert.isTrue(diagnostics.previewCleanup());
  assert.strictEqual(state.workingAnimation, before);
  assert.isTrue(diagnostics.apply());
  const cleaned = state.workingAnimation!;
  state.undo();
  assert.deepEqual(state.workingAnimation, before);
  state.redo();
  assert.deepEqual(state.workingAnimation, cleaned);
  const json = state.exportJson();
  state.selectAnimation('source', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, source);
  state.selectAnimation('variant', { keepChanges: true });
  assert.isTrue(state.importJson(json, { confirmDiscard: () => true }));
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
  const files = decodePackageZip(
    encodePackageZip(
      await buildCharacterPackage({
        definition,
        rig: rigData,
        skins: definition.standaloneSkins,
        animations: state.packageAnimations(),
        poses: state.poseLibrary.packagePoses(),
        replacements: [],
      }),
    ),
  );
  const loaded = await loadPackageDefinition(files); // Uses the ordinary CharacterLoader.
  assert.deepEqual({ version: 1, ...loaded.animations.find((clip) => clip.name === 'variant') }, cleaned);
  assert.lengthOf(loaded.poses, 1);
  const project = new ProjectWorkspace('Advanced authoring');
  await project.addCharacter(files);
  const document = new SceneEditorDocument();
  assert.isTrue(
    document.importJson(
      JSON.stringify({
        ...createEmptyScene({ id: 'scene' }),
        duration: 2000,
        actors: [{ id: 'hero', character: { manifest: project.characterReference('hero') }, position: { x: 0, y: 0 } }],
        actions: [
          {
            id: 'clip',
            type: 'animation',
            actorId: 'hero',
            time: 0,
            animation: 'variant',
            duration: 2000,
            speed: 1,
            loop: false,
          },
        ],
      }),
    ),
  );
  project.addScene(document.workingScene!);
  const restored = await importProjectPackage(
    decodePackageZip(encodePackageZip((await buildProjectPackage(project)).files)),
  );
  const puppets: Puppet[] = [];
  const runner = new SceneRunner(restored.scenes.scene('scene')!, {
    createActor: () => {
      const puppet = new Puppet(puppetScene(), {
        definition: restored.character('hero').definition,
        autoUpdate: false,
      });
      puppets.push(puppet);
      return new Actor({ id: 'hero', puppet, puppetOwnership: 'owned' });
    },
  });
  runner.seek(500);
  assert.closeTo(puppets.at(-1)!.getBone('root').pose.x, 3.125, 1e-6);
  assert.equal(puppets.at(-1)!.getBone('root').pose.y, 7);
  runner.seek(1500);
  assert.closeTo(puppets.at(-1)!.getBone('root').pose.x, 16.875, 1e-6);
  runner.dispose();
  assert.isTrue(puppets.every((puppet) => puppet.isDestroyed));
  diagnostics.dispose();
});
