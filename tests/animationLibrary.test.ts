import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationLibraryController } from '../src/devtools/animation-editor/AnimationLibraryController.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import {
  animationAssetReference,
  animationCompatibility,
  existingAnimationReference,
  filterAnimationLibrary,
  independentAnimationName,
  type AnimationLibraryEntry,
} from '../src/devtools/shared/animationLibraryData.js';
import { AnimationLibraryRuntimeScene } from '../src/devtools/shared/AnimationLibraryPreview.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import {
  buildCharacterPackage,
  loadPackageDefinition,
  type PackageFiles,
} from '../src/devtools/shared/package/characterPackage.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

test('large variation families choose the first free ID without changing the library', () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => (index ? `cut-variation-${index + 1}` : 'cut-variation'));
  assert.equal(independentAnimationName('cut', ids), 'cut-variation-10001');
  ids.splice(499, 1);
  assert.equal(independentAnimationName('cut', ids), 'cut-variation-500');
  assert.lengthOf(ids, 9999);
  assert.equal(independentAnimationName(' / ', []), 'animation-variation');
});

function fixture(mesh = false) {
  const base = {
    version: 1 as const,
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', x: 20 },
      { id: 'tip', parent: 'lower', x: 20 },
    ],
    ...(mesh ? { slots: [{ id: 'sleeve', bone: 'upper' }] } : {}),
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'tip', target: { x: 25, y: 16 }, mix: 1 }],
  };
  const attachment = createRectangleMeshAttachment(
    { id: 'paper-mesh', texture: 'paper' },
    { width: 20, height: 10 },
    base,
    'upper',
  );
  const clip: AnimationClip = {
    name: 'sword-cut',
    duration: 1000,
    loop: false,
    library: { displayName: 'Sword Cut', description: 'A short cut', tags: ['sword', 'combat'] },
    tracks: {
      lower: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0, y: 0 },
        { time: 1000, x: 80, y: 10 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 25, y: 16, mix: 0.5 },
        { time: 1000, x: 20, y: 30, mix: 1 },
      ],
    },
    events: [{ time: 300, name: 'cut', data: { nested: [1, { hit: true }] } }],
    ...(mesh
      ? {
          deformationTracks: {
            'paper-mesh': [
              { time: 0, offsets: {} },
              { time: 1000, offsets: { 'top-left': { x: 4, y: -2 } } },
            ],
          },
        }
      : {}),
  };
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'base',
      skins: { base: 'base.json' },
      animations: ['cut.json'],
      textures: mesh ? { paper: 'paper.png' } : {},
    },
    rig: { ...base, ...(mesh ? { attachments: [attachment], slots: [{ id: 'sleeve', bone: 'upper' }] } : {}) },
    skins: { 'base.json': { version: 1, name: 'base', slots: mesh ? { sleeve: 'paper-mesh' } : {} } },
    animations: { 'cut.json': { ...clip, version: 1 } },
  });
  const state = new AnimationEditorState(definition.rig, definition.animations);
  assert.isTrue(state.selectAnimation('sword-cut'));
  const controller = new AnimationLibraryController();
  controller.bind(state, 'hero');
  return { definition, state, controller };
}

test('library searches names, artist labels and tags and filters by explicit source rig identity', () => {
  const { controller } = fixture();
  const source = controller.getSnapshot().entries[0]!;
  const entries: AnimationLibraryEntry[] = [
    source,
    { ...source, character: 'friend', rigIdentity: 'friend' },
    { ...source, character: 'missing', rigIdentity: undefined },
  ];
  assert.equal(filterAnimationLibrary(entries, ' SWORD   combat ').length, 3);
  assert.equal(filterAnimationLibrary(entries, 'nothing').length, 0);
  assert.deepEqual(filterAnimationLibrary(entries, 'cut', 'hero', true), [source]);
  assert.deepEqual(filterAnimationLibrary(entries, '', undefined, true), []);
  assert.notEqual(animationAssetReference(source), animationAssetReference(entries[1]!));
  assert.equal(existingAnimationReference(source, 'hero'), 'sword-cut');
  assert.match(animationCompatibility(entries[1]!, 'hero'), /Incompatible rig identity/);
  assert.throws(() => existingAnimationReference(entries[1]!, 'hero'), /Incompatible/);
  assert.throws(() => existingAnimationReference(entries[2]!, 'hero'), /unavailable/);
  assert.throws(() => existingAnimationReference(source, undefined), /target character/);
  controller.dispose();
});

test('direct reuse and editor preview retain IDs, source snapshots, authored keys and history', () => {
  const { state, controller } = fixture();
  const before = state.workingAnimation;
  const json = state.exportJson();
  const history = state.historyLength;
  assert.isTrue(controller.select('sword-cut', true));
  state.playback.advancePlayback(0.25);
  state.playback.setPreviewLoop(true);
  state.playback.pause();
  state.playback.restart();
  assert.equal(state.exportJson(), json);
  assert.strictEqual(state.workingAnimation, before);
  assert.equal(state.historyLength, history);
  assert.deepEqual(state.animationIds, ['sword-cut']);
  assert.isFalse(controller.select('missing'));
  controller.dispose();
});

