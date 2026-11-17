import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { buildProjectDraft } from '../src/devtools/project/projectDrafts.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import {
  captureChoreography,
  captureSceneTemplate,
  createSceneFromTemplate,
  emptySceneReuseLibrary,
  insertChoreography,
  parseSceneReuseLibrary,
} from '../src/devtools/shared/sceneReuse.js';
import { Actor } from '../src/engine/Actor.js';
import { Puppet } from '../src/engine/Puppet.js';
import { freezeData } from '../src/engine/readonlyData.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
  type SceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const manifest = 'characters/samurai/character.json';
const rigIdentity = () => 'film:samurai-rig';
const assets = { animations: ['walk', 'bow', 'attack'], rootMotionAnimations: ['attack'], skins: ['default'] };
const validation = { characters: new Map([[manifest, assets]]) };
function source(): SceneDefinition {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'meeting', duration: 10000 }),
    actors: ['a', 'b'].map((id, index) => ({ id, character: { manifest }, position: { x: index * 400, y: 10 } })),
    actions: [
      ...['a', 'b'].flatMap((actorId, index) => [
        {
          id: `walk-${actorId}`,
          actorId,
          type: 'animation',
          time: 1000,
          duration: 1000,
          animation: 'walk',
          speed: 1,
          loop: true,
        },
        {
          id: `move-${actorId}`,
          actorId,
          type: 'move',
          time: 1000,
          duration: 1000,
          destination: { x: 100 + index * 200, y: 10 },
        },
        {
          id: `face-${actorId}`,
          actorId,
          type: 'face',
          time: 2000,
          target: { type: 'actor', actorId: index ? 'a' : 'b' },
        },
        {
          id: `bow-${actorId}`,
          actorId,
          type: 'animation',
          time: 2200,
          duration: 800,
          animation: 'bow',
          speed: 1,
          loop: false,
        },
      ]),
      { id: 'cue', type: 'cue', actorId: 'a', time: 2500, name: 'bowed', payload: { event: ['metadata', 1] } },
    ],
    cameraTracks: {
      x: [
        { id: 'cam-a', time: 1000, value: 100 },
        { id: 'cam-b', time: 2500, value: 300 },
      ],
    },
    transitions: [{ id: 'fade', time: 2600, duration: 200, type: 'fade-out', color: '#000000' }],
    audioAssets: [{ id: 'voice', name: 'Voice', category: 'voice', path: 'audio/voice.wav', durationSeconds: 2 }],
    audioTracks: [{ id: 'voice-track', name: 'Voice', category: 'voice' }],
    audioClips: [
      {
        id: 'spoken',
        assetId: 'voice',
        trackId: 'voice-track',
        time: 1500,
        duration: 300,
        sourceOffset: 100,
        volume: 1,
        loop: false,
      },
    ],
    dialogue: [{ id: 'line', actorId: 'a', time: 1500, duration: 300, text: 'Hello', voiceClipId: 'spoken' }],
  });
}
function preset(input = source()) {
  return captureChoreography(input, {
    id: 'two-bows',
    name: 'Two Samurai Bow',
    actionIds: input.actions.map((action) => action.id),
    rigIdentity,
  });
}
function destination() {
  const scene = createEmptyScene({ id: 'another-meeting', duration: 15000 });
  scene.actors = ['actor-17', 'actor-23'].map((id, index) => ({
    id,
    character: { manifest },
    position: { x: 1000 + index * 400, y: 100 },
  }));
  return scene;
}
const mapping = { 'role-1': 'actor-17', 'role-2': 'actor-23' };
function insert(
  time = 5000,
  input: import('../src/engine/readonlyData.js').DeepReadonly<ReturnType<typeof preset>> = preset(),
  target: import('../src/engine/readonlyData.js').DeepReadonly<SceneDefinition> = destination(),
) {
  return insertChoreography(target, input, { time, actors: mapping, rigIdentity, validation });
}

