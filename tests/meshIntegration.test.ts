import { assert, test, vi } from 'vitest';
import { AnimationPoseOverlay } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { createCharacterDocuments } from '../src/devtools/animation-editor/characterDocuments.js';
import { DEFAULT_ONION_SKIN_SETTINGS } from '../src/devtools/animation-editor/onionSkinSettings.js';
import { assetDependents, ProjectInspector } from '../src/devtools/project/projectInspection.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneActorPreview } from '../src/devtools/scene-editor/SceneActorPreview.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { buildCharacterPackage, validatePackage } from '../src/devtools/shared/package/characterPackage.js';
import { Actor } from '../src/engine/Actor.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { subdivideMeshEdge } from '../src/engine/meshEditing.js';
import { Puppet } from '../src/engine/Puppet.js';
import type { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture() {
  const base: RigDefinition = {
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', x: 20 },
      { id: 'tip', parent: 'lower', x: 20 },
    ],
    slots: [
      { id: 'sleeve', bone: 'upper', depth: 1 },
      { id: 'front', bone: 'lower', depth: 30 },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'tip', target: { x: 25, y: 15 }, mix: 1 }],
  };
  let mesh = createRectangleMeshAttachment(
    { id: 'cloth', texture: 'paper', scaleX: 20, scaleY: 10 },
    { width: 1, height: 1 },
    base,
    'upper',
  );
  mesh = {
    ...mesh,
    vertices: mesh.vertices.map((v) => ({
      ...v,
      influences: [
        { boneId: 'upper', weight: 0.4 },
        { boneId: 'lower', weight: 0.6 },
      ],
    })),
  };
  mesh = subdivideMeshEdge(mesh, 0, 2, base);
  const definition = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skins/default.json' },
      animations: [],
      textures: { paper: 'images/paper.png' },
    },
    skins: { 'skins/default.json': { version: 1, name: 'default', slots: { sleeve: 'cloth', front: 'rigid' } } },
    rig: {
      version: 1,
      ...base,
      attachments: [mesh, { id: 'rigid', texture: 'paper' }],
      skins: [
        { version: 1, name: 'rigid', slots: { sleeve: 'rigid', front: 'rigid' } },
        { version: 1, name: 'layered', slots: { sleeve: 'cloth', front: 'cloth' } },
      ],
    },
  });
  const documents = createCharacterDocuments(definition);
  const { rig, animation } = documents;
  rig.selectSlot('sleeve');
  rig.moveMeshVertex('top-left', -0.6, -0.5);
  rig.undo();
  rig.redo();
  animation.updatePreviewRig(new Rig({ ...rig.workingCopy, skins: rig.skins }));
  assert.isTrue(animation.createAnimation({ name: 'bend', durationSeconds: 1, loop: false }));
  animation.selectDeformation('cloth');
  animation.setMeshOffsets({ 'top-left': { x: 0, y: 0 } });
  animation.setCurrentTime(0.5);
  animation.setMeshOffsets({ 'top-left': { x: 0.3, y: -0.2 }, [mesh.vertices.at(-1)!.id]: { x: 0.1, y: 0.2 } });
  animation.setCurrentTime(1);
  animation.setMeshOffsets({ 'top-left': { x: 0, y: 0 }, [mesh.vertices.at(-1)!.id]: { x: 0, y: 0 } });
  animation.keyframes.setBonePropertyKeyframe('lower', 'rotation', 0, 0);
  animation.keyframes.setBonePropertyKeyframe('lower', 'rotation', 0.8, 1);
  animation.rootMotion.setRootPosition({ x: 0, y: 0 }, 0);
  animation.rootMotion.setRootPosition({ x: 40, y: 10 }, 1);
  const image = artworkFixture().documents['images/paper.png'];
  assert.instanceOf(image, Uint8Array);
  const files = new Map([['images/paper.png', image]]);
  const snapshot = {
    definition,
    rig: rig.recoveryDraft,
    skins: definition.standaloneSkins,
    animations: animation.packageAnimations(),
    replacements: [],
  };
  return { ...documents, definition, snapshot, files, mesh };
}