test('library notifications and inventory work stay independent of playback ticks', () => {
  const { state, controller } = fixture();
  const listener = vi.fn();
  controller.subscribe(listener);
  const inventory = vi.spyOn(state, 'packageAnimations');
  const before = controller.getSnapshot();
  state.playback.play();
  for (let index = 0; index < 5; index++) state.playback.advancePlayback(0.01);
  state.playback.pause();
  assert.strictEqual(controller.getSnapshot(), before);
  assert.equal(listener.mock.calls.length, 0);
  assert.equal(inventory.mock.calls.length, 0);
  controller.dispose();
});

test('library metadata is validated and undoable without changing the stable ID or motion', () => {
  const { state, controller } = fixture();
  const source = state.workingAnimation!;
  assert.isTrue(controller.metadata({ displayName: 'Low cut', description: 'Kneeling cut', tags: ['low'] }));
  const edited = state.workingAnimation!;
  assert.equal(edited.name, source.name);
  assert.deepEqual(edited.tracks, source.tracks);
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, source);
  assert.isTrue(state.redo());
  assert.deepEqual(state.workingAnimation, edited);
  assert.deepEqual((JSON.parse(state.exportJson()) as AnimationClip).library, edited.library);
  assert.isFalse(controller.metadata({ tags: ['x'.repeat(81)] }));
  assert.deepEqual(state.workingAnimation, edited);
  const reloaded = new AnimationEditorState(state.rig);
  assert.isTrue(reloaded.importJson(state.exportJson()));
  assert.deepEqual(reloaded.workingAnimation, edited);
  controller.dispose();
});

test('independent copies own every authored branch, including IK, root motion, mesh, metadata and event payloads', () => {
  const { state, controller } = fixture(true);
  const original = state.workingAnimation!;
  assert.isTrue(controller.copy('sword-cut'));
  const copy = state.workingAnimation!;
  assert.equal(copy.name, 'sword-cut-variation');
  assert.deepEqual(copy, { ...original, name: copy.name });
  for (const property of ['tracks', 'ikTracks', 'rootMotion', 'deformationTracks', 'events', 'library'] as const)
    assert.notStrictEqual(copy[property], original[property]);
  assert.notStrictEqual(
    copy.deformationTracks!['paper-mesh']![1]!.offsets,
    original.deformationTracks!['paper-mesh']![1]!.offsets,
  );
  assert.notStrictEqual(copy.events![0]!.data, original.events![0]!.data);
  assert.throws(() => {
    (copy.rootMotion!.translationKeys[1] as { x: number }).x = 999;
  });
  assert.isTrue(controller.metadata({ displayName: 'Independent cut' }));
  assert.isTrue(state.undo());
  assert.deepEqual(state.workingAnimation, copy);
  assert.isTrue(state.redo());
  assert.isTrue(controller.select('sword-cut'));
  assert.strictEqual(state.workingAnimation, original);
  assert.isTrue(controller.copy('sword-cut'));
  assert.equal(state.selectedAnimationId, 'sword-cut-variation-2');
  assert.isTrue(controller.select('sword-cut-variation'));
  assert.equal(state.workingAnimation!.library!.displayName, 'Independent cut');
  controller.unbind();
  assert.deepEqual(controller.getSnapshot().entries, []);
  assert.isFalse(controller.copy('sword-cut'));
});

test('isolated runtime preview plays, pauses, stops and loops actual root motion, IK and deformation', () => {
  const { definition, state, controller } = fixture(true);
  const json = state.exportJson();
  const preview = new AnimationLibraryRuntimeScene(
    definition,
    'sword-cut',
    () => {},
    () => {},
    () => {},
  );
  const puppet = new Puppet(puppetScene(), { definition, autoUpdate: false });
  puppet.posePipeline.player.setPreviewMode(true, { applyRootMotion: true });
  preview.puppet = puppet;
  const events = vi.fn();
  puppet.onAnimationEvent(events);
  try {
    preview.stopPreview();
    preview.toggle();
    preview.update(500, 500);
    assert.closeTo(puppet.container.x, 420, 1e-8);
    assert.closeTo(puppet.container.y, 440, 1e-8);
    assert.equal(puppet.posePipeline.player.ikAnimation.get('arm')!.mix!.value, 0.75);
    assert.deepEqual(puppet.posePipeline.player.meshDeformation.get('paper-mesh')!.get('top-left'), { x: 2, y: -1 });
    assert.notEqual(puppet.getBone('upper').pose.rotation, 0);
    preview.toggle();
    preview.update(700, 200);
    assert.closeTo(puppet.container.x, 420, 1e-8);
    preview.stopPreview();
    assert.closeTo(puppet.container.x, 380, 1e-8);
    preview.toggle();
    preview.update(1000, 1000);
    assert.isFalse(puppet.isPlaying);
    preview.toggle();
    preview.update(1250, 250);
    assert.isTrue(puppet.isPlaying);
    assert.closeTo(puppet.container.x, 400, 1e-8);
    preview.setLoop(true);
    preview.toggle();
    preview.update(1200, 1200);
    assert.isTrue(puppet.isPlaying);
    assert.closeTo(puppet.container.x, 476, 1e-8);
    assert.equal(events.mock.calls.length, 0);
    assert.equal(state.exportJson(), json);
    assert.equal(state.historyLength, 0);
  } finally {
    puppet.destroy();
    controller.dispose();
  }
});