test('saving choreography normalizes time, labels roles and owns cue payloads without modifying source', () => {
  const scene = source();
  const before = structuredClone(scene);
  const entry = captureChoreography(freezeData(scene), {
    id: 'bows',
    name: 'Bows',
    actionIds: scene.actions.map((action) => action.id),
    rigIdentity,
    roleNames: { a: 'Samurai A', b: 'Samurai B' },
  });
  expect(entry.scene.duration).toBe(2000);
  expect(Math.min(...entry.scene.actions.map((action) => action.time))).toBe(0);
  expect(entry.roles.map((role) => role.name)).toEqual(['Samurai A', 'Samurai B']);
  expect(entry.scene.audioClips).toBeUndefined();
  expect(entry.scene.cameraTracks).toBeUndefined();
  expect(scene).toEqual(before);
  const cue = entry.scene.actions.find((action) => action.type === 'cue')!;
  if (cue.type === 'cue') (cue.payload as { event: unknown[] }).event.push('edited');
  expect(scene).toEqual(before);
});

test.each([0, 4000, 13000])(
  'insertion at %s preserves spacing, fresh IDs, all roles and relative displacements',
  (time) => {
    const entry = freezeData(preset());
    const target = freezeData(destination());
    const copied = insert(time, entry, target);
    expect(copied.actions.map((action) => action.time)).toEqual(
      entry.scene.actions.map((action) => action.time + time),
    );
    expect(copied.actions.every((action) => !entry.scene.actions.some((source) => source.id === action.id))).toBe(true);
    expect(copied.actions.filter((action) => action.type === 'move').map((action) => action.destination)).toEqual([
      { x: 1100, y: 100 },
      { x: 1300, y: 100 },
    ]);
    expect(copied.actions.filter((action) => action.type === 'face').map((action) => action.target)).toEqual([
      { type: 'actor', actorId: 'actor-23' },
      { type: 'actor', actorId: 'actor-17' },
    ]);
    copied.actions.length = 0;
    expect(entry.scene.actions).toHaveLength(9);
    expect(target.actions).toHaveLength(0);
  },
);

test('explicit source and destination origins shift positions while absolute presets retain scene-world points', () => {
  const scene = source();
  scene.actions.push({ id: 'point', actorId: 'a', type: 'face', time: 2100, target: { type: 'point', x: 80, y: 20 } });
  const entry = captureChoreography(scene, {
    id: 'relative',
    name: 'Relative',
    actionIds: scene.actions.map((action) => action.id),
    rigIdentity,
    origins: { a: { x: 50, y: 10 } },
  });
  const copied = insertChoreography(destination(), entry, {
    time: 0,
    actors: mapping,
    rigIdentity,
    validation,
    origins: { 'role-1': { x: 700, y: 90 } },
  });
  expect(copied.actions.find((action) => action.type === 'move')).toMatchObject({ destination: { x: 750, y: 90 } });
  expect(copied.actions.at(-1)).toMatchObject({ target: { type: 'point', x: 730, y: 100 } });
  entry.positionMode = 'absolute';
  expect(insert(0, entry).actions.find((action) => action.type === 'move')).toMatchObject({
    destination: { x: 100, y: 10 },
  });
});

test('preview validates missing animations, incompatible rigs, missing mappings and metadata before any mutation', () => {
  const target = freezeData(destination());
  const entry = preset();
  expect(() =>
    insertChoreography(target, entry, { time: 0, actors: mapping, rigIdentity: () => 'different', validation }),
  ).toThrow(/incompatible rig.*Retarget/);
  expect(() => insertChoreography(target, entry, { time: 0, actors: {}, rigIdentity, validation })).toThrow(
    /Assign an Actor/,
  );
  expect(() =>
    insertChoreography(target, entry, {
      time: 0,
      actors: { ...mapping, 'role-2': 'actor-17' },
      rigIdentity,
      validation,
    }),
  ).toThrow(/different Actor/);
  expect(() => insertChoreography(target, entry, { time: 0, actors: mapping, rigIdentity })).toThrow(
    /metadata is unavailable/,
  );
  expect(() =>
    insertChoreography(target, entry, {
      time: 0,
      actors: mapping,
      rigIdentity,
      validation: { characters: new Map([[manifest, { ...assets, animations: ['walk'] }]]) },
    }),
  ).toThrow(/Unknown animation/);
  expect(target.actions).toEqual([]);
});