test('live rig edits and history protect deformation attachment/vertex dependencies atomically', () => {
  const { rig, animation, mesh } = fixture();
  const before = rig.exportJson(false);
  const history = rig.historyLength;
  rig.selectedMeshVertexId = mesh.vertices.at(-1)!.id;
  assert.throws(() => rig.deleteSelectedMeshVertex(), /invalidate.*animation.*bend/);
  assert.equal(rig.exportJson(false), before);
  assert.equal(rig.historyLength, history);
  const invalidDraft = structuredClone(rig.createRecoveryDraft());
  invalidDraft.rig.attachments = invalidDraft.rig.attachments!.map((attachment) =>
    attachment.type === 'mesh'
      ? {
          ...attachment,
          vertices: attachment.vertices.map((vertex, index) =>
            index === 0 ? { ...vertex, id: 'replacement' } : vertex,
          ),
        }
      : attachment,
  );
  assert.isFalse(rig.canRestoreDraft(invalidDraft));
  assert.throws(() => rig.assertCanRestoreDraft(invalidDraft), /invalidate.*bend/);
  assert.equal(rig.exportJson(false), before);
  rig.beginOperation();
  rig.assignAttachment('sleeve', 'rigid', 'default');
  rig.assignAttachment('sleeve', 'rigid', 'layered');
  rig.assignAttachment('front', 'rigid', 'layered');
  rig.endOperation();
  assert.throws(() => rig.removeAttachment('cloth'), /invalidate.*bend/);
  assert.equal(rig.getAttachment('cloth').type, 'mesh');
  rig.assignAttachment('sleeve', 'cloth', 'default');
  rig.assignAttachment('sleeve', 'cloth', 'layered');
  rig.assignAttachment('front', 'cloth', 'layered');
  rig.selectSlot('sleeve');
  // A later animation can acquire a vertex created by an older rig history entry.
  rig.selectedMeshEdge = [0, 1];
  rig.subdivideSelectedMeshEdge();
  const added = rig.selectedMeshVertexId;
  animation.updatePreviewRig(new Rig({ ...rig.workingCopy, skins: rig.skins }));
  animation.selectDeformation('cloth', 0.5);
  animation.setMeshOffsets({ [added]: { x: 0.1, y: 0 } });
  const held = rig.exportJson(false);
  assert.throws(() => rig.undo(), /invalidate.*bend/);
  assert.equal(rig.exportJson(false), held);
  assert.throws(() => rig.editBoneFields('lower', { x: 25 }), /bind/);
});

