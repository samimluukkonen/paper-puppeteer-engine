import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { afterEach, expect, test, vi } from 'vitest';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { Actor } from '../src/engine/Actor.js';
import type { AudioAssetDefinition } from '../src/engine/AudioAsset.js';
import {
  WebAudioBackend,
  type TimelineAudioOptions,
  type DecodedAudioResource,
} from '../src/engine/AudioAssetLoader.js';
import { Puppet } from '../src/engine/Puppet.js';
import { getActiveAudioClipsAtTime, type SceneAudioClip } from '../src/engine/sceneAudio.js';
import { SceneAudioController } from '../src/engine/SceneAudioController.js';
import { createEmptyScene, parseSceneDefinition } from '../src/engine/SceneDefinition.js';
import { SceneLoader } from '../src/engine/SceneLoader.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
const asset: AudioAssetDefinition = {
  id: 'tone',
  name: 'Tone',
  category: 'sfx',
  path: 'audio/tone.wav',
  durationSeconds: 2,
};
const clip: SceneAudioClip = {
  id: 'effect',
  assetId: 'tone',
  trackId: 'effects',
  time: 1000,
  duration: 1000,
  sourceOffset: 200,
  volume: 0.6,
  loop: false,
};
function definition(clips: SceneAudioClip[] = [clip]) {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'audio-playback', duration: 6000 }),
    audioAssets: [asset],
    audioTracks: [{ id: 'effects', name: 'Effects', category: 'sfx' }],
    audioClips: clips,
  });
}
function fixture(clips: SceneAudioClip[] = [clip]) {
  let clock = 0;
  const voices: {
    options: TimelineAudioOptions;
    stop: ReturnType<typeof vi.fn>;
    position: { ended: boolean; offset: number };
  }[] = [];
  const playTimeline = vi.fn((options: TimelineAudioOptions) => {
    const start = clock;
    const stop = vi.fn();
    const position = { ended: false, offset: 0 };
    voices.push({ options, stop, position });
    return {
      stop,
      setVolume: vi.fn(),
      get elapsed() {
        return (clock - start) * options.rate + position.offset;
      },
      get ended() {
        return position.ended;
      },
    };
  });
  const disposeResource = vi.fn();
  const resource: DecodedAudioResource = {
    durationSeconds: 2,
    byteLength: 64000,
    play: vi.fn(() => {
      throw new Error('Audition must not be used');
    }),
    playTimeline,
    dispose: disposeResource,
  };
  const backend = {
    running: true,
    resume: vi.fn(() => Promise.resolve()),
    decode: vi.fn(() => Promise.resolve(resource)),
    dispose: vi.fn(),
  };
  const scene = definition(clips);
  const options = { backend, resolve: (id: string) => (id === 'tone' ? { definition: asset, bytes } : undefined) };
  const audio = new SceneAudioController(scene, options);
  return {
    audio,
    backend,
    resource,
    disposeResource,
    options,
    scene,
    playTimeline,
    voices,
    advance: (milliseconds: number) => {
      clock += milliseconds / 1000;
    },
  };
}
const noActor = () => {
  throw new Error('No Actors expected');
};

test('dialogue voice metadata and sound cue payloads coexist with exactly one audio timeline voice', async () => {
  const f = fixture();
  const onCue = vi.fn();
  const runner = new SceneRunner(
    {
      ...f.scene,
      actors: [{ id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } }],
      actions: [
        { id: 'impact', actorId: 'hero', type: 'cue', name: 'sword', time: 1000, payload: { audioClipId: clip.id } },
      ],
      dialogue: [{ id: 'spoken', actorId: 'hero', text: 'Ready!', time: 1000, duration: 1000, voiceClipId: clip.id }],
    },
    {
      createActor: (data) =>
        new Actor({
          id: data.id,
          puppetOwnership: 'owned',
          puppet: new Puppet(puppetScene(), { rig: { root: 'root', bones: [{ id: 'root' }] }, autoUpdate: false }),
        }),
      audio: f.options,
      onCue,
    },
  );
  await runner.audio!.unlock();
  runner.play();
  f.advance(1000);
  runner.update(1000);
  expect(runner.dialogue?.line.id).toBe('spoken');
  expect(f.playTimeline).toHaveBeenCalledOnce();
  expect(onCue).toHaveBeenCalledOnce();
  runner.update(0);
  expect(f.playTimeline).toHaveBeenCalledOnce();
  runner.pause();
  for (const time of [1500, 0, 1000, 1700]) runner.seek(time);
  expect(f.playTimeline).toHaveBeenCalledOnce();
  expect(onCue).toHaveBeenCalledOnce();
  runner.play();
  expect(f.playTimeline).toHaveBeenCalledTimes(2);
  expect(f.voices[1]!.options.offset).toBeCloseTo(0.9);
  runner.dispose();
  expect(f.voices.every((voice) => voice.stop.mock.calls.length === 1)).toBe(true);
  expect(f.backend.dispose).toHaveBeenCalledOnce();
});

