import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { expect, test, vi } from 'vitest';
import { AudioAssetLoader } from '../src/engine/AudioAssetLoader.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { StoryAudioPool } from '../src/engine/StoryAudioPool.js';
import { buildStoryPackage } from '../src/engine/StoryPackage.js';
import { StoryPackageLoader } from '../src/engine/StoryPackageLoader.js';
import { StoryPlayer } from '../src/engine/StoryPlayer.js';
import { puppetScene } from './helpers/puppetScene.js';
import { assetFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Loader: {
      Events: { ADD: 'addfile', FILE_LOAD_ERROR: 'loaderror', FILE_COMPLETE: 'filecomplete', COMPLETE: 'complete' },
    },
  },
}));
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
function audioBackend() {
  let voices = 0;
  const resourceDispose = vi.fn();
  const backend = {
    running: false,
    resume: vi.fn(() => {
      backend.running = true;
      return Promise.resolve();
    }),
    decode: vi.fn(() =>
      Promise.resolve({
        durationSeconds: 2,
        byteLength: 64000,
        play: vi.fn(() => {
          throw new Error('Unexpected audition');
        }),
        playTimeline: vi.fn(() => {
          voices++;
          let stopped = false;
          return {
            elapsed: 0,
            ended: false,
            setVolume() {},
            stop() {
              if (!stopped) voices--;
              stopped = true;
            },
          };
        }),
        dispose: resourceDispose,
      }),
    ),
    dispose: vi.fn(),
  };
  return { backend, resourceDispose, voices: () => voices };
}

test('audio leases share one decode/context, retain next-scene samples and release the last consumer', async () => {
  const f = audioBackend();
  const pool = new StoryAudioPool(f.backend);
  const a = new AudioAssetLoader(() => undefined, pool.lease());
  const b = new AudioAssetLoader(() => undefined, pool.lease());
  await a.prepare(bytes);
  await b.prepare(bytes);
  expect(f.backend.decode).toHaveBeenCalledOnce();
  expect(f.backend.resume).not.toHaveBeenCalled();
  await a.unlock();
  expect(b.running).toBe(true);
  a.dispose();
  expect(f.resourceDispose).not.toHaveBeenCalled();
  expect(f.backend.dispose).not.toHaveBeenCalled();
  b.dispose();
  expect(f.resourceDispose).toHaveBeenCalledOnce();
  pool.dispose();
  pool.dispose();
  expect(f.backend.dispose).toHaveBeenCalledOnce();
});

test('portable standalone adapter preloads with no Actors, resets clocks, owns audio and disposes listeners', async () => {
  const events = new EventEmitter();
  const base = puppetScene();
  const graphics = { setDepth: vi.fn().mockReturnThis(), clear() {}, fillStyle() {}, fillRect() {}, destroy: vi.fn() };
  const camera = {
    width: 1000,
    height: 700,
    scrollX: -500,
    scrollY: -350,
    zoom: 1,
    setViewport() {},
    setZoom() {},
    centerOn() {},
  };
  const scene = Object.assign(base, {
    events,
    load: Object.assign(new EventEmitter(), { start() {} }),
    sys: { isActive: () => true },
    cameras: { main: camera },
    add: Object.assign(base.add, { graphics: () => graphics }),
  }) as unknown as Phaser.Scene;
  const assets = assetFixture();
  const scenes = new Map(
    ['a', 'b', 'c'].map((id) => {
      const definition = createEmptyScene({ id, duration: 100 });
      definition.actors = [
        { id: 'hero', character: { manifest: 'characters/hero/character.json' }, position: { x: 0, y: 0 } },
      ];
      definition.dialogue = [{ id: 'opening', time: 0, duration: 0, text: id, progression: 'advance-required' }];
      definition.audioAssets = [{ id: 'tone', name: 'Tone', path: 'audio/tone.wav', category: 'music' }];
      definition.audioTracks = [{ id: 'music', name: 'Music', category: 'music' }];
      definition.audioClips = [
        {
          id: 'bed',
          assetId: 'tone',
          trackId: 'music',
          time: 0,
          duration: 100,
          sourceOffset: 0,
          volume: 1,
          loop: true,
        },
      ];
      return [id, definition];
    }),
  );
  const story = {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: [...scenes.keys()].map((sceneAssetId, index) => ({
      id: sceneAssetId,
      sceneAssetId,
      ...(index === 1 ? { transition: { type: 'fade', duration: 100, color: '#000000' } } : {}),
    })),
  };
  const files = await buildStoryPackage(story, {
    scenes,
    buildScene: (definition) => buildScenePackage(definition, { ...assets, loadAudio: () => Promise.resolve(bytes) }),
  });
  const audio = audioBackend();
  const source = await StoryPackageLoader.load(scene, files, {
    audioBackend: audio.backend,
    dialoguePresentation: false,
  });
  const player = new StoryPlayer(source.definition, source);
  await player.start();
  const first = player.currentSession!.runner;
  expect(first.status).toBe('waiting-for-dialogue-advance');
  await vi.waitFor(() => expect(audio.backend.decode).toHaveBeenCalledOnce());
  const runner = player.currentSession!.runner;
  if (!(runner instanceof SceneRunner)) throw new Error('Expected a SceneRunner.');
  await runner.audio!.unlock();
  player.advanceDialogue();
  await player.update(50);
  expect(audio.voices()).toBe(1);
  await player.update(50);
  expect(player.status).toBe('transitioning');
  expect(audio.voices()).toBe(0);
  await player.update(50);
  expect(first.status).toBe('disposed');
  await player.update(50);
  expect(player.currentSession!.runner.status).toBe('waiting-for-dialogue-advance');
  expect(audio.backend.decode).toHaveBeenCalledOnce();
  player.advanceDialogue();
  await player.update(100);
  expect(player.index).toBe(2);
  expect(player.currentSession!.runner.status).toBe('waiting-for-dialogue-advance');
  player.advanceDialogue();
  await player.update(100);
  expect(player.status).toBe('completed');
  expect(audio.voices()).toBe(0);
  player.dispose();
  source.dispose!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(audio.backend.dispose).toHaveBeenCalledOnce();
  expect(audio.resourceDispose).toHaveBeenCalledOnce();
  expect(graphics.destroy).toHaveBeenCalledOnce();
  expect(events.listenerCount('shutdown')).toBe(0);
  expect(events.listenerCount('prerender')).toBe(0);
});
