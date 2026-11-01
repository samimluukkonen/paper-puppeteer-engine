import { afterEach, expect, test, vi } from 'vitest';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { Actor } from '../src/engine/Actor.js';
import type { FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { Puppet } from '../src/engine/Puppet.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { getDialogueAtTime, type ActiveSceneDialogue, type SceneDialogueLine } from '../src/engine/sceneDialogue.js';
import { SceneRunner, type SceneCue, type SceneRunnerOptions } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const runners: SceneRunner[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
});
function hold(id: string, time: number, duration = 0): SceneDialogueLine {
  return { id, time, duration, text: id, progression: 'advance-required' };
}
function source(dialogue: SceneDialogueLine[]) {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'holds', duration: 2000 }),
    actors: ['hero', 'friend'].map((id) => ({
      id,
      character: { manifest: 'character.json' },
      position: { x: 0, y: 0 },
    })),
    actions: [
      {
        id: 'root',
        actorId: 'hero',
        type: 'animation',
        time: 0,
        duration: 2000,
        animation: 'walk',
        speed: 1,
        loop: false,
        movementSource: 'rootMotion',
      },
      { id: 'move', actorId: 'friend', type: 'move', time: 0, duration: 2000, destination: { x: 200, y: 0 } },
      ...[0, 500, 750, 1000, 2000].map((time) => ({
        id: `cue-${time}`,
        actorId: 'hero',
        type: 'cue',
        time,
        name: `cue-${time}`,
      })),
      { id: 'turn', actorId: 'hero', type: 'face', time: 750, target: { type: 'direction', facing: 'left' } },
    ],
    cameraTracks: {
      x: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 2000, value: 200 },
      ],
    },
    transitions: [{ id: 'fade', type: 'fade-out', time: 0, duration: 2000, color: '#000000' }],
    dialogue,
  });
}
function factory(events = vi.fn<(event: FiredAnimationEvent) => void>()) {
  return ({ id }: { id: string }) => {
    const puppet = new Puppet(puppetScene(), {
      rig: { root: 'root', bones: [{ id: 'root' }] },
      autoUpdate: false,
      animations: [
        {
          name: 'idle',
          duration: 1000,
          loop: false,
          tracks: {
            root: [
              { time: 0, rotation: 2 },
              { time: 500, rotation: 3 },
              { time: 1000, rotation: 2 },
            ],
          },
          rootMotion: {
            translationKeys: [
              { time: 0, x: 0, y: 0 },
              { time: 1000, x: 500, y: 100 },
            ],
          },
          events: [
            { time: 0, name: 'idle-start' },
            { time: 250, name: 'idle-event' },
          ],
        },
        {
          name: 'blink',
          duration: 500,
          loop: true,
          tracks: {
            root: [
              { time: 0, scaleY: 1 },
              { time: 250, scaleY: 0.5 },
              { time: 500, scaleY: 1 },
            ],
          },
        },
        {
          name: 'walk',
          duration: 2000,
          loop: false,
          tracks: {
            root: [
              { time: 0, rotation: 0 },
              { time: 2000, rotation: 1 },
            ],
          },
          rootMotion: {
            translationKeys: [
              { time: 0, x: 0, y: 0 },
              { time: 2000, x: 200, y: 0 },
            ],
          },
          events: [
            { time: 500, name: 'held' },
            { time: 750, name: 'later' },
          ],
        },
      ],
    });
    puppet.onAnimationEvent(events);
    return new Actor({ id, puppet, puppetOwnership: 'owned' });
  };
}
function fixture(dialogue: SceneDialogueLine[], options: Partial<SceneRunnerOptions> = {}) {
  const events = vi.fn<(event: FiredAnimationEvent) => void>();
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const runner = new SceneRunner(source(dialogue), { createActor: factory(events), onCue, ...options });
  runners.push(runner);
  return { runner, events, onCue };
}