test('pure half-open clip intervals, offsets, finite loops and multiplicative fades', () => {
  const scene = definition([{ ...clip, loop: true, duration: 4000, fadeIn: 3000, fadeOut: 3000 }]);
  expect(getActiveAudioClipsAtTime(scene, 999)).toEqual([]);
  expect(getActiveAudioClipsAtTime(scene, 1000)[0]).toMatchObject({ elapsed: 0, sourcePosition: 200, volume: 0 });
  expect(getActiveAudioClipsAtTime(scene, 3000)[0]).toMatchObject({
    elapsed: 2000,
    sourcePosition: 400,
    remaining: 2000,
  });
  expect(getActiveAudioClipsAtTime(scene, 3000)[0]!.volume).toBeCloseTo((((0.6 * 2) / 3) * 2) / 3);
  expect(getActiveAudioClipsAtTime(scene, 5000)).toEqual([]);
  expect(getActiveAudioClipsAtTime(scene, NaN)).toEqual([]);
  expect(getActiveAudioClipsAtTime(scene, 3000, new Map([['tone', 1000]]))[0]!.sourcePosition).toBe(600);
});

test('one scene clock starts and ends overlapping clips without per-frame restarts', async () => {
  const f = fixture([clip, { ...clip, id: 'second', time: 1500 }]);
  const runner = new SceneRunner(f.scene, { createActor: noActor, audio: f.options });
  await runner.audio!.unlock();
  runner.play();
  runner.update(1000);
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  expect(f.voices[0]!.options).toMatchObject({ offset: 0.2, remaining: 1, volume: 0.6, rate: 1 });
  for (let i = 0; i < 30; i++) {
    f.advance(10);
    runner.update(10);
  }
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  f.advance(200);
  runner.update(200);
  expect(f.playTimeline).toHaveBeenCalledTimes(2);
  f.advance(500);
  runner.update(500);
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  expect(f.voices[1]!.stop).not.toHaveBeenCalled();
  f.advance(500);
  runner.update(500);
  expect(f.voices[1]!.stop).toHaveBeenCalledOnce();
  runner.dispose();
  f.audio.dispose();
});

test('audio reconciliation uses compiled signatures, retaining equal clips and restarting edited clips', async () => {
  const f = fixture();
  await f.audio.unlock();
  const stringify = vi.spyOn(JSON, 'stringify');
  for (let time = 1000; time <= 1200; time += 10) {
    f.audio.sync(time, true, 1);
    f.advance(10);
  }
  expect(stringify).not.toHaveBeenCalled();
  expect(f.playTimeline).toHaveBeenCalledOnce();
  f.audio.setScene(definition([{ ...clip }]));
  stringify.mockClear();
  f.audio.sync(1210, true, 1);
  expect(stringify).not.toHaveBeenCalled();
  expect(f.playTimeline).toHaveBeenCalledOnce();
  f.audio.setScene(definition([{ ...clip, volume: 0.2 }]));
  stringify.mockClear();
  f.audio.sync(1210, true, 1);
  expect(stringify).not.toHaveBeenCalled();
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  expect(f.playTimeline).toHaveBeenCalledTimes(2);
  expect(f.voices[1]!.options.volume).toBe(0.2);
  f.audio.dispose();
});

