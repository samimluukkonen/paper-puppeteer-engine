import { expect, test } from 'vitest';
import { freezeData } from '../src/engine/readonlyData.js';
import { getActiveAudioClipsAtTime, type SceneAudioClip } from '../src/engine/sceneAudio.js';
import { createEmptyScene, type SceneActorDefinition } from '../src/engine/SceneDefinition.js';
import { getDialogueAtTime, getDialogueLineAtTime, type SceneDialogueLine } from '../src/engine/sceneDialogue.js';
import { evaluateTransitionAtTime, type SceneTransition } from '../src/engine/sceneTransitions.js';

const clip: SceneAudioClip = {
  id: 'clip',
  assetId: 'tone',
  trackId: 'effects',
  time: 100,
  duration: 1000,
  sourceOffset: 200,
  volume: 0.6,
  loop: false,
};
const line: SceneDialogueLine = { id: 'line', actorId: 'hero', text: 'Hello', time: 100, duration: 1000 };
const transition: SceneTransition = { id: 'fade', type: 'fade-out', color: '#123456', time: 100, duration: 1000 };
const actor: SceneActorDefinition = { id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } };
const asset = { id: 'tone', name: 'Tone', category: 'sfx' as const, path: 'tone.wav', durationSeconds: 2 };
const base = () => createEmptyScene({ id: 'indexed', duration: 50000 });