test('large deltas clamp root motion, movement, camera, fade, choreography and cues to the exact hold', () => {
  const { runner, events, onCue } = fixture([hold('question', 500)]);
  runner.play();
  runner.update(10000);
  expect(runner.status).toBe('waiting-for-dialogue-advance');
  expect(runner.time).toBe(500);
  expect(runner.dialogue?.line.id).toBe('question');
  expect(runner.actors.get('hero')!.position.x).toBeCloseTo(50);
  expect(runner.actors.get('friend')!.position.x).toBeCloseTo(50);
  expect(runner.actors.get('hero')!.puppet.getBone('root').pose.rotation).toBeCloseTo(0.25);
  expect(runner.actors.get('hero')!.facingDirection).toBe('right');
  expect(runner.cinematicCamera.x).toBe(50);
  expect(runner.transition.opacity).toBe(0.25);
  expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500]);
  expect(events.mock.calls.map(([event]) => event.name)).toEqual(['held']);
  for (const delta of [0, 100000, 10]) runner.update(delta);
  runner.play(); // Play never bypasses an explicit hold.
  expect(runner.time).toBe(500);
  expect(runner.advanceDialogue()).toEqual({ advanced: true, lineId: 'question' });
  expect(runner.dialogue).toBeUndefined();
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
  runner.update(250);
  expect(runner.time).toBe(750);
  expect(runner.actors.get('hero')!.position.x).toBeCloseTo(75);
  expect(runner.actors.get('friend')!.position.x).toBeCloseTo(75);
  expect(runner.actors.get('hero')!.facingDirection).toBe('left');
  expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500, 750]);
  expect(events.mock.calls.map(([event]) => event.name)).toEqual(['held', 'later']);
});

test.each([0, 1, 499.125, 500, 623.456, 1999.75, 2000])(
  'hold at %s is a clock boundary even without a coincident action',
  (time) => {
    const { runner, onCue } = fixture([hold('boundary', time)]);
    runner.play();
    runner.update(100000);
    expect(runner.time).toBe(time);
    expect(runner.status).toBe('waiting-for-dialogue-advance');
    expect(runner.actors.get('hero')!.position.x).toBeCloseTo(time / 10);
    expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500, 750, 1000, 2000].filter((cue) => cue <= time));
    runner.advanceDialogue();
    runner.update(0);
    expect(runner.status).toBe(time === 2000 ? 'completed' : 'playing');
  },
);

test('zero/end holds and simultaneous exchanges consume one line in stable ID order in either array order', () => {
  for (const reversed of [false, true]) {
    const dialogue = [hold('opening', 0), hold('a-question', 500, 100), hold('b-reply', 500, 200), hold('end', 2000)];
    const { runner, onCue } = fixture(reversed ? dialogue.reverse() : dialogue);
    expect(runner.advanceDialogue()).toEqual({ advanced: false });
    runner.play();
    expect(runner.time).toBe(0);
    expect(runner.dialogue?.line.id).toBe('opening');
    runner.update(99999);
    expect(runner.time).toBe(0);
    runner.advanceDialogue();
    runner.update(99999);
    expect(runner.time).toBe(500);
    expect(runner.dialogue?.line.id).toBe('a-question');
    expect(runner.advanceDialogue()).toEqual({ advanced: true, lineId: 'a-question' });
    expect(runner.status).toBe('waiting-for-dialogue-advance');
    expect(runner.time).toBe(500);
    expect(runner.dialogue?.line.id).toBe('b-reply');
    runner.update(99999);
    expect(runner.time).toBe(500);
    runner.advanceDialogue();
    expect(runner.status).toBe('playing');
    expect(runner.dialogue).toBeUndefined(); // A consumed hold does not persist for its preview duration.
    runner.update(99999);
    expect(runner.status).toBe('waiting-for-dialogue-advance');
    expect(runner.time).toBe(2000);
    expect(runner.dialogue?.line.id).toBe('end');
    expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500, 750, 1000, 2000]);
    runner.advanceDialogue();
    expect(runner.status).toBe('completed');
    expect(runner.dialogue).toBeUndefined();
    expect(runner.advanceDialogue()).toEqual({ advanced: false });
  }
});

test('pause cannot consume a pending hold; play restores waiting, stop/restart create a fresh pass', () => {
  const { runner, onCue } = fixture([hold('opening', 0), hold('later', 1000)]);
  runner.play();
  runner.pause();
  expect(runner.status).toBe('paused');
  expect(runner.dialogue?.line.id).toBe('opening');
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
  runner.play();
  expect(runner.status).toBe('waiting-for-dialogue-advance');
  runner.advanceDialogue();
  runner.update(900);
  runner.pause();
  runner.update(99999);
  runner.play();
  runner.update(100);
  expect(runner.dialogue?.line.id).toBe('later');
  runner.stop();
  expect(runner.status).toBe('stopped');
  expect(runner.time).toBe(0);
  expect(runner.dialogue).toBeUndefined();
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
  runner.play();
  expect(runner.dialogue?.line.id).toBe('opening');
  runner.restart();
  expect(runner.dialogue?.line.id).toBe('opening');
  expect(onCue.mock.calls.filter(([cue]) => cue.time === 0)).toHaveLength(3);
  runner.cancel();
  expect(runner.dialogue).toBeUndefined();
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
});