test('pause/resume, stop, restart, completion, cancellation and disposal release every voice', async () => {
  const f = fixture([{ ...clip, time: 0, loop: true, duration: 6000 }]);
  const runner = new SceneRunner(f.scene, { createActor: noActor, audio: f.options });
  await runner.audio!.unlock();
  runner.play();
  f.advance(500);
  runner.update(500);
  runner.pause();
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  f.advance(5000);
  runner.play();
  expect(f.voices[1]!.options.offset).toBeCloseTo(0.7);
  runner.stop();
  expect(runner.time).toBe(0);
  runner.restart();
  expect(f.voices[2]!.options.offset).toBe(0.2);
  runner.update(6000);
  expect(runner.status).toBe('completed');
  runner.restart();
  runner.cancel();
  runner.restart();
  runner.dispose();
  runner.dispose();
  expect(f.voices.every((voice) => voice.stop.mock.calls.length === 1)).toBe(true);
  expect(f.backend.dispose).toHaveBeenCalledOnce();
  expect(f.disposeResource).toHaveBeenCalledOnce();
});

test('rapid seeking is silent and resumes only active clips, skipping past effects', async () => {
  const f = fixture();
  const runner = new SceneRunner(f.scene, { createActor: noActor, audio: f.options });
  await runner.audio!.unlock();
  for (const time of [0, 1000, 1500, 3000, 1000, 0, 1500]) runner.seek(time);
  expect(f.playTimeline).not.toHaveBeenCalled();
  runner.play();
  expect(f.voices[0]!.options.offset).toBeCloseTo(0.7);
  runner.seek(3000);
  runner.play();
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  runner.dispose();
});

test('loops retain the authored source window and stop at the finite scene endpoint', async () => {
  const f = fixture([{ ...clip, loop: true, duration: 4000, fadeIn: 500, fadeOut: 800 }]);
  await f.audio.unlock();
  f.audio.sync(3000, true, 2);
  expect(f.voices[0]!.options).toMatchObject({
    offset: 0.4,
    remaining: 2,
    loopStart: 0.2,
    loopEnd: 2,
    elapsed: 2,
    duration: 4,
    fadeIn: 0.5,
    fadeOut: 0.8,
    rate: 2,
  });
  f.advance(500);
  f.audio.sync(4000, true, 2);
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  f.audio.sync(5000, true, 2);
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  f.audio.dispose();
});

test('drift within 80ms is retained; larger drift is corrected at most once per 250ms', async () => {
  const f = fixture([{ ...clip, time: 0, duration: 6000, loop: true }]);
  await f.audio.unlock();
  f.audio.sync(0, true, 1);
  f.advance(300);
  f.audio.sync(350, true, 1);
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  f.audio.sync(500, true, 1);
  expect(f.playTimeline).toHaveBeenCalledTimes(2);
  f.advance(100);
  f.audio.sync(900, true, 1);
  expect(f.playTimeline).toHaveBeenCalledTimes(2);
  f.advance(150);
  f.audio.sync(1000, true, 1);
  expect(f.playTimeline).toHaveBeenCalledTimes(3);
  f.audio.dispose();
});

test.each([0.25, 0.5, 1.5, 2])(
  'speed %s resynchronizes from current scene position without accumulating drift',
  async (speed) => {
    const f = fixture();
    const runner = new SceneRunner(f.scene, { createActor: noActor, audio: f.options });
    await runner.audio!.unlock();
    runner.seek(1200);
    runner.play();
    runner.speed = speed;
    expect(f.voices[1]!.options).toMatchObject({ rate: speed, offset: 0.4 });
    for (let i = 0; i < 10; i++) {
      f.advance(10);
      runner.update(10);
    }
    expect(f.playTimeline).toHaveBeenCalledTimes(2);
    runner.dispose();
  },
);