function trackedFrozenArray<T>(values: T[]) {
  let reads = 0;
  const array = new Proxy(freezeData(values), {
    get(target, key, receiver): unknown {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return {
    array,
    reads: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

test('audio interval queries match authored order across overlaps, long spans, boundaries and arbitrary seeks', () => {
  const clips = Array.from({ length: 256 }, (_, i) => ({
    ...clip,
    id: `clip-${i}`,
    time: (i * 137) % 4000,
    duration: i % 7 === 0 ? 10000 : 200 + (i % 9) * 100,
    loop: i % 3 === 0,
  })).reverse();
  const scene = freezeData({ ...base(), audioAssets: [asset], audioClips: clips });
  const times = [
    0,
    49999,
    50000,
    -1,
    NaN,
    Infinity,
    ...clips.flatMap((c) => [c.time, c.time + c.duration - 0.01, c.time + c.duration]),
  ];
  for (const time of times) {
    const expected = clips.filter((c) => {
      const elapsed = time - c.time;
      return time >= 0 && time < scene.duration && elapsed >= 0 && elapsed < c.duration && (c.loop || elapsed < 1800);
    });
    expect(getActiveAudioClipsAtTime(scene, time).map(({ clip }) => clip.id)).toEqual(expected.map((c) => c.id));
  }
});

test('warm presentation samples reuse immutable branch indices across scene wrappers without scanning authored arrays', () => {
  const count = 2048;
  const clips = trackedFrozenArray(
    Array.from({ length: count }, (_, i) => ({ ...clip, id: `clip-${i}`, time: i * 20, duration: 10 })),
  );
  const lines = trackedFrozenArray(
    Array.from({ length: count }, (_, i) => ({ ...line, id: `line-${i}`, time: i * 20, duration: 10 })).reverse(),
  );
  const fades = trackedFrozenArray(
    Array.from({ length: count }, (_, i) => ({ ...transition, id: `fade-${i}`, time: i * 20, duration: 10 })).reverse(),
  );
  const actors = trackedFrozenArray(
    Array.from({ length: count }, (_, i) => ({ ...actor, id: i === count - 1 ? 'hero' : `actor-${i}` })),
  );
  const assets = trackedFrozenArray([asset]);
  const scene = {
    ...base(),
    audioClips: clips.array,
    audioAssets: assets.array,
    dialogue: lines.array,
    transitions: fades.array,
    actors: actors.array,
  };
  getActiveAudioClipsAtTime(scene, 5);
  getDialogueAtTime(scene, 5);
  evaluateTransitionAtTime(scene, 5);
  const expectedActor = actors.array[count - 1];
  const collections = [clips, lines, fades, actors, assets];
  for (const collection of collections) collection.reset();
  for (const time of [40005, 5, 20005, 40015, 25]) {
    const wrapper = { ...scene };
    const active = time % 20 < 10;
    expect(getActiveAudioClipsAtTime(wrapper, time)).toHaveLength(active ? 1 : 0);
    const dialogue = getDialogueAtTime(wrapper, time);
    expect(dialogue?.line.id).toBe(active ? `line-${Math.floor(time / 20)}` : undefined);
    if (dialogue) expect(dialogue.actor).toBe(expectedActor);
    expect(evaluateTransitionAtTime(wrapper, time).opacity).toBe(active ? 0.5 : 1);
  }
  for (const collection of collections) expect(collection.reads()).toBe(0);
});

test('replacement immutable branches refresh audio, dialogue, speaker and transition indices', () => {
  const scene = freezeData({
    ...base(),
    audioAssets: [asset],
    audioClips: [clip],
    dialogue: [line],
    actors: [actor],
    transitions: [transition],
  });
  expect(getActiveAudioClipsAtTime(scene, 500)[0]!.volume).toBe(0.6);
  expect(getDialogueAtTime(scene, 500)!.actor).toBe(actor);
  expect(evaluateTransitionAtTime(scene, 500).opacity).toBe(0.4);
  const changed = freezeData({
    ...scene,
    audioAssets: [{ ...asset, durationSeconds: 0.3 }],
    audioClips: [{ ...clip, time: 200, volume: 0.2 }],
    dialogue: [{ ...line, text: 'Edited', time: 200 }],
    actors: [{ ...actor, position: { x: 42, y: 0 } }],
    transitions: [{ ...transition, time: 200, color: '#abcdef' }],
  });
  expect(getActiveAudioClipsAtTime(changed, 150)).toEqual([]);
  expect(getActiveAudioClipsAtTime(changed, 250)[0]).toMatchObject({ remaining: 50, volume: 0.2 });
  expect(getActiveAudioClipsAtTime(changed, 300)).toEqual([]);
  expect(getDialogueAtTime(changed, 150)).toBeUndefined();
  expect(getDialogueAtTime(changed, 500)).toMatchObject({ line: { text: 'Edited' }, actor: { position: { x: 42 } } });
  expect(evaluateTransitionAtTime(changed, 500)).toEqual({ color: '#abcdef', opacity: 0.3 });
  expect(getDialogueAtTime(scene, 500)!.line.text).toBe('Hello');
});

test('mutable children of shallow-frozen collections remain fresh', () => {
  const mutableClip = { ...clip };
  const mutableLine = { ...line };
  const mutableActor = { ...actor };
  const mutableFade = { ...transition };
  const mutableAsset = { ...asset };
  const scene = {
    ...base(),
    audioClips: Object.freeze([mutableClip]),
    audioAssets: Object.freeze([mutableAsset]),
    dialogue: Object.freeze([mutableLine]),
    actors: Object.freeze([mutableActor]),
    transitions: Object.freeze([mutableFade]),
  };
  expect(getActiveAudioClipsAtTime(scene, 500)).toHaveLength(1);
  expect(getDialogueAtTime(scene, 500)!.actor).toBe(mutableActor);
  expect(evaluateTransitionAtTime(scene, 500).opacity).toBe(0.4);
  mutableClip.time = 1000;
  mutableLine.time = 1000;
  mutableFade.time = 1000;
  mutableActor.id = 'other';
  mutableAsset.durationSeconds = 0.25;
  expect(getActiveAudioClipsAtTime(scene, 500)).toEqual([]);
  expect(getActiveAudioClipsAtTime(scene, 1100)).toEqual([]);
  expect(getDialogueLineAtTime(scene, 500)).toBeUndefined();
  expect(getDialogueAtTime(scene, 1100)!.actor).toBeUndefined();
  expect(evaluateTransitionAtTime(scene, 500).opacity).toBe(0);
  expect(evaluateTransitionAtTime(scene, 1100).opacity).toBe(0.1);
});

test('decoded duration changes override cached metadata without stale source windows', () => {
  const scene = freezeData({ ...base(), audioAssets: [asset], audioClips: [{ ...clip, loop: true }] });
  const durations = new Map([['tone', 1000]]);
  expect(getActiveAudioClipsAtTime(scene, 1000, durations)[0]!.sourcePosition).toBe(300);
  durations.set('tone', 500);
  expect(getActiveAudioClipsAtTime(scene, 1000, durations)[0]!.sourcePosition).toBe(200);
  durations.set('tone', 100);
  expect(getActiveAudioClipsAtTime(scene, 1000, durations)).toEqual([]);
  expect(getActiveAudioClipsAtTime(scene, 1000)[0]!.sourcePosition).toBe(1100);
});