test('seek is a pure silent preview, consumes holds at/before its position and rearms later holds on backward seek', () => {
  const data = source([hold('a', 500, 100), hold('b', 500, 200), hold('later', 1000), hold('end', 2000)]);
  const { runner, onCue } = fixture([...data.dialogue!]);
  runner.play();
  runner.update(500);
  runner.pause();
  runner.seek(500); // Same-position seek must leave the input session too.
  expect(runner.status).toBe('paused');
  expect(runner.dialogue).toEqual(getDialogueAtTime(data, 500));
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
  runner.play();
  expect(runner.dialogue).toBeUndefined();
  runner.update(500);
  expect(runner.dialogue?.line.id).toBe('later');
  const count = onCue.mock.calls.length;
  for (const time of [2000, 500, 699, 0, 1000, 750, 500]) {
    runner.seek(time);
    expect(runner.status).toBe(time === 2000 ? 'completed' : 'paused');
    expect(runner.dialogue).toEqual(getDialogueAtTime(data, time));
  }
  expect(onCue).toHaveBeenCalledTimes(count);
  runner.play();
  runner.update(500);
  expect(runner.dialogue?.line.id).toBe('later');
  runner.seek(0);
  runner.play();
  runner.update(500);
  expect(runner.dialogue?.line.id).toBe('a');
});

test('reentrant advance from presentation cannot consume the next simultaneous line or repeat cues', () => {
  const attempts: unknown[] = [];
  const setDialogue = vi.fn<(active: ActiveSceneDialogue | undefined) => void>((active) => {
    if (active?.line.id === 'b') attempts.push(runner.advanceDialogue());
  });
  const { runner } = fixture([hold('a', 500), hold('b', 500)], { dialoguePresentation: { setDialogue } });
  runner.play();
  runner.update(500);
  expect(runner.advanceDialogue()).toEqual({ advanced: true, lineId: 'a' });
  expect(attempts).toEqual([{ advanced: false }]);
  expect(runner.dialogue?.line.id).toBe('b');
  expect(runner.advanceDialogue()).toEqual({ advanced: true, lineId: 'b' });
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
});

test('timed compatibility, stable passive samples, point holds, invalid overlap and missing speaker validation', () => {
  const timed: SceneDialogueLine = { id: 'timed', time: 0, duration: 500, text: 'Timed' };
  const data = source([timed, hold('z', 500, 200), hold('a', 500, 100), hold('end', 2000)]);
  expect(parseSceneJson(serializeSceneDefinition(data))).toEqual(data);
  expect(data.dialogue![0]).not.toHaveProperty('progression');
  for (const dialogue of [data.dialogue!, [...data.dialogue!].reverse()]) {
    expect(getDialogueAtTime({ dialogue }, 500)?.line.id).toBe('a');
    expect(getDialogueAtTime({ dialogue }, 650)?.line.id).toBe('z');
    expect(getDialogueAtTime({ dialogue }, 700)).toBeUndefined();
    expect(getDialogueAtTime({ dialogue }, 2000)?.line.id).toBe('end');
  }
  for (const lines of [
    [{ ...timed, duration: 0 }],
    [timed, hold('overlap', 250)],
    [hold('a', 500, 200), hold('b', 600, 200)],
    [hold('a', 500), { ...timed, time: 500 }],
    [{ ...hold('bad-speaker', 0), actorId: 'missing' }],
    [hold('past-end', 2001)],
    [hold('bad-end', 2000, 1)],
  ])
    expect(() => source(lines)).toThrow();
  const { runner } = fixture([timed, { ...timed, id: 'explicit', time: 500, progression: 'timed' }]);
  runner.play();
  runner.update(500);
  expect(runner.status).toBe('playing');
  expect(runner.dialogue?.line.id).toBe('explicit');
  expect(runner.advanceDialogue()).toEqual({ advanced: false });
  runner.update(99999);
  expect(runner.status).toBe('completed');
});

