import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { AnimationRetargetSession } from '../src/devtools/project/AnimationRetargetSession.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { buildProjectDraft } from '../src/devtools/shared/autosave/projectDrafts.js';
import {
  captureChoreography,
  captureSceneTemplate,
  createSceneFromTemplate,
  insertChoreography,
} from '../src/devtools/shared/sceneReuse.js';
import { Actor } from '../src/engine/Actor.js';
import type { CinematicCameraState } from '../src/engine/cinematicCamera.js';
import { getFootContactWorldPosition } from '../src/engine/footContactMarkers.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createRigBoneMapping } from '../src/engine/rigBoneMapping.js';
import { createEmptyScene, type SceneDefinition } from '../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { retargetFixture } from './helpers/retargetFixture.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

test('sword-cut reuse survives target corrections, variants, choreography, templates, recovery and standalone seeking', async () => {
  const { project } = await retargetFixture();
  const sourceDocuments = project.characterDocuments('source');
  sourceDocuments.rig.createSkin('ink');
  sourceDocuments.rig.assignAttachment('sleeve-slot', null, 'ink');
  const map = createRigBoneMapping(
    project.rigSource('source'),
    project.rigSource('target'),
    project.rigSource('source').rig.bones.map(({ id }) => ({ sourceBoneId: id, targetBoneId: id })),
    'samurai-map',
    'Reviewed samurai map',
  );
  project.saveRigMapping(map);
  const original = project.captureCharacter('source');
  const session = new AnimationRetargetSession(project, project.animationLibrary()[0]!);
  session.selectTarget('target');
  session.selectMapping(map);
  session.setOptions({ ...session.options, rootMotion: 'scale-by-character' });
  const result = session.preview();
  expect(result.characterSizeRatio).toBeCloseTo(2);
  expect(result.skippedTracks.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['ik', 'mesh']));
  const targetDocuments = project.characterDocuments('target');
  const target = targetDocuments.animation;
  expect(target.createDerivedAnimation(session.acceptedAnimation())).toBe(true);
  const retargeted = target.workingAnimation;
  expect(target.setBonePropertyKeyframe('lower', 'rotation', 0.65, 0.5)).toBe(true);
  const corrected = target.workingAnimation;
  expect(target.undo()).toBe(true);
  expect(target.workingAnimation).toEqual(retargeted);
  expect(target.redo()).toBe(true);
  expect(target.workingAnimation).toEqual(corrected);
  expect(project.captureCharacter('source')).toEqual(original);
  project.createCharacterVariant('source', 'Samurai A in ink', 'ink', 'ink-samurai');
  expect(project.rigOwner('ink-samurai')).toBe('source');

  const voiceBytes = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
  project.addAudio({ id: 'voice', name: 'Reaction', category: 'voice', path: 'audio/voice.wav' }, voiceBytes);
  const scene: SceneDefinition = {
    ...createEmptyScene({ id: 'sword-exchange', duration: 5000 }),
    actors: ['source', 'target'].map((character, index) => ({
      id: `samurai-${index}`,
      character: { manifest: project.characterReference(character) },
      position: { x: index * 300, y: 0 },
    })),
    actions: [
      ...['sword-cut', session.name].map((animation, index) => ({
        id: `cut-${index}`,
        type: 'animation' as const,
        actorId: `samurai-${index}`,
        time: 500 + index * 200,
        duration: 1000,
        animation,
        speed: 1,
        loop: false,
        movementSource: 'rootMotion' as const,
      })),
      { id: 'cue', type: 'cue', actorId: 'samurai-0', time: 1000, name: 'cut', payload: { shot: 1 } },
    ],
    cameraTracks: { x: [{ id: 'camera', time: 1000, value: 50 }] },
    audioAssets: [{ id: 'voice', name: 'Reaction', category: 'voice', path: '../audio/voice.wav' }],
    audioTracks: [{ id: 'voices', name: 'Voices', category: 'voice' }],
    audioClips: [
      {
        id: 'reaction',
        assetId: 'voice',
        trackId: 'voices',
        time: 1000,
        duration: 200,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      },
    ],
    dialogue: [{ id: 'line', actorId: 'samurai-1', time: 1000, duration: 200, text: 'Ah!', voiceClipId: 'reaction' }],
  };
  project.addScene(scene);
  const rigIdentity = (manifest: string) => project.rigOwner(project.resolveCharacter(manifest));
  const choreography = captureChoreography(scene, {
    id: 'exchange',
    name: 'Sword exchange',
    actionIds: scene.actions.map(({ id }) => id),
    rigIdentity,
    includeCamera: true,
    includeAudioDialogue: true,
  });
  const destination = createEmptyScene({ id: 'another-exchange', duration: 5000 });
  destination.actors = scene.actors.map((actor, index) => ({
    ...actor,
    id: `new-${index}`,
    position: { x: 500 + index * 300, y: 20 },
    character: { manifest: project.characterReference(index ? 'target' : 'ink-samurai') },
  }));
  const inserted = insertChoreography(destination, choreography, {
    time: 1500,
    actors: { 'role-1': 'new-0', 'role-2': 'new-1' },
    rigIdentity,
    validation: {
      getCharacterAssets: (manifest) => {
        const snapshot = project.captureCharacter(project.resolveCharacter(manifest));
        return {
          animations: snapshot.animations.map(({ name }) => name),
          rootMotionAnimations: snapshot.animations.filter((clip) => clip.rootMotion).map(({ name }) => name),
          skins: ['base', 'ink'],
        };
      },
    },
  });
  project.addScene(inserted);
  const template = captureSceneTemplate(inserted, {
    id: 'exchange-template',
    name: 'Exchange',
    actors: true,
    timeline: true,
    audioDialogue: true,
  });
  project.setSceneReuse({ version: 1, choreographies: [choreography], templates: [template] });
  const copy = createSceneFromTemplate(template, { id: 'third-exchange', name: 'Third exchange' });
  project.addScene(copy);
  expect(project.scenes.updateProperties({ name: 'Private shot' })).toBe(true);
  expect(project.scenes.undo()).toBe(true);
  expect(project.scenes.redo()).toBe(true);
  expect(project.scenes.scene(scene.id)).toEqual(scene);
  expect(project.sceneReuse.templates[0]).toEqual(template);
  expect(project.captureCharacter('source')).toEqual(original);
  expect(() => project.remove('characters', 'source')).toThrow(/used/);
  expect(() => project.removeAudio('voice')).toThrow(/in use/);

  const recovered = await importProjectPackage(await buildProjectDraft(project));
  const restored = await importProjectPackage(
    decodePackageZip(encodePackageZip((await buildProjectPackage(recovered)).files)),
  );
  expect(restored.sceneReuse).toEqual(project.sceneReuse);
  expect(restored.definition.rigMappings).toEqual(project.definition.rigMappings);
  expect(restored.captureCharacter('source').rig).toEqual(original.rig);
  expect(restored.captureCharacter('source').animations.map((clip) => ({ ...clip, version: 1 }))).toEqual(
    original.animations.map((clip) => ({ ...clip, version: 1 })),
  );
  expect(restored.captureCharacter('target').animations).toContainEqual(
    expect.objectContaining({ name: session.name, tracks: corrected!.tracks }),
  );
  expect(restored.captureCharacter('ink-samurai').identity?.defaultSkin).toBe('ink');
  expect(restored.inspect('export', true).counts.error).toBe(0);

  // Load the expanded scene through the public runtime package boundary, with no editor asset resolver.
  const resolved = await validateScenePackage(
    await buildProjectScenePackage(restored, restored.scenes.scene(copy.id)!),
  );
  const events = vi.fn();
  const cues = vi.fn();
  const playAudio = vi.fn(() => ({ elapsed: 0, ended: false, stop() {}, setVolume() {} }));
  const camera = vi.fn<(state: Readonly<CinematicCameraState>) => void>();
  const runner = new SceneRunner(resolved.definition, {
    createActor: (actor) => {
      const puppet = new Puppet(puppetScene(), {
        definition: resolved.characters.get(actor.character.manifest)!,
        autoUpdate: false,
      });
      puppet.onAnimationEvent(events);
      return new Actor({ id: actor.id, puppet, puppetOwnership: 'owned' });
    },
    onCue: cues,
    onCamera: camera,
    audio: {
      resolve: (id) => ({
        definition: resolved.definition.audioAssets!.find((asset) => asset.id === id)!,
        bytes: voiceBytes,
      }),
      backend: {
        running: true,
        resume: async () => {},
        dispose() {},
        decode: async () => ({
          durationSeconds: 2,
          byteLength: 16,
          play: playAudio,
          playTimeline: playAudio,
          dispose() {},
        }),
      },
    },
  });
  const sample = () => ({
    actors: [...runner.actors.values()].map((actor) => ({
      position: { ...actor.position },
      pose: actor.puppet.rig.bones.map(({ id }) => ({ ...actor.puppet.getBone(id).pose })),
      contacts: actor.puppet.rig.footContactMarkers!.map((marker) =>
        getFootContactWorldPosition(
          marker,
          actor.puppet.rig,
          new Map(actor.puppet.rig.bones.map(({ id }) => [id, actor.puppet.getBone(id).pose])),
          actor.puppet.container.getWorldTransformMatrix(),
        ),
      ),
    })),
    camera: camera.mock.calls.at(-1)?.[0],
  });
  try {
    await runner.audio!.unlock();
    runner.seek(2150);
    const expected = sample();
    expect(expected.actors.map(({ position }) => position)).toEqual([
      { x: 552, y: 26.5 },
      { x: 872, y: 29 },
    ]);
    expect(
      expected.actors.every(({ contacts }) =>
        contacts.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)),
      ),
    ).toBe(true);
    for (const time of [2150, 4900, 0, 1600, 3000, 2150]) runner.seek(time);
    expect(sample()).toEqual(expected);
    expect(events).not.toHaveBeenCalled();
    expect(cues).not.toHaveBeenCalled();
    expect(playAudio).not.toHaveBeenCalled();
    runner.seek(0);
    runner.play();
    runner.update(2150);
    expect(sample()).toEqual(expected);
    expect(cues).toHaveBeenCalledTimes(1);
    expect(playAudio).toHaveBeenCalledTimes(1);
  } finally {
    runner.dispose();
  }
});