test('browser lock, context suspension, decode failure and retry are visible and silent', async () => {
  const f = fixture();
  f.audio.sync(1000, true, 1);
  expect(f.playTimeline).not.toHaveBeenCalled();
  f.backend.resume.mockRejectedValueOnce(new Error('Browser blocked audio'));
  await expect(f.audio.unlock()).rejects.toThrow('blocked');
  expect(f.audio.status).toBe('error');
  f.audio.sync(1000, true, 1);
  expect(f.playTimeline).not.toHaveBeenCalled();
  await f.audio.unlock();
  f.audio.sync(1000, true, 1);
  f.backend.running = false;
  f.audio.sync(1100, true, 1);
  expect(f.audio.error).toContain('blocked or suspended');
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  f.backend.running = true;
  await f.audio.unlock();
  expect(f.audio.status).toBe('ready');
  f.audio.dispose();
  const broken = fixture();
  broken.backend.decode.mockRejectedValueOnce(new Error('Invalid encoding'));
  await expect(broken.audio.unlock()).rejects.toThrow('Invalid encoding');
  expect(broken.playTimeline).not.toHaveBeenCalled();
  await broken.audio.unlock();
  broken.audio.dispose();
});

test('mute stops voices and unmute resumes at the current position', async () => {
  const f = fixture();
  await f.audio.unlock();
  f.audio.sync(1000, true, 1);
  f.audio.muted = true;
  f.audio.sync(1500, true, 1);
  expect(f.playTimeline).toHaveBeenCalledTimes(1);
  f.audio.muted = false;
  f.audio.sync(1500, true, 1);
  expect(f.voices[1]!.options.offset).toBe(0.7);
  f.audio.dispose();
});

test('missing scene audio stays silent through seeks and can be retried after restoring the binary', async () => {
  const f = fixture();
  let available = false;
  const runner = new SceneRunner(f.scene, {
    createActor: noActor,
    audio: { backend: f.backend, resolve: (id) => (available ? f.options.resolve(id) : undefined) },
  });
  await expect(runner.audio!.unlock()).rejects.toThrow('binary is missing');
  expect(runner.audio!.status).toBe('error');
  runner.seek(1500);
  runner.play();
  runner.update(100);
  expect(runner.time).toBe(1600);
  expect(f.playTimeline).not.toHaveBeenCalled();
  available = true;
  await runner.audio!.unlock();
  runner.update(0);
  expect(f.voices[0]!.options.offset).toBeCloseTo(0.8);
  runner.dispose();
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  expect(f.disposeResource).toHaveBeenCalledOnce();
});

test('zero volume and simultaneous playback failures remain bounded and retryable', async () => {
  const f = fixture([
    { ...clip, volume: 0 },
    { ...clip, id: 'overlap' },
  ]);
  await f.audio.unlock();
  f.playTimeline.mockImplementationOnce(() => {
    throw new Error('Output unavailable');
  });
  f.audio.sync(1000, true, 1);
  expect(f.audio.status).toBe('error');
  expect(f.audio.error).toContain('Output unavailable');
  await f.audio.unlock();
  f.audio.sync(1000, true, 1);
  expect(f.voices[0]!.options.volume).toBe(0);
  f.voices[0]!.stop.mockImplementationOnce(() => {
    throw new Error('Stop failed');
  });
  expect(() => f.audio.dispose()).toThrow('cleanup failed');
  expect(f.voices[1]!.stop).toHaveBeenCalledOnce();
  expect(f.backend.dispose).toHaveBeenCalledOnce();
});

test('audio registrations changed during loading cannot reuse an obsolete resource', async () => {
  const f = fixture();
  let finish!: (value: DecodedAudioResource) => void;
  f.backend.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.audio.unlock();
  await vi.waitFor(() => expect(f.backend.decode).toHaveBeenCalledOnce());
  f.audio.setScene({ ...f.scene, audioAssets: [{ ...asset, path: 'audio/replaced.wav' }] });
  finish(f.resource);
  await pending;
  expect(f.audio.status).toBe('locked');
  f.audio.sync(1000, true, 1);
  expect(f.playTimeline).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.disposeResource).toHaveBeenCalledOnce());
  f.audio.dispose();
});