test('authored packages survive project/scene handoff and repeated direct seeks for multiple mixed Actors', async () => {
  const f = fixture();
  const imageFetcher: typeof fetch = () => Promise.resolve(new Response(f.files.get('images/paper.png')));
  const files = await buildCharacterPackage(f.snapshot, imageFetcher);
  const loaded = await validatePackage(files);
  assert.deepEqual(loaded.animations[0]!.deformationTracks, f.animation.packageAnimations()[0]!.deformationTracks);
  assert.deepEqual(loaded.rig.attachments, f.rig.workingCopy.attachments);
  const project = new ProjectWorkspace('Mesh film');
  await project.addCharacter(files);
  const scene = {
    ...createEmptyScene({ id: 'mesh-film', duration: 1000 }),
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: project.definition.characters[0]!.manifest },
      position: { x: index * 100, y: 20 },
      facing: index ? ('left' as const) : ('right' as const),
      skin: 'layered',
    })),
    actions: ['a', 'b'].map((actorId) => ({
      id: `bend-${actorId}`,
      actorId,
      type: 'animation' as const,
      time: 0,
      duration: 1000,
      animation: 'bend',
      speed: 1,
      loop: false,
      movementSource: 'rootMotion' as const,
    })),
  };
  const editor = new SceneEditorDocument();
  assert.isTrue(editor.importJson(JSON.stringify(scene)), JSON.stringify(editor.validationIssues));
  project.addScene(editor.workingScene!);
  const report = project.inspect('export');
  assert.equal(report.counts.error, 0, JSON.stringify(report.issues));
  assert.isTrue(
    assetDependents(report, { kind: 'attachment', owner: 'hero', id: 'cloth' }).some(
      (edge) => edge.from.kind === 'animation',
    ),
  );
  assert.isTrue(
    assetDependents(report, { kind: 'bone', owner: 'hero', id: 'lower' }).some((edge) =>
      edge.label.includes('weights'),
    ),
  );
  const restored = await importProjectPackage((await buildProjectPackage(project)).files);
  const snapshot = restored.captureCharacter('hero');
  assert.deepEqual(snapshot.animations[0]!.deformationTracks, f.snapshot.animations[0]!.deformationTracks);
  const portable = await buildScenePackage(editor.workingScene!, {
    baseUrl: 'https://example.test/scene.json',
    fetcher: (input) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
      const bytes = files.get(path.replace(/^.*\/character-1\//, ''));
      return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
    },
  });
  const resolved = await validateScenePackage(portable);
  const standalone = [...resolved.characters.values()][0]!;
  const host = puppetScene();
  const placement = new SceneActorPreview(host);
  placement.sync(
    { ...resolved.definition, actors: resolved.definition.actors.map((actor) => ({ ...actor, animation: 'bend' })) },
    resolved.characters,
  );
  assert.equal(placement.instances.size, 2);
  assert.deepEqual(
    placement.instances.get('a')!.actor.puppet.getSlotMesh('sleeve')!.vertices,
    placement.instances.get('b')!.actor.puppet.getSlotMesh('sleeve')!.vertices,
  );
  placement.dispose();
  const remove = vi.fn();
  Object.assign(host.textures, { remove });
  const runner = new SceneRunner(resolved.definition, {
    createActor: (data) =>
      new Actor({
        id: data.id,
        puppetOwnership: 'owned',
        puppet: new Puppet(host, { definition: standalone, scale: 1.5, autoUpdate: false }),
      }),
  });
  const previewPuppet = new Puppet(host, { definition: standalone, autoUpdate: false });
  const preview = new AnimationEditorPreview(f.animation, previewPuppet);
  const held = new Map<number, number[]>();
  for (const time of [0, 250, 750, 500, 1000, 250]) {
    runner.seek(time);
    f.animation.setCurrentTime(time / 1000);
    const a = runner.actors.get('a')!.puppet;
    const b = runner.actors.get('b')!.puppet;
    const geometry = a.getSlotMesh('sleeve')!.vertices;
    assert.deepEqual(geometry, b.getSlotMesh('sleeve')!.vertices);
    assert.deepEqual(geometry, previewPuppet.getSlotMesh('sleeve')!.vertices);
    if (held.has(time)) assert.deepEqual(geometry, held.get(time));
    else held.set(time, [...geometry]);
    assert.closeTo(a.container.x, time * 0.04 * 1.5, 1e-8);
    assert.closeTo(b.container.x, 100 - time * 0.04 * 1.5, 1e-8);
  }
  const retained = runner.actors.get('b')!.puppet.getSlotMesh('sleeve')!;
  const first = runner.actors.get('a')!.puppet;
  first.setSkin('rigid');
  assert.isUndefined(first.getSlotMesh('sleeve'));
  assert.isFalse(retained.isDestroyed);
  first.setSkin('layered');
  const final = first.getSlotMesh('sleeve')!;
  runner.dispose();
  assert.isTrue(final.isDestroyed);
  assert.isTrue(retained.isDestroyed);
  assert.equal(remove.mock.calls.length, 0);
  preview.dispose();
  previewPuppet.destroy();
});

