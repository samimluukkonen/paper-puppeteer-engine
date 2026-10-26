import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import type Phaser from 'phaser';
import { expect, test, vi } from 'vitest';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { Actor } from '../src/engine/Actor.js';
import { cinematicFrame } from '../src/engine/cinematicCamera.js';
import { Puppet } from '../src/engine/Puppet.js';
import { createEmptyScene, parseSceneDefinition } from '../src/engine/SceneDefinition.js';
import { getDialogueAtTime, type ActiveSceneDialogue } from '../src/engine/sceneDialogue.js';
import { SceneDialogueOverlay } from '../src/engine/SceneDialogueOverlay.js';
import { SceneLoader } from '../src/engine/SceneLoader.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner, type SceneCue } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function source() {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'dialogue-playback', duration: 4000 }),
    actors: [{ id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } }],
    actions: [
      { id: 'walk', actorId: 'hero', type: 'move', time: 0, duration: 4000, destination: { x: 100, y: 0 } },
      ...[0, 500, 500, 2000, 4000].map((time, index) => ({
        id: `cue-${index}`,
        actorId: 'hero',
        type: 'cue',
        name: `event-${index}`,
        time,
        payload: { sound: 'sword' },
      })),
    ],
    dialogue: [
      { id: 'opening', text: 'Narration', time: 0, duration: 500 },
      { id: 'hero-line', actorId: 'hero', text: 'Prepare yourself.\n森は静かだった。', time: 500, duration: 1500 },
      { id: 'reply', speakerName: 'Voice over', text: 'Ready.', time: 2000, duration: 1000 },
    ],
    cameraTracks: {
      x: [
        { id: 'pan-start', time: 0, value: 0 },
        { id: 'pan-end', time: 4000, value: 200 },
      ],
      zoom: [
        { id: 'zoom-start', time: 0, value: 1 },
        { id: 'zoom-end', time: 4000, value: 2 },
      ],
    },
    transitions: [{ id: 'fade', type: 'fade-out', color: '#000000', time: 1000, duration: 1000 }],
  });
}
function factory() {
  const scene = puppetScene();
  return (data: { id: string }) =>
    new Actor({
      id: data.id,
      puppetOwnership: 'owned',
      puppet: new Puppet(scene, { rig: { root: 'root', bones: [{ id: 'root' }] }, autoUpdate: false }),
    });
}
function stage() {
  const scene = puppetScene();
  const events = new EventEmitter();
  Object.assign(scene, { events, sys: { isActive: () => true } });
  const addContainer = scene.add.container.bind(scene.add);
  const roots: Phaser.GameObjects.Container[] = [];
  vi.spyOn(scene.add, 'container').mockImplementation((...args) => {
    const root = addContainer(...args);
    roots.push(root);
    return root;
  });
  const textObjects: Phaser.GameObjects.Text[] = [];
  const addText = scene.add.text.bind(scene.add);
  const texts = vi.spyOn(scene.add, 'text').mockImplementation((x, y, text, style) => {
    const object = addText(x, y, text, style);
    textObjects.push(object);
    object.text = typeof text === 'string' ? text : text.join('\n');
    object.height = 30;
    Object.assign(object, {
      setText(value: string) {
        object.text = value;
        object.height = value.split('\n').length * 30;
        return object;
      },
    });
    return object;
  });
  const addGraphics = scene.add.graphics.bind(scene.add);
  vi.spyOn(scene.add, 'graphics').mockImplementation((...args) => {
    const object = addGraphics(...args);
    Object.assign(object, { fillRect: () => object });
    return object;
  });
  return { scene, events, roots, texts, textObjects };
}

test('resolved dialogue uses exact half-open boundaries, direct/backward samples and optional speaker metadata', () => {
  const scene = source();
  for (const [time, id] of [
    [-1, undefined],
    [0, 'opening'],
    [499.999, 'opening'],
    [500, 'hero-line'],
    [1999.999, 'hero-line'],
    [2000, 'reply'],
    [3000, undefined],
    [4000, undefined],
    [750, 'hero-line'],
    [0, 'opening'],
  ] as const)
    expect(getDialogueAtTime(scene, time)?.line.id).toBe(id);
  expect(getDialogueAtTime(scene, 0)?.speaker).toBeUndefined();
  expect(getDialogueAtTime(scene, 750)).toMatchObject({ speaker: 'hero', actor: scene.actors[0] });
  expect(getDialogueAtTime(scene, 2000)?.speaker).toBe('Voice over');
  expect(getDialogueAtTime({ ...scene, actors: [] }, 750)).toMatchObject({ speaker: 'hero', actor: undefined });
  expect(() => parseSceneDefinition({ ...scene, actors: [], actions: [] })).toThrow(/Missing Actor/);
  expect(getDialogueAtTime(createEmptyScene({ id: 'legacy' }), 0)).toBeUndefined();
  expect(() => getDialogueAtTime(scene, NaN)).toThrow(/finite/);
});