test('editor shows each interactive line, scrubs without waits and clears the session on scene switch', () => {
  const data = source([hold('a', 500), hold('b', 500)]);
  const playback = new SceneEditorPlayback();
  playback.sync(data, true, factory());
  playback.play();
  playback.update(99999);
  expect(playback.time).toBe(500);
  expect(playback.dialogue?.line.id).toBe('a');
  playback.advanceDialogue();
  expect(playback.dialogue?.line.id).toBe('b');
  playback.seek(500);
  expect(playback.status).toBe('paused');
  expect(playback.dialogue?.line.id).toBe('a');
  playback.play();
  playback.update(1);
  expect(playback.time).toBe(501);
  playback.restart();
  playback.update(500);
  expect(playback.dialogue?.line.id).toBe('a');
  playback.sync(createEmptyScene({ id: 'other' }), true, factory());
  expect(playback.dialogue).toBeUndefined();
  expect(playback.status).toBe('stopped');
  playback.advanceDialogue();
  playback.dispose();
});

function idleSource() {
  const data = source([hold('a', 500), hold('b', 500), hold('later', 1000), hold('end', 2000)]);
  data.actors[0]!.dialogueIdle = { animation: 'idle', policy: 'overlay-snap' };
  data.actors[1]!.dialogueIdle = { animation: 'blink', policy: 'overlay-snap' };
  return data;
}

test('hold-local overlays loop independently for multiple Actors while all cinematic clocks and ownership freeze', () => {
  const data = idleSource();
  const before = serializeSceneDefinition(data);
  const events = vi.fn<(event: FiredAnimationEvent) => void>();
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const runner = new SceneRunner(data, { createActor: factory(events), onCue });
  runners.push(runner);
  runner.play();
  runner.update(9000); // Excess delta is discarded on entry.
  const hero = runner.actors.get('hero')!;
  const friend = runner.actors.get('friend')!;
  const mainId = hero.puppet.getPlaybackStatus()!.playbackId;
  expect(runner.dialogueHoldPlayback).toEqual({ sceneTime: 500, holdElapsedTime: 0 });
  expect(hero.puppet.getBone('root').pose.rotation).toBe(2);
  expect(hero.puppet.animationPlayer.elapsedTime).toBe(500);
  runner.update(250);
  expect(hero.puppet.getBone('root').pose.rotation).toBeCloseTo(2.5);
  expect(friend.puppet.getBone('root').pose.scaleY).toBeCloseTo(0.5);
  runner.update(1000);
  expect(hero.puppet.getBone('root').pose.rotation).toBeCloseTo(2.5);
  expect(runner.time).toBe(500);
  expect(hero.position).toEqual({ x: 50, y: 0 });
  expect(friend.position).toEqual({ x: 50, y: 0 });
  expect(hero.puppet.animationPlayer.elapsedTime).toBe(500);
  expect(hero.puppet.getPlaybackStatus()!.playbackId).toBe(mainId);
  expect(runner.cinematicCamera.x).toBe(50);
  expect(runner.transition.opacity).toBe(0.25);
  expect(events.mock.calls.map(([event]) => event.name)).toEqual(['held']);
  expect(onCue.mock.calls.map(([cue]) => cue.time)).toEqual([0, 500]);
  runner.advanceDialogue(); // Same-time successor gets a fresh local session.
  expect(runner.dialogueHoldPlayback?.holdElapsedTime).toBe(0);
  runner.update(400);
  runner.advanceDialogue();
  expect(runner.dialogueHoldPlayback).toBeUndefined();
  expect(hero.puppet.getBone('root').pose.rotation).toBeCloseTo(0.25);
  expect(friend.puppet.getBone('root').pose.scaleY).toBe(1);
  runner.update(250);
  expect(hero.position.x).toBeCloseTo(75);
  expect(friend.position.x).toBeCloseTo(75);
  expect(hero.puppet.getBone('root').pose.rotation).toBeCloseTo(0.375);
  expect(serializeSceneDefinition(data)).toBe(before);
  expect(serializeSceneDefinition(runner.definition)).toBe(before);
});