test.each([-1, NaN, Infinity, 13001])('invalid insertion time %s is rejected without extending the scene', (time) => {
  expect(() => insert(time)).toThrow(/fit within scene duration/);
});

test('root-motion ownership is unchanged, evaluates once and rejects overlapping scene movement', () => {
  const scene = source();
  scene.actions = [
    {
      id: 'attack',
      actorId: 'a',
      type: 'animation',
      animation: 'attack',
      time: 1000,
      duration: 1000,
      loop: false,
      speed: 1,
      movementSource: 'rootMotion',
    },
  ];
  const entry = preset(scene);
  const copied = insert(1000, entry);
  expect(copied.actions).toHaveLength(1);
  expect(copied.actions[0]).toMatchObject({ movementSource: 'rootMotion', type: 'animation' });
  const clip = {
    name: 'attack',
    duration: 1000,
    loop: false,
    tracks: {},
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0 },
        { time: 1000, x: 80 },
      ],
    },
  };
  const runner = new SceneRunner(copied, {
    createActor: (actor) =>
      new Actor({
        id: actor.id,
        puppetOwnership: 'owned',
        puppet: new Puppet(puppetScene(), {
          autoUpdate: false,
          rig: { root: 'root', bones: [{ id: 'root' }] },
          animations: [clip],
        }),
      }),
  });
  try {
    runner.seek(2000);
    expect(runner.actors.get('actor-17')!.position.x).toBe(1080);
    runner.seek(1200);
    runner.seek(2000);
    expect(runner.actors.get('actor-17')!.position.x).toBe(1080);
  } finally {
    runner.dispose();
  }
  const target = destination();
  target.actions.push({
    id: 'existing-move',
    actorId: 'actor-17',
    type: 'move',
    time: 1000,
    duration: 1000,
    destination: { x: 1200, y: 100 },
  });
  expect(() => insert(1000, entry, target)).toThrow(/Conflicting animation ownership/);
  expect(() =>
    insertChoreography(destination(), entry, {
      time: 0,
      actors: mapping,
      rigIdentity,
      validation: { characters: new Map([[manifest, { ...assets, rootMotionAnimations: [] }]]) },
    }),
  ).toThrow(/no root-motion/);
});

test('optional audio/dialogue, camera and fades shift together and retain asset identities with remapped local links', () => {
  const scene = source();
  const entry = captureChoreography(scene, {
    id: 'all',
    name: 'All',
    actionIds: scene.actions.map((action) => action.id),
    rigIdentity,
    includeCamera: true,
    includeTransitions: true,
    includeAudioDialogue: true,
  });
  const copied = insert(4000, entry);
  expect(copied.audioAssets![0]!.id).toBe('voice');
  expect(copied.audioClips![0]).toMatchObject({ time: 4500, sourceOffset: 100, trackId: copied.audioTracks![0]!.id });
  expect(copied.dialogue![0]).toMatchObject({
    time: 4500,
    actorId: 'actor-17',
    voiceClipId: copied.audioClips![0]!.id,
  });
  expect(copied.cameraTracks!.x!.map((key) => key.time)).toEqual([4000, 5500]);
  expect(copied.transitions![0]!.time).toBe(5600);
  expect(copied.audioClips![0]!.id).not.toBe('spoken');
  expect(copied.dialogue![0]!.id).not.toBe('line');
  expect(copied.cameraTracks!.x![0]!.id).not.toBe('cam-a');
  expect(parseSceneJson(serializeSceneDefinition(copied))).toEqual(copied);
});