test('clip edits are checked against actual decoded duration before audible playback', async () => {
  const f = fixture();
  await f.audio.unlock();
  f.audio.setScene({ ...f.scene, audioClips: [{ ...clip, sourceOffset: 1900 }] });
  expect(f.audio.status).toBe('error');
  expect(f.audio.error).toContain('exceeds decoded');
  f.audio.sync(1000, true, 1);
  expect(f.playTimeline).not.toHaveBeenCalled();
  f.audio.dispose();
});

test('asset replacement and scene disposal invalidate pending decodes without late sound', async () => {
  const f = fixture();
  let finish!: (value: DecodedAudioResource) => void;
  f.backend.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.audio.unlock();
  await vi.waitFor(() => expect(f.backend.decode).toHaveBeenCalledOnce());
  f.audio.dispose();
  finish(f.resource);
  await pending;
  expect(f.audio.status).toBe('disposed');
  expect(f.playTimeline).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.disposeResource).toHaveBeenCalledOnce());
});

test('unsupported audition-only adapters and decoded out-of-bounds clips report errors', async () => {
  const f = fixture();
  delete f.resource.playTimeline;
  await expect(f.audio.unlock()).rejects.toThrow('audition only');
  f.audio.dispose();
  const invalid = fixture([{ ...clip, duration: 1800 }]);
  invalid.backend.decode.mockResolvedValueOnce({ ...invalid.resource, durationSeconds: 1 });
  await expect(invalid.audio.unlock()).rejects.toThrow('exceeds decoded');
  invalid.audio.dispose();
});

test('editor Play unlocks inside the gesture; a seek cancels pending Play and audio edits retain time', async () => {
  const f = fixture();
  const editor = new SceneEditorPlayback();
  editor.sync(f.scene, true, noActor, f.options);
  editor.play();
  expect(f.backend.resume).toHaveBeenCalledOnce();
  editor.seek(1500);
  await vi.waitFor(() => expect(editor.audioStatus).toBe('ready'));
  expect(editor.status).toBe('paused');
  expect(f.playTimeline).not.toHaveBeenCalled();
  editor.play();
  expect(f.voices[0]!.options.offset).toBe(0.7);
  editor.sync(definition([{ ...clip, volume: 0.2 }]), true, noActor, f.options);
  expect(editor.time).toBe(1500);
  expect(f.voices[1]!.options.volume).toBe(0.2);
  editor.sync(definition([]), true, noActor, f.options);
  expect(editor.audioStatus).toBe('disabled');
  expect(f.voices.every((voice) => voice.stop.mock.calls.length === 1)).toBe(true);
  editor.dispose();
});

test('a newer muted Play supersedes a Restart still waiting for audio decoding', async () => {
  const f = fixture();
  let finish!: (value: DecodedAudioResource) => void;
  f.backend.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const editor = new SceneEditorPlayback();
  editor.sync(f.scene, true, noActor, f.options);
  editor.restart();
  await vi.waitFor(() => expect(f.backend.decode).toHaveBeenCalledOnce());
  editor.setAudioMuted(true);
  editor.play();
  editor.update(500);
  finish(f.resource);
  await vi.waitFor(() => expect(editor.audioStatus).toBe('ready'));
  expect(editor.time).toBe(500);
  expect(editor.status).toBe('playing');
  expect(f.playTimeline).not.toHaveBeenCalled();
  editor.dispose();
});

test('removing all audio clips clears obsolete output errors', async () => {
  const f = fixture();
  f.backend.resume.mockRejectedValueOnce(new Error('Output blocked'));
  await expect(f.audio.unlock()).rejects.toThrow('Output blocked');
  f.audio.setScene(definition([]));
  expect(f.audio.status).toBe('disabled');
  expect(f.audio.error).toBe('');
  f.audio.dispose();
});

test('restoring the last removed track reuses decoded audio and its existing browser unlock', async () => {
  const f = fixture();
  await f.audio.unlock();
  f.audio.sync(1000, true, 1);
  f.audio.setScene(definition([]));
  expect(f.audio.status).toBe('disabled');
  expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
  f.audio.setScene(f.scene);
  expect(f.audio.status).toBe('ready');
  f.audio.sync(1500, true, 1);
  expect(f.voices[1]!.options.offset).toBe(0.7);
  expect(f.backend.resume).toHaveBeenCalledOnce();
  expect(f.backend.decode).toHaveBeenCalledOnce();
  f.audio.setScene(definition([]));
  f.backend.running = false;
  f.audio.setScene(f.scene);
  expect(f.audio.status).toBe('locked');
  f.audio.dispose();
});