test('pause retains local phase; every seek removes overlays before sampling the exact cinematic pose', () => {
  const runner = new SceneRunner(idleSource(), { createActor: factory() });
  runners.push(runner);
  runner.play();
  runner.update(500);
  runner.update(250);
  const hero = runner.actors.get('hero')!;
  runner.pause();
  runner.update(9000);
  expect(runner.dialogueHoldPlayback?.holdElapsedTime).toBe(250);
  expect(hero.puppet.getBone('root').pose.rotation).toBeCloseTo(2.5);
  runner.play();
  runner.update(250);
  expect(hero.puppet.getBone('root').pose.rotation).toBe(3);
  for (const time of [500, 750, 0, 500, 2000]) {
    runner.seek(time);
    expect(runner.dialogueHoldPlayback).toBeUndefined();
    expect(runner.actors.get('hero')!.puppet.getBone('root').pose.rotation).toBeCloseTo(time / 2000);
    runner.update(5000);
    expect(runner.dialogueHoldPlayback).toBeUndefined();
  }
});

test('rapid holds, restart, stop, ending holds, interruption and disposal release presentation state', () => {
  const runner = new SceneRunner(idleSource(), { createActor: factory() });
  runners.push(runner);
  for (let i = 0; i < 20; i++) {
    runner.restart();
    runner.update(500);
    runner.update(1100);
    runner.advanceDialogue();
    runner.advanceDialogue();
    expect(runner.dialogueHoldPlayback).toBeUndefined();
    expect(runner.actors.get('hero')!.puppet.getBone('root').pose.rotation).toBeCloseTo(0.25);
  }
  runner.update(500);
  runner.update(100);
  runner.advanceDialogue();
  runner.update(1000);
  runner.update(300);
  expect(runner.time).toBe(2000);
  runner.advanceDialogue();
  expect(runner.status).toBe('completed');
  expect(runner.dialogueHoldPlayback).toBeUndefined();
  expect(runner.actors.get('hero')!.puppet.getBone('root').pose.rotation).toBe(1);
  runner.restart();
  runner.update(500);
  runner.stop();
  expect(runner.dialogueHoldPlayback).toBeUndefined();
  runner.play();
  runner.update(500);
  runner.actors.get('hero')!.stop();
  expect(runner.status).toBe('interrupted');
  expect(runner.dialogueHoldPlayback).toBeUndefined();
  runner.restart();
  runner.update(500);
  const actors = [...runner.actors.values()];
  runner.dispose();
  expect(runner.dialogueHoldPlayback).toBeUndefined();
  expect(actors.every((actor) => actor.isDisposed)).toBe(true);
});

test('idle overlays preserve a frozen interrupted crossfade and sparse manual channels', () => {
  const puppet = factory()({ id: 'fade' }).puppet;
  try {
    puppet.play('walk');
    puppet.update(200);
    puppet.play('idle', { fadeDuration: 1000 });
    puppet.update(300);
    puppet.play('walk', { fadeDuration: 800 });
    puppet.update(200);
    puppet.animationPlayer.pause();
    puppet.getBone('root').pose.x = 17;
    puppet.syncPose();
    const before = { ...puppet.getBone('root').pose };
    const transition = puppet.animationPlayer.transition;
    const time = puppet.animationPlayer.elapsedTime;
    puppet.beginDialogueIdle('blink');
    puppet.sampleDialogueIdle(1250);
    expect(puppet.getBone('root').pose.scaleY).toBeCloseTo(0.5);
    expect(puppet.getBone('root').pose.x).toBe(17);
    expect(puppet.animationPlayer.transition).toEqual(transition);
    expect(puppet.animationPlayer.elapsedTime).toBe(time);
    puppet.endDialogueIdle();
    expect(puppet.getBone('root').pose).toEqual(before);
    expect(puppet.animationPlayer.transition).toEqual(transition);
  } finally {
    puppet.destroy();
  }
});

test('editor preview advances only the local idle clock and scene switching clears it', () => {
  const playback = new SceneEditorPlayback();
  playback.sync(idleSource(), true, factory());
  playback.play();
  playback.update(500);
  playback.update(250);
  expect(playback.time).toBe(500);
  expect(playback.dialogueHoldPlayback?.holdElapsedTime).toBe(250);
  expect(playback.actors!.get('hero')!.puppet.getBone('root').pose.rotation).toBeCloseTo(2.5);
  playback.advanceDialogue();
  playback.advanceDialogue();
  expect(playback.dialogueHoldPlayback).toBeUndefined();
  playback.restart();
  playback.update(500);
  playback.sync(createEmptyScene({ id: 'other' }), true, factory());
  expect(playback.dialogueHoldPlayback).toBeUndefined();
  playback.dispose();
});
