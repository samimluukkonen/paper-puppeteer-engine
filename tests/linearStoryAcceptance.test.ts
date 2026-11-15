import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { buildScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner, type SceneCue } from '../src/engine/SceneRunner.js';
import { buildStoryPackage, validateStoryPackage } from '../src/engine/StoryPackage.js';
import { StoryPlayer } from '../src/engine/StoryPlayer.js';
import { linearStoryFixture } from './helpers/linearStoryFixture.js';
import { puppetScene } from './helpers/puppetScene.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
const wav = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));

async function fixture() {
  const f = linearStoryFixture(12, { width: 1, height: 1 });
  const png = artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>;
  f.assets.documents['images/paper.png'] = png;
  const files = await buildStoryPackage(f.story, {
    scenes: f.scenes,
    buildScene: (scene) =>
      buildScenePackage(scene, {
        ...f.assets,
        loadImage: () => Promise.resolve(png),
        loadAudio: () => Promise.resolve(wav),
      }),
  });
  const archive = await validateStoryPackage(decodePackageZip(encodePackageZip(files)));
  const definition = await CharacterLoader.load(
    'https://example.test/scenes/characters/hero/character.json',
    f.assets.fetcher,
  );
  const cues = vi.fn<(cue: SceneCue) => void>();
  const events = vi.fn();
  const playAudio = vi.fn();
  let voices = 0;
  const runners: SceneRunner[] = [];
  const createRunner = (input: unknown) => {
    const runner = new SceneRunner(input, {
      onCue: cues,
      createActor: ({ id }) => {
        const puppet = new Puppet(puppetScene(), { definition, autoUpdate: false });
        puppet.onAnimationEvent(events);
        return new Actor({ id, puppet, puppetOwnership: 'owned' });
      },
      audio: {
        resolve: () => ({ definition: [...f.scenes.values()][0]!.audioAssets![0]!, bytes: wav }),
        backend: {
          running: true,
          resume: () => Promise.resolve(),
          dispose() {},
          decode: () =>
            Promise.resolve({
              durationSeconds: 2,
              byteLength: 64000,
              play() {
                throw new Error('No audition');
              },
              dispose() {},
              playTimeline: (options) => {
                playAudio(options);
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
              },
            }),
        },
      },
    });
    runners.push(runner);
    return runner;
  };
  return { ...f, archive, createRunner, runners, cues, events, playAudio, voices: () => voices };
}

function cinematic(runner: SceneRunner) {
  return {
    time: runner.time,
    camera: runner.cinematicCamera,
    transition: runner.transition,
    actors: [...runner.actors].map(([id, actor]) => ({
      id,
      position: actor.position,
      facing: actor.facingDirection,
      time: actor.puppet.posePipeline.player.elapsedTime,
      pose: actor.puppet.rig.bones.map(({ id }) => ({ ...actor.puppet.getBone(id).pose })),
      deformation: [...actor.puppet.posePipeline.player.meshDeformation].map(([id, vertices]) => [id, [...vertices]]),
    })),
  };
}