test('movement, camera, fade and dialogue collisions and authoritative audio references use existing validators', () => {
  const original = source();
  const entry = captureChoreography(original, {
    id: 'all',
    name: 'All',
    actionIds: original.actions.map((action) => action.id),
    rigIdentity,
    includeCamera: true,
    includeTransitions: true,
    includeAudioDialogue: true,
  });
  const move = insert(4000);
  expect(() => insert(4000, entry, move)).toThrow(/Conflicting/);
  const camera = destination();
  camera.cameraTracks = { x: [{ id: 'collision', time: 4500, value: 0 }] };
  expect(() => insert(4000, entry, camera)).toThrow(/Camera x collides/);
  const fade = destination();
  fade.transitions = [{ id: 'existing', type: 'fade-in', time: 5500, duration: 500, color: '#000000' }];
  expect(() => insert(4000, entry, fade)).toThrow(/Fade intervals must not overlap/);
  const dialogue = destination();
  dialogue.dialogue = [{ id: 'existing', time: 4400, duration: 500, text: 'Busy' }];
  expect(() => insert(4000, entry, dialogue)).toThrow(/Dialogue intervals must not overlap/);
  expect(() =>
    insertChoreography(destination(), entry, {
      time: 0,
      actors: mapping,
      rigIdentity,
      validation: { ...validation, getAudioAssets: () => [] },
    }),
  ).toThrow(/Missing audio asset/);
});

test('cross-range voice dependencies fail capture; dangling references and callback payloads fail import', () => {
  const scene = source();
  scene.audioClips![0]!.duration = 1900;
  expect(() =>
    captureChoreography(scene, {
      id: 'bad',
      name: 'Bad',
      actionIds: scene.actions.map((action) => action.id),
      rigIdentity,
      includeAudioDialogue: true,
    }),
  ).toThrow(/crosses the selected range/);
  const library = { ...emptySceneReuseLibrary(), choreographies: [preset()] };
  library.choreographies[0]!.scene.actions[0]!.actorId = 'missing';
  expect(() => parseSceneReuseLibrary(library)).toThrow(/Unknown actor/);
  const callback = source();
  (callback.actions.at(-1) as { payload: unknown }).payload = () => {};
  expect(() => preset(callback)).toThrow(/JSON/);
  const role = preset();
  role.roles[0]!.id = 'missing';
  expect(() => parseSceneReuseLibrary({ ...emptySceneReuseLibrary(), choreographies: [role] })).toThrow(
    /exactly one role/,
  );
});

test('insertion commits one Undo/Redo snapshot; multiple-action selection is view state', () => {
  const document = new SceneEditorDocument(validation);
  document.createSceneCopy(destination());
  const before = document.workingScene;
  const proposal = insert(4000);
  expect(document.canUndo).toBe(false);
  expect(document.workingScene).toBe(before);
  expect(document.replaceScene(proposal)).toBe(true);
  document.selectAction(proposal.actions[0]!.id);
  document.selectAction(proposal.actions[1]!.id, true);
  expect(document.selectedActionIds).toHaveLength(2);
  const other = proposal.actions.find((action) => action.actorId === 'actor-23')!;
  document.selectAction(other.id, true);
  expect(document.selectedActorId).toBe('actor-23');
  document.selectAction(other.id, true);
  expect(document.selectedActorId).toBe('actor-17');
  expect(document.undo()).toBe(true);
  expect(document.workingScene).toEqual(before);
  expect(document.selectedActionIds).toEqual([]);
  expect(document.canUndo).toBe(false);
  expect(document.redo()).toBe(true);
  expect(document.workingScene).toEqual(proposal);
});