test('shipped sword/dialogue/music scene packages its real dependencies and resolves speaker/audio timings', async () => {
  const scene = parseSceneDefinition(
    JSON.parse(await readFile(new URL('../public/scenes/dialogue.scene.json', import.meta.url), 'utf8')),
  );
  const files = await buildScenePackage(scene, {
    baseUrl: 'https://example.test/scene-editor/scene.json',
    fetcher: async (input) =>
      new Response(await readFile(new URL(`../public${new URL(requestUrl(input)).pathname}`, import.meta.url))),
  });
  expect([...files.keys()].filter((key) => key.endsWith('.wav'))).toHaveLength(2);
  expect(getDialogueAtTime(scene, 2000)?.speaker).toBe('Hero');
  expect(getDialogueAtTime(scene, 4800)?.speaker).toBe('Friend');
  expect(getDialogueAtTime(scene, 7500)).toBeUndefined();
  expect(scene.audioClips?.find((clip) => clip.id === 'sword-sfx')?.time).toBe(4000);
  expect(scene.actions.find((action) => action.type === 'cue')?.time).toBe(4000);
});

test('runner presentation samples playback, pause, silent seeks, restart and stop independently from cues/fades/camera', () => {
  const scene = source();
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const setDialogue = vi.fn<(dialogue: ActiveSceneDialogue | undefined) => void>();
  const runner = new SceneRunner(scene, { createActor: factory(), onCue, dialoguePresentation: { setDialogue } });
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  runner.play();
  expect(runner.dialogue?.line.id).toBe('opening');
  runner.update(500);
  expect(setDialogue.mock.calls.at(-1)?.[0]?.line.id).toBe('hero-line');
  runner.update(0);
  expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500, 500]);
  runner.pause();
  runner.update(1000);
  expect(runner.time).toBe(500);
  expect(runner.dialogue?.line.id).toBe('hero-line');
  for (const time of [2500, 1000, 2999, 500, 0, 1500]) {
    runner.seek(time);
    expect(setDialogue).toHaveBeenLastCalledWith(getDialogueAtTime(scene, time));
    expect(runner.dialogue).toEqual(getDialogueAtTime(scene, time));
  }
  expect(runner.transition.opacity).toBe(0.5);
  expect(runner.cinematicCamera.x).toBe(75);
  expect(onCue).toHaveBeenCalledTimes(3);
  runner.play();
  runner.update(10000);
  expect(runner.status).toBe('completed');
  expect(onCue).toHaveBeenCalledTimes(5);
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  runner.restart();
  expect(onCue).toHaveBeenCalledTimes(6);
  expect(runner.dialogue?.line.id).toBe('opening');
  runner.stop();
  expect(runner.dialogue).toBeUndefined();
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  runner.seek(1000);
  runner.cancel();
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  runner.restart();
  runner.dispose();
  runner.dispose();
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  expect(runner.actors.size).toBe(0);
});

test('presentation failures stop cues and initialization/disposal still release owned Actors and clear text', () => {
  const create = factory();
  const actors: Actor[] = [];
  const createActor = (data: { id: string }) => {
    const actor = create(data);
    actors.push(actor);
    return actor;
  };
  const setDialogue = vi.fn<(dialogue: ActiveSceneDialogue | undefined) => void>();
  setDialogue.mockImplementationOnce(() => {
    throw new Error('UI failed');
  });
  expect(() => new SceneRunner(source(), { createActor, dialoguePresentation: { setDialogue } })).toThrow('UI failed');
  expect(actors.every((actor) => actor.isDisposed)).toBe(true);
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const runner = new SceneRunner(source(), { createActor, onCue, dialoguePresentation: { setDialogue } });
  runner.play();
  setDialogue.mockImplementationOnce(() => {
    throw new Error('render failed');
  });
  expect(() => runner.update(100)).toThrow('render failed');
  expect(runner.status).toBe('failed');
  expect(runner.dialogue).toBeUndefined();
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  runner.update(3000);
  expect(onCue).toHaveBeenCalledTimes(1);
  runner.dispose();
  expect(actors.every((actor) => actor.isDisposed)).toBe(true);
});

