import { afterEach, expect, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationRetargetSession } from '../src/devtools/project/AnimationRetargetSession.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import * as packages from '../src/devtools/shared/package/characterPackage.js';
import { RetargetComparisonScene } from '../src/devtools/shared/RetargetComparison.js';
import { RetargetComparisonPlayback } from '../src/devtools/shared/RetargetComparisonPlayback.js';
import { retargetAnimation } from '../src/engine/animationRetargeting.js';
import type { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { getFootContactWorldPosition } from '../src/engine/footContactMarkers.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createRigBoneMapping } from '../src/engine/rigBoneMapping.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import * as loader from '../src/shared/loadSceneCharacter.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';
import { retargetFixture } from './helpers/retargetFixture.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

test.each(['shared-mesh', 'different-topology', 'rigid-to-mesh', 'mesh-to-rigid'] as const)(
  '%s retargeting preserves target skinning and transfers only verified corrective vertices',
  (kind) => {
    const meshSource = productionMesh(2).rig;
    const rigid = {
      ...meshSource,
      attachments: [
        { id: 'sleeve', texture: 'paper' },
        { id: 'rigid', texture: 'paper' },
      ],
    };
    const source = { id: 'source', rig: kind === 'rigid-to-mesh' ? rigid : meshSource };
    const target = {
      id: 'target',
      rig: kind === 'mesh-to-rigid' ? rigid : kind === 'different-topology' ? productionMesh(3).rig : meshSource,
    };
    const sourceClip = {
      name: 'cut',
      duration: 1000,
      loop: false,
      tracks: {
        lower: [
          { time: 0, rotation: 0 },
          { time: 1000, rotation: 1 },
        ],
      },
      ...(kind === 'rigid-to-mesh'
        ? {}
        : { deformationTracks: { sleeve: [{ time: 1000, offsets: { v0: { x: 2, y: 1 } } }] } }),
    };
    const before = structuredClone({ source, target, sourceClip });
    const result = retargetAnimation({
      sourceRig: source,
      targetRig: target,
      sourceAnimation: sourceClip,
      boneMapping: createRigBoneMapping(
        source,
        target,
        source.rig.bones.map(({ id }) => ({ sourceBoneId: id, targetBoneId: id })),
        'map',
        'Reviewed map',
      ),
      options: { name: 'target-cut', rootMotion: 'preserve' },
    });
    expect(result.animation).not.toBeNull();
    expect(result.animation!.deformationTracks).toEqual(
      kind === 'shared-mesh' ? sourceClip.deformationTracks : undefined,
    );
    expect(result.skippedTracks.some(({ kind }) => kind === 'mesh')).toBe(
      ['different-topology', 'mesh-to-rigid'].includes(kind),
    );
    const puppet = new Puppet(puppetScene(), {
      rig: target.rig,
      skin: 'default',
      animations: [result.animation!],
      autoUpdate: false,
    });
    try {
      puppet.play('target-cut', { loop: false });
      puppet.sampleAnimation(0);
      const beforeVertices = puppet.getSlotMesh('cloth')?.vertices.slice();
      puppet.sampleAnimation(700);
      expect(puppet.getBone('lower').pose.rotation).toBeCloseTo(0.7);
      if (kind !== 'mesh-to-rigid') {
        expect(puppet.getSlotMesh('cloth')!.vertices).not.toEqual(beforeVertices);
        expect(puppet.getSlotMesh('cloth')!.vertices.every(Number.isFinite)).toBe(true);
      }
      expect(puppet.animationPlayer.meshDeformation.size).toBe(kind === 'shared-mesh' ? 1 : 0);
      expect({ source, target, sourceClip }).toEqual(before);
    } finally {
      puppet.destroy();
    }
  },
);

async function fixture() {
  const f = await retargetFixture();
  const session = new AnimationRetargetSession(f.project, f.project.animationLibrary()[0]!);
  session.selectTarget('target');
  session.selectMapping(f.map);
  return { ...f, session };
}

test('target/mapping selection and repeated option previews always use the unchanged source snapshot', async () => {
  const { project, map, session } = await fixture();
  const scene = project.addScene({
    ...createEmptyScene({ id: 'opening' }),
    actors: [
      {
        id: 'samurai',
        character: { manifest: project.characterReference('source') },
        position: { x: 12, y: 34 },
        animation: 'sword-cut',
      },
    ],
  });
  const actors = project.scenes.scene(scene);
  const before = [project.autosaveRevision, project.captureCharacter('source'), project.captureCharacter('target')];
  expect(() => session.selectTarget('source')).toThrow(/another character/);
  expect(session.preview().animation).not.toBeNull();
  expect(session.result!.animation!.tracks.lower![1]!.x).toBe(48);
  session.setOptions({ ...session.options, translation: 'preserve-delta', rootMotion: 'scale-by-character' });
  expect(session.result).toBeUndefined();
  const scaled = session.preview().animation!;
  expect(scaled.tracks.lower![1]!.x).toBe(44);
  expect(scaled.rootMotion!.translationKeys[1]!.x).toBeCloseTo(170);
  session.setOptions({ ...session.options, translation: 'scale-by-bone', rootMotion: 'omit' });
  expect(session.preview().animation!.tracks.lower![1]!.x).toBe(48);
  expect(session.result!.animation!.rootMotion).toBeUndefined();
  session.selectMapping(map);
  expect(session.result).toBeUndefined();
  expect(() => session.acceptedAnimation()).toThrow(/preview/);
  session.selectTarget('');
  expect(session.mapping).toBeUndefined();
  expect(() => session.preview()).toThrow(/target character/);
  expect([project.autosaveRevision, project.captureCharacter('source'), project.captureCharacter('target')]).toEqual(
    before,
  );
  expect(project.scenes.scene(scene)).toBe(actors);
});

test('invalid, missing, partial and stale bone maps report errors/omissions without touching assets', async () => {
  const { project, map, session } = await fixture();
  const before = project.autosaveRevision;
  session.selectMapping({ ...map, entries: [...map.entries, { sourceBoneId: 'absent', targetBoneId: 'missing' }] });
  const invalid = session.preview();
  expect(invalid.animation).toBeNull();
  expect(invalid.diagnostics.some(({ code }) => code === 'missing-bone')).toBe(true);
  expect(() => session.acceptedAnimation()).toThrow(/preview/);
  session.selectMapping({ ...map, entries: map.entries.map((pair) => ({ ...pair, targetBoneId: 'root' })) });
  expect(session.preview().diagnostics.some(({ code }) => code === 'duplicate-target')).toBe(true);
  session.selectMapping(
    createRigBoneMapping(
      project.rigSource('source'),
      project.rigSource('target'),
      [map.entries[0]!],
      'partial',
      'Partial',
    ),
  );
  expect(session.preview().skippedTracks).toContainEqual(expect.objectContaining({ kind: 'bone', id: 'lower' }));
  expect(project.autosaveRevision).toBe(before);
  session.selectMapping({ ...map, sourceRevision: `rig-v1:${'0'.repeat(64)}` });
  expect(session.preview().diagnostics.some(({ code }) => code === 'stale-mapping')).toBe(true);
  session.selectMapping(map);
  session.preview();
  const target = project.captureCharacter('target');
  project.character('target').capture = () => ({ ...target, rig: { ...target.rig, footContactMarkers: [] } });
  expect(() => session.acceptedAnimation()).toThrow(/rig changed/);
  expect(() => session.preview()).toThrow(/rig changed/);
  expect(session.result).toBeUndefined();
});

test('IK, root motion, proportion, orientation and mesh omissions remain actionable diagnostics', async () => {
  const { session } = await fixture();
  const result = session.preview();
  expect(result.animation!.disabledIKConstraints).toEqual(['target-arm']);
  expect(result.animation!.ikTracks).toBeUndefined();
  expect(result.animation!.deformationTracks).toBeUndefined();
  expect(result.skippedTracks.find(({ kind, id }) => kind === 'ik' && id === 'arm')?.reason).toMatch(/Bake source IK/);
  expect(result.skippedTracks.find(({ kind, id }) => kind === 'mesh' && id === 'sleeve')?.reason).toMatch(
    /Target skinning/,
  );
  expect(result.diagnostics.map(({ code }) => code)).toEqual(
    expect.arrayContaining([
      'source-ik-not-evaluated',
      'target-ik-disabled',
      'event-payload-unmapped',
      'orientation-difference',
      'proportion-difference',
    ]),
  );
  session.setOptions({ ...session.options, pelvis: { sourceBoneIds: ['lower'], translation: 'scale-by-character' } });
  expect(session.preview().animation!.tracks.lower![1]!.x).toBe(48);
});

test('comparison uses the saved source ground reference in character coordinates without changing preferences', async () => {
  const { project } = await fixture();
  project.setAnimationPreviewPreferences('source', {
    environment: { enabled: false, image: null, visible: true, x: 0, y: 0, scale: 1 },
    camera: { mode: 'fixed', x: 0, y: 0, zoom: 1 },
    ground: { enabled: true, y: 450, snapEnabled: true },
    animations: {},
  });
  const before = project.autosaveRevision;
  const session = new AnimationRetargetSession(project, project.animationLibrary()[0]!);
  expect(session.groundReference).toEqual({ enabled: true, y: 15, snapEnabled: false });
  expect(project.animationPreviewPreferences('source')!.ground).toEqual({ enabled: true, y: 450, snapEnabled: true });
  expect(project.autosaveRevision).toBe(before);
});

test('a single clock seeks both real Puppets through FK/IK, root motion and mesh evaluation without events', async () => {
  const { project, session } = await fixture();
  const source = project.character('source').definition;
  const target = project.character('target').definition;
  const animation = session.preview().animation!;
  const a = new Puppet(puppetScene(), { definition: source, autoUpdate: false });
  const b = new Puppet(puppetScene(), { definition: target, autoUpdate: false });
  b.addAnimation(animation);
  const events = vi.fn();
  for (const [puppet, name] of [
    [a, 'sword-cut'],
    [b, animation.name],
  ] as const) {
    puppet.animationPlayer.setPreviewMode(true);
    puppet.onAnimationEvent(events);
    puppet.play(name, { loop: false, fadeDuration: 0 });
    puppet.pauseAnimation();
  }
  const clock = new RetargetComparisonPlayback([a, b], 1000);
  try {
    clock.scrub(500);
    expect(a.container.x).toBeCloseTo(40);
    expect(b.container.x).toBeCloseTo(40);
    expect(a.animationPlayer.ikAnimation.get('arm')!.mix!.value).toBeCloseTo(0.75);
    expect(b.animationPlayer.ikAnimation.get('target-arm')!.disabled!.value).toBe(1);
    expect(a.animationPlayer.meshDeformation.get('sleeve')!.get('top-left')).toEqual({ x: 2, y: 1 });
    expect(b.animationPlayer.meshDeformation.size).toBe(0);
    const positions = [a, b].map((puppet) => {
      const pose = new Map(puppet.rig.bones.map(({ id }) => [id, puppet.getBone(id).pose]));
      return getFootContactWorldPosition(
        puppet.rig.footContactMarkers![0]!,
        puppet.rig,
        pose,
        puppet.container.getWorldTransformMatrix(),
      );
    });
    expect(positions[0]).not.toEqual(positions[1]);
    clock.speed = 0.5;
    clock.toggle();
    clock.advance(200);
    expect(clock.time).toBe(600);
    clock.toggle();
    clock.advance(200);
    expect(clock.time).toBe(600);
    clock.scrub(1000);
    expect(a.container.x).toBe(80);
    expect(b.container.x).toBe(80);
    clock.toggle();
    expect(clock.time).toBe(0);
    clock.advance(2000);
    expect(clock.playing).toBe(false);
    clock.scrub(500);
    expect(a.container.x).toBe(40);
    expect(b.container.x).toBe(40);
    expect(events).not.toHaveBeenCalled();
    expect(project.captureCharacter('source').animations[0]).toEqual(session.sourceAnimation);
  } finally {
    a.destroy();
    b.destroy();
  }
});

test('generated creation validates atomically, retains existing clip histories and recovers through project autosave/ZIP', async () => {
  const { project, session } = await fixture();
  const snapshot = project.captureCharacter('target');
  const state = new AnimationEditorState(project.character('target').definition.rig);
  expect(state.createAnimation({ name: 'existing', durationSeconds: 1, loop: false })).toBe(true);
  expect(state.setLibraryMetadata({ displayName: 'Existing edit' })).toBe(true);
  const existing = state.workingAnimation;
  session.preview();
  const proposal = session.acceptedAnimation();
  expect(state.createDerivedAnimation({ ...proposal, tracks: { missing: [{ time: 0, x: 2 }] } })).toBe(false);
  expect(state.animationIds).toEqual(['existing']);
  expect(state.workingAnimation).toBe(existing);
  expect(state.createDerivedAnimation(proposal)).toBe(true);
  expect(state.selectedAnimationId).toBe(proposal.name);
  expect(state.hasUnsavedChanges).toBe(true);
  expect(state.createDerivedAnimation(proposal)).toBe(false);
  expect(state.animationIds).toHaveLength(2);
  expect(state.setLibraryMetadata({ displayName: 'Corrected target' })).toBe(true);
  expect(state.undo()).toBe(true);
  expect(state.workingAnimation!.library).toEqual(proposal.library);
  expect(state.redo()).toBe(true);
  expect(state.selectAnimation('existing', { keepChanges: true })).toBe(true);
  expect(state.undo()).toBe(true);
  expect(state.workingAnimation!.library).toBeUndefined();
  expect(state.selectAnimation(proposal.name, { keepChanges: true })).toBe(true);
  project.character('target').capture = () => ({ ...snapshot, animations: state.packageAnimations() });
  const sourceBefore = project.captureCharacter('source');
  let saved: packages.PackageFiles | undefined;
  const autosave = new LocalAutosave(
    'retarget',
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
      name: 'Retarget',
      dirty: true,
      build: async (signal) => (await buildProjectPackage(project, signal)).files,
    }),
  );
  try {
    await autosave.flush();
    expect(saved).toBeDefined();
    const restored = await importProjectPackage(decodePackageZip(encodePackageZip(saved!)));
    expect(restored.captureCharacter('source').animations).toEqual(sourceBefore.animations);
    expect({
      ...restored.captureCharacter('target').animations.find(({ name }) => name === proposal.name),
      version: 1,
    }).toEqual(state.workingAnimation);
    expect(restored.definition.rigMappings).toEqual(project.definition.rigMappings);
    expect(restored.inspect('export').counts.error).toBe(0);
    const exported = await buildProjectPackage(restored);
    expect((await importProjectPackage(exported.files)).captureCharacter('target').animations).toHaveLength(2);
  } finally {
    autosave.dispose();
  }
});