test('templates create isolated scenes with fresh local IDs, preserved shared assets and all reference remapping', () => {
  const scene = source();
  scene.layers = [
    { id: 'background', name: 'Background', visible: true, parallax: 0 },
    { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
    { id: 'forest', name: 'Forest', visible: true, parallax: 0.5 },
  ];
  scene.images = [
    {
      id: 'tree',
      layerId: 'forest',
      image: 'images/tree.png',
      position: { x: 1, y: 2 },
      scale: { x: 1, y: 1 },
      visible: true,
      order: 0,
    },
  ];
  const template = freezeData(
    captureSceneTemplate(scene, {
      id: 'forest-template',
      name: 'Forest',
      actors: true,
      timeline: true,
      audioDialogue: true,
    }),
  );
  const created = createSceneFromTemplate(template, { id: 'new-scene', name: 'New scene' });
  const again = createSceneFromTemplate(template, { id: 'another-scene', name: 'Another scene' });
  expect(created.actors[0]!.id).not.toBe('a');
  expect(created.actors[0]!.id).not.toBe(again.actors[0]!.id);
  expect(created.actions[0]!.actorId).toBe(created.actors[0]!.id);
  expect(created.actions.find((action) => action.type === 'face')).toMatchObject({
    target: { actorId: created.actors[1]!.id },
  });
  expect(created.dialogue![0]).toMatchObject({
    actorId: created.actors[0]!.id,
    voiceClipId: created.audioClips![0]!.id,
  });
  expect(created.images![0]!.layerId).toBe(created.layers![2]!.id);
  expect(created.images![0]!.image).toBe('images/tree.png');
  expect(created.actors[0]!.character.manifest).toBe(manifest);
  expect(created.audioAssets![0]!.id).toBe('voice');
  expect(created.cameraTracks!.x![0]!.id).not.toBe('cam-a');
  created.actors[0]!.position.x = 999;
  expect(template.scene.actors[0]!.position.x).toBe(0);
  expect(scene.actors[0]!.position.x).toBe(0);
  expect(() => createSceneFromTemplate(template, { id: scene.id, name: 'Collision' })).toThrow(/new scene ID/);
});

test('layout-only templates drop timelines and audio by default and optional actor removal preserves speaker text', () => {
  const scene = source();
  const layout = captureSceneTemplate(scene, {
    id: 'layout',
    name: 'Layout',
    actors: false,
    timeline: false,
    audioDialogue: false,
  });
  expect(layout.scene.actors).toEqual([]);
  expect(layout.scene.actions).toEqual([]);
  expect(layout.scene.cameraTracks).toBeUndefined();
  expect(layout.scene.audioAssets).toBeUndefined();
  const narration = captureSceneTemplate(scene, {
    id: 'narration',
    name: 'Narration',
    actors: false,
    timeline: true,
    audioDialogue: true,
  });
  expect(narration.scene.actions).toEqual([]);
  expect(narration.scene.dialogue![0]).toMatchObject({ speakerName: 'a' });
  expect(narration.scene.dialogue![0]).not.toHaveProperty('actorId');
});

async function projectFixture() {
  const project = new ProjectWorkspace('Film', 'film');
  const fixture = artworkFixture();
  const files = new Map(
    Object.entries(fixture.documents).map(([path, value]) => [
      path,
      value instanceof Uint8Array ? new Uint8Array(value) : new TextEncoder().encode(JSON.stringify(value)),
    ]),
  );
  await project.addCharacter(files, 'Samurai');
  project.addAudio(
    { id: 'voice', name: 'Voice', path: 'audio/voice.wav', category: 'voice' },
    new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url))),
  );
  const image = fixture.documents['images/paper.png'] as Uint8Array<ArrayBuffer>;
  project.scenes.images.register('../images/forest.png', image);
  const scene = source();
  scene.actors.forEach((actor) => {
    actor.character.manifest = project.characterReference('hero');
  });
  scene.actions = scene.actions.filter((action) => action.type !== 'animation');
  scene.images = [
    {
      id: 'forest',
      image: '../images/forest.png',
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      visible: true,
      order: 0,
    },
  ];
  scene.audioAssets![0]!.path = '../audio/voice.wav';
  delete scene.audioAssets![0]!.durationSeconds;
  project.addScene(scene);
  const entry = captureChoreography(scene, {
    id: 'bows',
    name: 'Bows',
    actionIds: scene.actions.map((action) => action.id),
    rigIdentity,
    includeAudioDialogue: true,
  });
  const template = captureSceneTemplate(scene, {
    id: 'forest',
    name: 'Forest',
    actors: true,
    timeline: true,
    audioDialogue: true,
  });
  project.setSceneReuse({ version: 1, choreographies: [entry], templates: [template] });
  return { project, scene };
}