test('project inventory, character packages, scene references and autosave recovery share one clip asset', async () => {
  const { definition, state, controller } = fixture();
  const files = await buildCharacterPackage({
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: state.packageAnimations(),
    replacements: [],
  });
  const loaded = await loadPackageDefinition(files);
  assert.deepEqual(loaded.animations[0]!.library, state.workingAnimation!.library);
  const project = new ProjectWorkspace('Library Film');
  await project.addCharacter(files);
  project.character('hero').capture = () => ({
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: state.packageAnimations(),
    replacements: [],
  });
  const beforeRevision = project.autosaveRevision;
  assert.isTrue(controller.metadata({ displayName: 'Sword Cut final', tags: ['sword'] }));
  assert.notEqual(project.autosaveRevision, beforeRevision);
  assert.strictEqual(project.animationLibrary()[0]!.clip, state.workingAnimation);
  assert.isTrue(controller.copy('sword-cut'));
  const reference = project.characterReference('hero');
  const sceneId = project.addScene({
    ...createEmptyScene({ id: 'opening' }),
    actors: [
      { id: 'hero-a', character: { manifest: reference }, position: { x: 0, y: 0 }, animation: 'sword-cut' },
      { id: 'hero-b', character: { manifest: reference }, position: { x: 100, y: 0 }, animation: 'sword-cut' },
    ],
    actions: [
      {
        id: 'cut',
        type: 'animation',
        actorId: 'hero-a',
        time: 250,
        animation: 'sword-cut-variation',
        duration: 1000,
        speed: 1,
        loop: false,
        movementSource: 'rootMotion',
      },
    ],
  });
  assert.equal(
    project
      .dependents({ kind: 'animation', owner: 'hero', id: 'sword-cut' })
      .filter(({ from }) => from.kind === 'actor').length,
    2,
  );
  assert.throws(() => project.remove('characters', 'hero'), /used by scenes/);
  const action = project.scenes.scene(sceneId)!.actions[0]!;
  assert.equal(action.type, 'animation');
  if (action.type !== 'animation') throw new Error('Expected animation action');
  assert.isTrue(
    project.scenes.updateAction(action.id, {
      ...action,
      animation: existingAnimationReference(project.animationLibrary()[0]!, 'hero'),
    }),
  );
  assert.equal(project.scenes.scene(sceneId)!.actions[0]!.time, 250);
  assert.deepInclude(project.scenes.scene(sceneId)!.actions[0], { movementSource: 'rootMotion' });
  assert.isTrue(project.scenes.undo());
  assert.deepEqual(project.scenes.scene(sceneId)!.actions[0], action);
  assert.isTrue(project.scenes.redo());
  let saved: PackageFiles | undefined;
  const autosave = new LocalAutosave(
    'library-project',
    {
      claim: async () => {},
      release: async () => {},
      discard: async () => {},
      save: async (_key, _owner, _name, _revision, files) => {
        saved = files;
      },
    },
    () => ({
      revision: project.autosaveRevision!,
      name: project.definition.name,
      dirty: project.hasUnsavedChanges,
      build: async (signal) => (await buildProjectPackage(project, signal)).files,
    }),
  );
  try {
    await autosave.flush();
    assert.isDefined(saved);
    const restored = await importProjectPackage(decodePackageZip(encodePackageZip(saved)));
    assert.deepEqual(
      restored.animationLibrary().map(({ character, clip }) => [character, clip.name, clip.library]),
      project.animationLibrary().map(({ character, clip }) => [character, clip.name, clip.library]),
    );
    assert.equal(restored.captureCharacter('hero').animations.length, 2);
    assert.deepEqual(restored.scenes.scene(sceneId), project.scenes.scene(sceneId));
    assert.equal(restored.inspect('export').issues.filter((issue) => issue.severity === 'error').length, 0);
    const exported = await buildProjectPackage(restored);
    const imported = await importProjectPackage(exported.files);
    assert.equal(imported.animationLibrary().length, 2);
  } finally {
    autosave.dispose();
    controller.dispose();
  }
});