test('three-scene packaged film freezes every cinematic owner, advances exchanges and completes cleanly', async () => {
  const f = await fixture();
  const before = JSON.stringify([f.story, [...f.scenes], f.rig, f.animations]);
  const player = new StoryPlayer(f.archive.definition, {
    scenes: f.archive.scenes,
    transitionOverlay: { setTransition() {} },
    loadScene: (scene) => {
      const runner = f.createRunner(scene);
      return Promise.resolve({ runner, dispose: () => runner.dispose() });
    },
  });
  try {
    await player.start();
    expect(player.currentSession!.runner.status).toBe('playing');
    expect(f.runners[0]!.dialogue?.line.id).toBe('narration');
    await player.update(10000);
    const forest = f.runners[0]!;
    await forest.audio!.unlock();
    forest.syncAudio();
    expect(forest.time).toBe(500);
    expect(forest.actors.get('hero')!.position.x).toBeCloseTo(0);
    expect(forest.status).toBe('waiting-for-dialogue-advance');
    const heldPosition = forest.actors.get('hero')!.position;
    const camera = forest.cinematicCamera;
    const pose = forest.actors.get('hero')!.puppet.getBone('root').pose.scaleY;
    const cues = f.cues.mock.calls.length;
    const events = f.events.mock.calls.length;
    for (let i = 0; i < 120; i++) await player.update(1000);
    await player.update(250);
    expect(forest.time).toBe(500);
    expect(forest.cinematicCamera).toEqual(camera);
    expect(forest.actors.get('hero')!.position).toEqual(heldPosition);
    expect(forest.actors.get('hero')!.puppet.posePipeline.player.elapsedTime).toBe(500);
    expect(forest.actors.get('hero')!.puppet.getBone('root').pose.scaleY).not.toBe(pose);
    expect(f.cues).toHaveBeenCalledTimes(cues);
    expect(f.events).toHaveBeenCalledTimes(events);
    expect(f.voices()).toBe(1); // Dedicated hold ambience only.
    player.advanceDialogue();
    expect(forest.actors.get('hero')!.puppet.getBone('root').pose.scaleY).toBeCloseTo(1);
    await player.update(1);
    expect(forest.time).toBe(501); // No accumulated waiting delta.
    await player.update(499);
    await player.update(50);
    await player.update(50);
    const encounter = f.runners[1]!;
    expect(encounter.dialogue?.line.id).toBe('01-question');
    expect(encounter.actors.get('hero')!.facingDirection).toBe('right');
    expect(encounter.actors.get('friend')!.facingDirection).toBe('left');
    expect(player.advanceDialogue()).toEqual({ advanced: true, lineId: '01-question' });
    expect(encounter.dialogue?.line.id).toBe('02-reply');
    await player.update(100000);
    expect(encounter.time).toBe(0);
    player.advanceDialogue();
    expect(player.advanceDialogue()).toEqual({ advanced: false });
    await player.update(1000);
    await player.update(50);
    await player.update(50);
    const sword = f.runners[2]!;
    await sword.audio!.unlock();
    await player.update(250);
    expect(f.voices()).toBe(2); // Ambience plus synchronized sword effect.
    await player.update(250);
    expect(sword.dialogue?.line.id).toBe('response');
    expect(sword.actors.get('hero')!.position.x).toBeCloseTo(0);
    expect(sword.cinematicCamera.zoom).toBeCloseTo(1.25);
    await player.update(60000);
    expect(sword.time).toBe(500);
    player.advanceDialogue();
    await player.update(375);
    expect(sword.transition.opacity).toBeCloseTo(0.5);
    await player.update(125);
    expect(player.status).toBe('completed');
    expect(f.voices()).toBe(0);
    expect(f.runners.every((runner) => runner.status === 'disposed')).toBe(true);
    expect(f.cues.mock.calls.map(([cue]) => cue.name)).toEqual(['after-hold', 'after-hold', 'after-hold']);
    await player.start();
    await player.update(500);
    expect(f.runners[3]!.dialogue?.line.id).toBe('response');
    expect(JSON.stringify([f.story, [...f.scenes], f.rig, f.animations])).toBe(before);
  } finally {
    player.dispose();
  }
  expect(f.voices()).toBe(0);
});

test('scrubbing packaged root motion, IK and mesh corrections depends only on authored time', async () => {
  const f = await fixture();
  const scene = f.archive.scenes.get('sword')!;
  const before = JSON.stringify(scene);
  const runner = f.createRunner(scene);
  const baseline = f.createRunner(scene);
  try {
    runner.play();
    runner.update(500);
    runner.update(12345); // Begin with a live idle and consumed viewer history.
    runner.advanceDialogue();
    const cues = f.cues.mock.calls.length;
    const events = f.events.mock.calls.length;
    const sounds = f.playAudio.mock.calls.length;
    for (const time of [875, 0, 500, 250, 1000, 500, 501, 499, 0, 500]) {
      baseline.stop();
      baseline.seek(time);
      runner.seek(time);
      expect(cinematic(runner)).toEqual(cinematic(baseline));
      expect(runner.dialogue).toEqual(baseline.dialogue);
      expect(runner.dialogueHoldPlayback).toBeUndefined();
      expect(runner.advanceDialogue()).toEqual({ advanced: false });
    }
    expect(f.cues).toHaveBeenCalledTimes(cues);
    expect(f.events).toHaveBeenCalledTimes(events);
    expect(f.playAudio).toHaveBeenCalledTimes(sounds);
    expect(JSON.stringify(scene)).toBe(before);
  } finally {
    runner.dispose();
    baseline.dispose();
  }
});