test('project package and local draft round trips retain libraries, shared dependencies and independent copies', async () => {
  const { project } = await projectFixture();
  const before = project.sceneReuse;
  const restored = await importProjectPackage((await buildProjectPackage(project)).files);
  expect(restored.sceneReuse).toEqual(before);
  const recovered = await importProjectPackage(await buildProjectDraft(project));
  expect(recovered.sceneReuse).toEqual(before);
  project.undo();
  expect(project.sceneReuse.templates).toHaveLength(0);
  project.redo();
  expect(project.sceneReuse).toEqual(before);
  const created = createSceneFromTemplate(restored.sceneReuse.templates[0]!, {
    id: 'from-template',
    name: 'From template',
  });
  restored.addScene(created);
  restored.scenes.updateProperties({ name: 'Modified copy' });
  expect(restored.sceneReuse.templates[0]!.scene.name).not.toBe('Modified copy');
  expect(restored.scenes.scene('meeting')!.name).not.toBe('Modified copy');
  expect(restored.inspect('export', true).counts.error).toBe(0);
});

test('reusable assets retain artwork and block dependency removal even after source scene removal', async () => {
  const { project } = await projectFixture();
  project.remove('scenes', 'meeting');
  expect(project.scenes.cleanupImages()).toBe(0);
  expect(() => project.remove('characters', 'hero')).toThrow(/Reusable asset/);
  expect(() => project.removeAudio('voice')).toThrow(/Reusable asset/);
  expect(project.inspect('export', true).counts.error).toBe(0);
  const imported = await importProjectPackage((await buildProjectPackage(project)).files);
  expect(imported.definition.scenes).toHaveLength(0);
  expect(imported.sceneReuse.templates).toHaveLength(1);
  expect(imported.scenes.images.has('../images/forest.png')).toBe(true);
});

test('invalid reusable references block project export and portable library import never replaces the source', async () => {
  const { project } = await projectFixture();
  const library = parseSceneReuseLibrary(JSON.parse(JSON.stringify(project.sceneReuse)) as unknown);
  library.templates[0]!.scene.actors[0]!.character.manifest = 'characters/missing/character.json';
  project.setSceneReuse(library);
  expect(
    project.inspect('export', true).issues.some((issue) => /Reusable asset.*Unknown character/.test(issue.message)),
  ).toBe(true);
  await expect(buildProjectPackage(project)).rejects.toThrow();
  const sourceLibrary = freezeData({ ...emptySceneReuseLibrary(), choreographies: [preset()] });
  const imported = parseSceneReuseLibrary(JSON.parse(JSON.stringify(sourceLibrary)) as unknown);
  imported.choreographies[0]!.name = 'Edited import';
  expect(sourceLibrary.choreographies[0]!.name).toBe('Two Samurai Bow');
});

test('single-scene inspection excludes unrelated reusable-library source characters', async () => {
  const { project } = await projectFixture();
  expect(project.inspect('export', true, createEmptyScene({ id: 'empty' })).counts.error).toBe(0);
});

test('a different character sharing the explicit rig identity may receive the choreography', () => {
  const target = destination();
  const alternate = 'characters/variant/character.json';
  target.actors[1]!.character.manifest = alternate;
  const copied = insertChoreography(target, preset(), {
    time: 1000,
    actors: mapping,
    rigIdentity,
    validation: {
      characters: new Map([
        [manifest, assets],
        [alternate, assets],
      ]),
    },
  });
  expect(copied.actions.filter((action) => action.actorId === 'actor-23')).toHaveLength(4);
  expect(copied.actors[1]!.character.manifest).toBe(alternate);
});

test('project import rejects reusable templates whose shared assets are absent', async () => {
  const { project } = await projectFixture();
  const files = new Map((await buildProjectPackage(project)).files);
  const archive = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as {
    project: { sceneReuse: ReturnType<typeof parseSceneReuseLibrary> };
  };
  archive.project.sceneReuse.templates[0]!.scene.images![0]!.image = '../images/missing.png';
  files.set('project.json', new TextEncoder().encode(JSON.stringify(archive)));
  await expect(importProjectPackage(files)).rejects.toThrow(/Missing image/);
});