test('editor samples survive pause/seek/restart and reset on scene switch/disposal without authored mutations', () => {
  const scene = source();
  const original = JSON.stringify(scene);
  const playback = new SceneEditorPlayback();
  const createActor = factory();
  playback.sync(scene, true, createActor);
  playback.seek(1000);
  expect(getDialogueAtTime(scene, playback.time)?.line.id).toBe('hero-line');
  playback.play();
  playback.pause();
  playback.update(999);
  expect(playback.time).toBe(1000);
  playback.restart();
  expect(playback.time).toBe(0);
  playback.stop();
  expect(playback.previewing).toBe(false);
  playback.sync(createEmptyScene({ id: 'other' }), true, createActor);
  expect(playback.time).toBe(0);
  expect(playback.status).toBe('stopped');
  playback.dispose();
  expect(playback.ready).toBe(false);
  expect(JSON.stringify(scene)).toBe(original);
});

test('default overlay wraps literal multiline text, projects the output safe area above fades and releases on shutdown', () => {
  const { scene, roots, texts, textObjects, events } = stage();
  const overlay = new SceneDialogueOverlay(scene);
  const root = roots[0]!;
  const speaker = textObjects[0]!;
  const text = textObjects[1]!;
  expect(root.depth).toBe(8500);
  overlay.setDialogue(getDialogueAtTime(source(), 1000));
  expect(root.visible).toBe(true);
  expect(speaker.text).toBe('hero');
  expect(text.text).toBe('Prepare yourself.\n森は静かだった。');
  expect(texts.mock.calls[1]![3]).toMatchObject({ wordWrap: { width: 864, useAdvancedWrap: true } });
  for (const camera of [
    { x: 0, y: 0, zoom: 1 },
    { x: 150, y: -80, zoom: 2 },
    { x: -100, y: 90, zoom: 0.5 },
  ]) {
    overlay.setCamera(camera);
    const frame = cinematicFrame(camera);
    expect(root.x).toBe(frame.x);
    expect(root.y).toBe(frame.y);
    expect(root.scaleX * camera.zoom).toBe(1);
    expect(text.x).toBe(68);
    expect(text.y + text.height * text.scaleY).toBeLessThan(664);
  }
  overlay.setDialogue(getDialogueAtTime(source(), 0));
  expect(speaker.visible).toBe(false);
  expect(text.text).toBe('Narration');
  overlay.setDialogue(undefined);
  expect(root.visible).toBe(false);
  const destroy = vi.spyOn(root, 'destroy');
  events.emit('shutdown');
  overlay.dispose();
  overlay.setDialogue(getDialogueAtTime(source(), 1000));
  expect(destroy).toHaveBeenCalledOnce();
  expect(events.listenerCount('shutdown')).toBe(0);
});

test('standalone package loader supplies subtitles by default, accepts custom or disabled presentation and cleans up', async () => {
  const scene = parseSceneDefinition({
    ...createEmptyScene({ id: 'standalone' }),
    dialogue: [{ id: 'line', speakerName: 'Hero', text: 'Hello\nWorld', time: 500, duration: 2000 }],
  });
  const files = await buildScenePackage(scene, { baseUrl: 'https://example.test/scene.json' });
  const stageA = stage();
  const loaded = await SceneLoader.loadPackage(stageA.scene, files);
  const text = stageA.textObjects[1]!;
  const camera = { width: 1600, height: 900, setViewport: vi.fn(), setZoom: vi.fn(), centerOn: vi.fn() };
  const viewport = loaded.applyCamera(camera);
  expect(viewport.width).toBeCloseTo(1285.7142857142858);
  expect(viewport.height).toBeCloseTo(900);
  expect(viewport.x).toBeCloseTo(157.1428571428571);
  expect(viewport.y).toBeCloseTo(0);
  loaded.runner.seek(1000);
  expect(text.text).toBe('Hello\nWorld');
  loaded.runner.seek(3000);
  expect(text.text).toBe('');
  loaded.runner.seek(750);
  expect(text.text).toBe('Hello\nWorld');
  loaded.dispose();
  loaded.dispose();
  expect(stageA.scene.events.listenerCount('shutdown')).toBe(0);
  const stageB = stage();
  const setDialogue = vi.fn<(dialogue: ActiveSceneDialogue | undefined) => void>();
  const custom = await SceneLoader.loadPackage(stageB.scene, files, { dialoguePresentation: { setDialogue } });
  custom.runner.seek(1000);
  expect(setDialogue).toHaveBeenLastCalledWith(getDialogueAtTime(scene, 1000));
  expect(stageB.texts).not.toHaveBeenCalled();
  custom.dispose();
  expect(setDialogue).toHaveBeenLastCalledWith(undefined);
  const disabled = await SceneLoader.loadPackage(stageB.scene, files, { dialoguePresentation: false });
  disabled.runner.seek(1000);
  expect(disabled.runner.dialogue?.line.text).toBe('Hello\nWorld');
  expect(stageB.texts).not.toHaveBeenCalled();
  disabled.dispose();
});