test.each(['hosted', 'package'] as const)(
  'standalone %s scenes retain audio resolution and own shutdown cleanup',
  async (kind) => {
    const f = fixture();
    const scene = puppetScene();
    scene.events = new EventEmitter() as unknown as Phaser.Events.EventEmitter;
    const loaded =
      kind === 'hosted'
        ? await SceneLoader.fromDefinition(scene, f.scene, {
            baseUrl: 'https://example.test/scene.json',
            loadAudio: () => Promise.resolve(bytes),
            audioBackend: f.backend,
          })
        : await SceneLoader.loadPackage(
            scene,
            await buildScenePackage(f.scene, {
              baseUrl: 'https://example.test/scene.json',
              loadAudio: () => Promise.resolve(bytes),
            }),
            { audioBackend: f.backend },
          );
    expect(loaded.runner.audio!.status).toBe('locked');
    loaded.runner.seek(1500);
    await loaded.runner.audio!.unlock();
    loaded.runner.play();
    expect(f.voices[0]!.options.offset).toBe(0.7);
    scene.events.emit('shutdown');
    loaded.dispose();
    expect(f.voices[0]!.stop).toHaveBeenCalledOnce();
    expect(f.backend.dispose).toHaveBeenCalledOnce();
  },
);

test('Web Audio schedules finite stops, speed, offsets, loop bounds and independent fade ramps', async () => {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const nodes: {
    gain: ReturnType<typeof param>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const source = {
    buffer: null,
    playbackRate: param(),
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    decodeAudioData: vi.fn(() => Promise.resolve({ duration: 2, length: 100, numberOfChannels: 1 })),
    createBufferSource: () => source,
    createGain: () => {
      const node = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
      nodes.push(node);
      return node;
    },
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  const backend = new WebAudioBackend();
  await backend.resume();
  const resource = await backend.decode(bytes);
  const voice = resource.playTimeline!({
    offset: 0.7,
    remaining: 2,
    rate: 2,
    volume: 0.6,
    loop: true,
    loopStart: 0.2,
    loopEnd: 2,
    elapsed: 1,
    duration: 3,
    fadeIn: 2,
    fadeOut: 2,
  });
  expect(source.start).toHaveBeenCalledWith(10, 0.7);
  expect(source.stop).toHaveBeenCalledWith(11);
  expect(source.loopStart).toBe(0.2);
  expect(source.loopEnd).toBe(2);
  expect(source.playbackRate.value).toBe(2);
  expect(nodes[1]!.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 10);
  expect(nodes[1]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.5);
  expect(nodes[2]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 11);
  context.currentTime = 10.25;
  expect(voice.elapsed).toBe(0.5);
  source.onended!();
  voice.stop();
  expect(voice.ended).toBe(true);
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  expect(source.buffer).toBeNull();
  const secondVoice = resource.playTimeline!({
    offset: 0,
    remaining: 1,
    rate: 1,
    volume: 1,
    loop: false,
    loopStart: 0,
    loopEnd: 2,
    elapsed: 0,
    duration: 1,
    fadeIn: 0,
    fadeOut: 0,
  });
  source.stop.mockImplementationOnce(() => {
    throw new Error('Backend stop failed');
  });
  expect(() => secondVoice.stop()).toThrow('Backend stop failed');
  expect(secondVoice.ended).toBe(true);
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  const ended = vi.fn();
  const audition = resource.play(0.5, ended);
  source.stop.mockImplementationOnce(() => {
    throw new Error('Audition stop failed');
  });
  expect(() => audition.stop()).toThrow('Audition stop failed');
  audition.stop();
  expect(ended).toHaveBeenCalledOnce();
  expect(source.onended).toBeNull();
  expect(source.buffer).toBeNull();
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  resource.dispose();
  backend.dispose();
  expect(context.close).toHaveBeenCalledOnce();
});