test('preview loading releases the first lease on second-load failure and every late lease on cancel', async () => {
  const { session } = await fixture();
  session.preview();
  const dispose = vi.fn();
  const definition = session.source.definition;
  const open = vi
    .spyOn(packages, 'openPackageRuntime')
    .mockResolvedValueOnce({ definition, dispose })
    .mockRejectedValueOnce(new Error('Target artwork failed'));
  await expect(session.previewLoader()(new AbortController().signal)).rejects.toThrow(/artwork failed/);
  expect(dispose).toHaveBeenCalledTimes(1);
  const request = new AbortController();
  open.mockImplementationOnce(async () => {
    request.abort();
    return { definition, dispose };
  });
  await expect(session.previewLoader()(request.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(dispose).toHaveBeenCalledTimes(2);
});

test('comparison scene destroys both Puppets/overlays once and ignores late character loading', async () => {
  const { project, session } = await fixture();
  const source = project.character('source').definition;
  const result = session.preview().animation!;
  const target = project.character('target').definition;
  // Supply a detached target runtime definition using the same package validation as the UI.
  const files = await packages.buildCharacterPackage({ ...session.target!, animations: [result] }, () =>
    Promise.resolve(new Response(project.character('target').files.get('paper.png'))),
  );
  const runtime = await packages.loadPackageDefinition(files);
  const report = vi.fn();
  const scene = new RetargetComparisonScene([source, runtime], ['sword-cut', result.name], report, () => {});
  const camera = {
    setViewport() {
      return this;
    },
    ignore: vi.fn(),
  };
  Object.assign(scene, puppetScene(), { cameras: { main: camera, add: () => camera } });
  vi.spyOn(scene, 'fit').mockImplementation(() => {});
  vi.spyOn(loader, 'loadSceneCharacter').mockImplementation(async (_scene, _url, options) => options!.definition);
  scene.create();
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringMatching(/Comparison ready/), true));
  const puppets = scene.playback!.puppets;
  const destroys = puppets.map((puppet) => vi.spyOn(puppet, 'destroy'));
  scene.dispose();
  scene.dispose();
  for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
  expect(scene.playback).toBeUndefined();
  let finish!: (definition: CharacterDefinition) => void;
  vi.mocked(loader.loadSceneCharacter).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const late = new RetargetComparisonScene([source, target], ['sword-cut', result.name], report, () => {});
  Object.assign(late, puppetScene());
  late.create();
  late.dispose();
  finish(source);
  await Promise.resolve();
  await Promise.resolve();
  expect(late.playback).toBeUndefined();
});