test('replacement dimensions are checked for inactive meshes before changing shared artwork', () => {
  const f = fixture();
  const scene = puppetScene();
  Object.assign(scene.textures, {
    get: (key: string) => ({ get: () => ({ width: key === 'bad' ? 2 : 1, height: 1 }), has: () => true }),
  });
  const puppet = new Puppet(scene, { definition: f.definition, skin: 'rigid', autoUpdate: false });
  const image = puppet.getSlotImage('sleeve')!;
  assert.throws(() => puppet.setArtworkTexture('paper', 'bad'), /image dimensions/);
  assert.equal(image.texture.key, 'paper');
  puppet.setArtworkTexture('paper', 'good');
  puppet.setSkin('layered');
  assert.equal(puppet.getSlotMesh('sleeve')!.texture.key, 'good');
  const held = puppet.getSlotMesh('sleeve');
  assert.throws(
    () =>
      puppet.updateSlotDefinitions(
        f.definition.rig.attachments.map((attachment) =>
          attachment.type === 'mesh' ? { ...attachment, imageSize: { width: 2, height: 1 } } : attachment,
        ),
        f.definition.rig.skins,
      ),
    /image dimensions/,
  );
  assert.strictEqual(puppet.getSlotMesh('sleeve'), held);
  puppet.destroy();
});

test('onion meshes use each sampled correction and FK pose; retained buffers and host textures survive disposal', () => {
  const f = fixture();
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: f.animation.rig!, skin: 'default', autoUpdate: false });
  const preview = new AnimationEditorPreview(f.animation, puppet);
  f.animation.setCurrentTime(0.5);
  const overlay = new AnimationPoseOverlay(scene, puppet, 'previous', 1);
  const renderer = Reflect.get(overlay, 'renderer') as PuppetRenderer;
  for (const sample of f.animation.sampleGhostPoses({ previousCount: 2, nextCount: 2 })) {
    overlay.apply(sample);
    overlay.syncAppearance(puppet, DEFAULT_ONION_SKIN_SETTINGS, puppet.getAppearanceRevision());
    const reference = new Puppet(scene, {
      rig: f.animation.rig!,
      animations: f.animation.packageAnimations(),
      skin: 'default',
      autoUpdate: false,
    });
    reference.play('bend');
    reference.getIK('arm').enabled = false;
    reference.sampleAnimation(sample.time * 1000, { mode: 'playback' });
    assert.deepEqual(renderer.getSlotMesh('sleeve')!.vertices, reference.getSlotMesh('sleeve')!.vertices);
    reference.destroy();
  }
  const native = renderer.getSlotMesh('sleeve')!;
  overlay.destroy();
  assert.isTrue(native.isDestroyed);
  assert.isFalse(puppet.getSlotMesh('sleeve')!.isDestroyed);
  preview.dispose();
  puppet.destroy();
});

test('runtime catalog changes validate tracks before installation and refresh masks from current weights', () => {
  const f = fixture();
  const puppet = new Puppet(puppetScene(), {
    rig: f.animation.rig!,
    animations: f.animation.packageAnimations(),
    skin: 'default',
    autoUpdate: false,
  });
  puppet.play('bend', { layer: 'overlay' });
  puppet.posePipeline.player.setLayerMask('overlay', ['upper']);
  puppet.update(500);
  // Reapplying a layer mask uses the live attachment weights, including an edited catalog.
  puppet.posePipeline.player.setLayerMask('overlay', ['upper']);
  assert.equal(puppet.meshDeformation.size, 0);
  const attachments = f.animation.rig!.attachments.map((attachment) =>
    attachment.type === 'mesh'
      ? {
          ...attachment,
          vertices: attachment.vertices.map((vertex) => ({ ...vertex, influences: [{ boneId: 'upper', weight: 1 }] })),
        }
      : attachment,
  );
  puppet.updateSlotDefinitions(attachments, f.animation.rig!.skins);
  assert.equal(puppet.meshDeformation.get('cloth')!.get('top-left')!.x, 0.3);
  const held = puppet.getSlotMesh('sleeve')!;
  const invalid = attachments.map((attachment) =>
    attachment.type === 'mesh'
      ? {
          ...attachment,
          vertices: attachment.vertices.map((vertex, i) => (i === 0 ? { ...vertex, id: 'different' } : vertex)),
        }
      : attachment,
  );
  assert.throws(() => puppet.updateSlotDefinitions(invalid, f.animation.rig!.skins), /topology/);
  assert.strictEqual(puppet.getSlotMesh('sleeve'), held);
  assert.isFalse(held.isDestroyed);
  const extra = { ...attachments.find((attachment) => attachment.type === 'mesh')!, id: 'new-cloth' };
  puppet.updateSlotDefinitions([...attachments, extra], f.animation.rig!.skins);
  puppet.addAnimation({
    name: 'new-shape',
    duration: 1000,
    loop: false,
    tracks: {},
    deformationTracks: { 'new-cloth': [{ time: 0, offsets: { 'top-left': { x: 1, y: 2 } } }] },
  });
  puppet.play('new-shape');
  puppet.setAttachment('sleeve', 'new-cloth');
  assert.equal(puppet.meshDeformation.get('new-cloth')!.get('top-left')!.x, 1);
  puppet.destroy();

  const scene = puppetScene();
  Object.assign(scene, { sys: { game: { renderer: { type: 1 } } } });
  const rigid = new Puppet(scene, {
    rig: { root: 'root', bones: [{ id: 'root' }], slots: [{ id: 'slot', bone: 'root' }] },
    autoUpdate: false,
  });
  const mesh = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 1, height: 1 }, rigid.rig);
  assert.throws(() => rigid.updateSlotDefinitions([mesh], []), /WebGL/);
  assert.isUndefined(rigid.getSlotMesh('slot'));
  rigid.destroy();
});

test('project inspection detects mesh image dimensions and topology; missing images remain draft warnings', async () => {
  const f = fixture();
  const files = await buildCharacterPackage(f.snapshot, () =>
    Promise.resolve(new Response(f.files.get('images/paper.png'))),
  );
  const project = new ProjectWorkspace('Mesh diagnostics');
  const id = await project.addCharacter(files);
  const entry = project.character(id);
  const original = project.captureCharacter(id);
  entry.capture = () => ({
    ...original,
    rig: {
      ...original.rig,
      attachments: original.rig.attachments!.map((attachment) =>
        attachment.type === 'mesh' ? { ...attachment, imageSize: { width: 2, height: 1 } } : attachment,
      ),
    },
  });
  assert.isTrue(project.inspect('export').issues.some((issue) => /image dimensions/.test(issue.message)));
  entry.capture = () => ({
    ...original,
    animations: original.animations.map((clip) => ({
      ...clip,
      deformationTracks: { cloth: [{ time: 0, offsets: { missing: { x: 1, y: 0 } } }] },
    })),
  });
  assert.isTrue(project.inspect('export').issues.some((issue) => /topology/.test(issue.message)));
  entry.capture = () => original;
  const inspector = new ProjectInspector();
  const missing = {
    definition: project.definition,
    characters: new Map([[id, { snapshot: original, files: new Map<string, Uint8Array<ArrayBuffer>>() }]]),
    scenes: new Map(),
  };
  assert.isTrue(
    inspector
      .inspect(missing, 'draft')
      .issues.some((issue) => issue.severity === 'warning' && /Missing image/.test(issue.message)),
  );
  assert.isTrue(
    inspector
      .inspect(missing, 'export')
      .issues.some((issue) => issue.severity === 'error' && /Missing image/.test(issue.message)),
  );
});

test('rig recovery retains authored geometry, UVs, weights and bind data before animation recovery', () => {
  const f = fixture();
  const recovered = createCharacterDocuments(f.definition);
  assert.isTrue(recovered.rig.restoreDraft(JSON.parse(JSON.stringify(f.rig.createRecoveryDraft()))));
  assert.deepEqual(recovered.rig.workingCopy.attachments, f.rig.workingCopy.attachments);
  recovered.animation.updatePreviewRig(new Rig({ ...recovered.rig.workingCopy, skins: recovered.rig.skins }));
  assert.isTrue(recovered.animation.importJson(f.animation.exportJson()));
  assert.deepEqual(
    recovered.animation.packageAnimations()[0]!.deformationTracks,
    f.animation.packageAnimations()[0]!.deformationTracks,
  );
});
