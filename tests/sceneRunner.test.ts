import { readFile } from 'node:fs/promises';
import { afterEach, assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { Actor } from '../src/engine/Actor.js';
import type { AnimationCompletion, FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { Puppet } from '../src/engine/Puppet.js';
import { parseSceneDefinition, parseSceneJson, type SceneActionDefinition } from '../src/engine/SceneDefinition.js';
import { DEFAULT_SCENE_LAYERS, sceneActorDepth } from '../src/engine/sceneLayers.js';
import { SceneRunner, type SceneCue } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { requestUrl } from './helpers/requestUrl.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
const runners: SceneRunner[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.unstubAllGlobals();
});
const cue = (time: number, name = `cue-${time}`): SceneActionDefinition => ({
  id: name,
  actorId: 'a',
  type: 'cue',
  time,
  name,
  payload: { time },
});
const move = (actorId: string, time = 100, duration = 1000, x = 100): SceneActionDefinition => ({
  id: `${actorId}-move-${time}`,
  type: 'move',
  actorId,
  time,
  duration,
  destination: { x, y: 0 },
});
const clip = (
  time = 100,
  duration = 1000,
  loop = false,
  speed = 1,
): Extract<SceneActionDefinition, { type: 'animation' }> => ({
  id: `clip-${time}`,
  type: 'animation',
  actorId: 'a',
  time,
  duration,
  animation: 'gesture',
  loop,
  speed,
});
function scene(actions: readonly SceneActionDefinition[] = []) {
  return parseSceneDefinition({
    version: 2,
    id: 'encounter',
    name: 'Encounter',
    duration: 3000,
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: 'character.json' },
      position: { x: index * 200, y: 0 },
      animation: 'rest',
    })),
    actions,
  });
}
function factory() {
  const created: Actor[] = [];
  const events = vi.fn<(event: FiredAnimationEvent) => void>();
  const completions = vi.fn<(event: AnimationCompletion) => void>();
  const createActor = (data: { readonly id: string }) => {
    const puppet = new Puppet(puppetScene(), {
      autoUpdate: false,
      rig: { root: 'root', bones: [{ id: 'root' }] },
      animations: ['rest', 'gesture'].map((name) => ({
        version: 1,
        name,
        duration: 500,
        loop: name === 'rest',
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, x: 50 },
          ],
        },
        events: [
          { time: 0, name: 'start' },
          { time: 250, name: 'middle' },
          { time: 500, name: 'tail' },
        ],
      })),
    });
    // Deliberately observe authored events/completions even in isolated reconstruction.
    puppet.onAnimationEvent(events);
    puppet.onAnimationComplete(completions);
    const actor = new Actor({ id: data.id, puppet, puppetOwnership: 'owned' });
    created.push(actor);
    return actor;
  };
  return { createActor, created, events, completions };
}
function fixture(actions: readonly SceneActionDefinition[] = []) {
  const assets = factory();
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const data = scene(actions);
  const runner = new SceneRunner(data, { createActor: assets.createActor, onCue });
  runners.push(runner);
  return { ...assets, data, runner, onCue };
}
function snapshot(runner: SceneRunner) {
  return [...runner.actors].map(([id, actor]) => ({
    id,
    position: actor.position,
    facing: actor.facingDirection,
    animation: actor.currentAnimation,
    pose: actor.puppet.getBone('root').pose.x,
  }));
}

function seekFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    frames,
    run() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
  };
}

test('pointer seeks pause immediately, coalesce to the latest frame sample and flush on release or play', () => {
  const clock = seekFrames();
  const assets = factory();
  const playback = new SceneEditorPlayback();
  try {
    playback.sync(scene([move('a', 0)]), true, assets.createActor);
    playback.play();
    playback.update(100);
    const actor = playback.actors!.get('a');
    const notify = vi.fn();
    playback.subscribe(notify);
    for (const time of [200, 300, 400]) playback.queueSeek(time);
    assert.equal(playback.status, 'paused');
    assert.equal(playback.time, 100);
    assert.equal(clock.frames.size, 1);
    notify.mockClear();
    clock.run();
    assert.equal(playback.time, 400);
    assert.equal(notify.mock.calls.length, 1);
    assert.strictEqual(playback.actors!.get('a'), actor);
    playback.queueSeek(500);
    playback.queueSeek(600);
    playback.flushSeek();
    assert.equal(playback.time, 600);
    assert.equal(clock.frames.size, 0);
    clock.run();
    assert.equal(playback.time, 600);
    playback.queueSeek(700);
    playback.play();
    assert.equal(playback.time, 700);
    assert.equal(playback.status, 'playing');
    assert.equal(clock.frames.size, 0);
  } finally {
    playback.dispose();
  }
});

test.each(['cancelSeek', 'pause', 'seek', 'stop', 'restart', 'sync', 'unbind', 'dispose'] as const)(
  '%s cancels pending pointer samples before they can change the transport or scene',
  (operation) => {
    const clock = seekFrames();
    const assets = factory();
    const playback = new SceneEditorPlayback();
    const data = scene([move('a', 0)]);
    try {
      playback.sync(data, true, assets.createActor);
      playback.seek(100);
      playback.queueSeek(900);
      if (operation === 'seek') playback.seek(200);
      else if (operation === 'sync') playback.sync({ ...data, id: 'other' }, true, assets.createActor);
      else if (operation === 'unbind') playback.sync(data, false, assets.createActor);
      else playback[operation]();
      const time = playback.time;
      const status = playback.status;
      assert.equal(clock.frames.size, 0);
      clock.run();
      assert.equal(playback.time, time);
      assert.equal(playback.status, status);
    } finally {
      playback.dispose();
    }
  },
);

test.each(['camera', 'transition', 'pause'] as const)(
  'failed construction releases every owned Actor after an initial %s callback failure',
  (phase) => {
    const assets = factory();
    const failure = new Error(`Initial ${phase} failed.`);
    const overlay = { setTransition: vi.fn() };
    const fail = (): never => {
      throw failure;
    };
    let thrown: unknown;
    try {
      new SceneRunner(scene(), {
        createActor: (data, depth) => {
          const actor = assets.createActor(data);
          actor.puppet.container.setDepth(depth);
          if (phase === 'pause') vi.spyOn(actor, 'pauseAnimation').mockImplementation(fail);
          return actor;
        },
        transitionOverlay: overlay,
        ...(phase === 'camera' ? { onCamera: fail } : {}),
        ...(phase === 'transition' ? { onTransition: fail } : {}),
      });
    } catch (error) {
      thrown = error;
    }
    if (phase === 'transition') {
      assert.instanceOf(thrown, AggregateError);
      assert.strictEqual(thrown.cause, failure);
    } else assert.strictEqual(thrown, failure);
    assert.equal(assets.created.length, 2);
    assert.isTrue(assets.created.every((actor) => actor.isDisposed && actor.puppet.isDestroyed));
    assert.isAtLeast(overlay.setTransition.mock.calls.length, 1);
  },
);

test('constructor cleanup releases remaining Actors even when one disposal fails', () => {
  const assets = factory();
  const failure = new Error('Camera failed.');
  const cleanupFailure = new Error('Actor cleanup failed.');
  let thrown: unknown;
  try {
    new SceneRunner(scene(), {
      createActor: (data) => {
        const actor = assets.createActor(data);
        if (assets.created.length === 1) {
          const dispose = actor.dispose.bind(actor);
          vi.spyOn(actor, 'dispose').mockImplementation(() => {
            dispose();
            throw cleanupFailure;
          });
        }
        return actor;
      },
      onCamera: () => {
        throw failure;
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert.instanceOf(thrown, AggregateError);
  assert.strictEqual(thrown.cause, cleanupFailure);
  assert.strictEqual(thrown.errors[0], failure);
  assert.isTrue(assets.created.every((actor) => actor.isDisposed && actor.puppet.isDestroyed));
});

test('layer edits preserve playing Actor identity, movement, clock and whole-Puppet depth through restart', () => {
  const assets = factory();
  const playback = new SceneEditorPlayback();
  const source = scene([move('a', 0, 1000)]);
  playback.sync(source, true, assets.createActor);
  playback.play();
  playback.update(250);
  const actor = playback.actors!.get('a')!;
  const position = actor.position;
  const layers = [{ id: 'foreground', name: 'Trees', visible: true, parallax: 1.2 }, ...DEFAULT_SCENE_LAYERS];
  playback.sync({ ...source, layers }, true, assets.createActor);
  assert.strictEqual(playback.actors!.get('a'), actor);
  assert.equal(playback.time, 250);
  assert.deepEqual(actor.position, position);
  assert.equal(actor.puppet.container.depth, sceneActorDepth({ layers }, 0));
  const hidden = layers.map((layer) => ({ ...layer, visible: layer.id !== 'actors' }));
  playback.sync({ ...source, layers: hidden }, true, assets.createActor);
  assert.isFalse(actor.puppet.container.visible);
  playback.update(250);
  assert.equal(actor.position.x, 50);
  playback.sync({ ...source, layers }, true, assets.createActor);
  assert.isTrue(actor.puppet.container.visible);
  playback.restart();
  assert.equal(playback.actors!.get('a')!.puppet.container.depth, sceneActorDepth({ layers }, 0));
  assert.deepEqual(source.actors[0]!.position, { x: 0, y: 0 });
  playback.dispose();
});

test('runtime Actor factory receives layer depth and visibility survives scene reconstruction', () => {
  const assets = factory();
  const source = {
    ...scene(),
    layers: [...DEFAULT_SCENE_LAYERS].reverse().map((layer) => ({ ...layer, visible: false })),
  };
  const depths: number[] = [];
  const runner = new SceneRunner(source, {
    createActor: (data, depth) => {
      depths.push(depth);
      const actor = assets.createActor(data);
      actor.puppet.container.setDepth(depth);
      return actor;
    },
  });
  runners.push(runner);
  assert.deepEqual(
    depths,
    source.actors.map((_, index) => sceneActorDepth(source, index)),
  );
  assert.isFalse(runner.actors.get('a')!.puppet.container.visible);
  runner.seek(500);
  assert.isFalse(runner.actors.get('a')!.puppet.container.visible);
  assert.equal(runner.actors.get('b')!.puppet.container.depth, sceneActorDepth(source, 1));
});

test('start, pause, resume, speed, restart and stop use one scene clock', () => {
  const { runner } = fixture([move('a')]);
  assert.equal(runner.status, 'stopped');
  runner.update(500);
  assert.equal(runner.time, 0);
  runner.play();
  runner.update(350);
  assert.equal(runner.actors.get('a')!.position.x, 25);
  runner.pause();
  runner.update(500);
  assert.equal(runner.time, 350);
  assert.equal(runner.actors.get('a')!.puppet.posePipeline.player.isPaused, true);
  runner.speed = 2;
  runner.play();
  runner.update(125);
  assert.equal(runner.time, 600);
  assert.equal(runner.actors.get('a')!.position.x, 50);
  const old = runner.actors.get('a')!;
  runner.restart();
  assert.isTrue(old.isDisposed);
  assert.equal(runner.time, 0);
  assert.equal(runner.status, 'playing');
  runner.update(300);
  runner.stop();
  assert.equal(runner.status, 'stopped');
  assert.equal(runner.time, 0);
  assert.equal(runner.actors.get('a')!.position.x, 0);
  runner.play();
  runner.update(50);
  assert.equal(runner.time, 100);
});

test('unsorted sequential declarations split large deltas at exact boundaries and preserve cue tie order', () => {
  const { runner, onCue } = fixture([
    cue(1100, 'first'),
    move('a', 1100, 1000, 300),
    cue(1100, 'second'),
    move('a'),
    cue(0),
  ]);
  runner.play();
  assert.equal(onCue.mock.calls[0]![0].time, 0);
  runner.update(1600);
  assert.closeTo(runner.actors.get('a')!.position.x, 200, 1e-10);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => [event.name, event.time]),
    [
      ['cue-0', 0],
      ['first', 1100],
      ['second', 1100],
    ],
  );
  runner.update(2000);
  assert.equal(runner.actors.get('a')!.position.x, 300);
  assert.equal(runner.time, 3000);
  assert.equal(runner.status, 'completed');
});

test('parallel Actors use the same delta even when durations differ; waits own no channel', () => {
  const { runner } = fixture([
    move('a'),
    move('b', 100, 2000, 0),
    { id: 'hold', actorId: 'a', type: 'wait', time: 0, duration: 2500 },
  ]);
  runner.play();
  runner.update(600);
  assert.equal(runner.actors.get('a')!.position.x, 50);
  assert.equal(runner.actors.get('b')!.position.x, 150);
  runner.update(500);
  assert.equal(runner.actors.get('a')!.position.x, 100);
  assert.equal(runner.actors.get('b')!.position.x, 100);
  runner.update(1000);
  assert.equal(runner.actors.get('b')!.position.x, 0);
});

test('animation speed, finite completion, looping boundaries, adjacent clips and held window endpoints reuse runtime poses', () => {
  const { runner, completions } = fixture([clip(0, 1000, true, 2), clip(1000, 1000)]);
  runner.play();
  runner.update(125);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 25);
  runner.update(125);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 0);
  runner.update(750);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 0);
  runner.update(500);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 50);
  assert.isTrue(completions.mock.calls.some(([event]) => event.clip === 'gesture'));
  runner.update(1000);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 50);
});

test('facing uses runtime direction, point, Actor targeting and tie rules at scheduled time', () => {
  const { runner } = fixture([
    move('a'),
    { id: 'left', actorId: 'a', type: 'face', time: 0, target: { type: 'direction', facing: 'left' } },
    { id: 'other', actorId: 'a', type: 'face', time: 600, target: { type: 'actor', actorId: 'b' } },
    { id: 'point', actorId: 'a', type: 'face', time: 1100, target: { type: 'point', x: -100, y: 0 } },
    { id: 'tie', actorId: 'a', type: 'face', time: 1200, target: { type: 'point', x: 100, y: 10 } },
  ]);
  runner.play();
  assert.equal(runner.actors.get('a')!.facingDirection, 'left');
  runner.update(600);
  assert.equal(runner.actors.get('a')!.facingDirection, 'right');
  runner.update(600);
  assert.equal(runner.actors.get('a')!.facingDirection, 'left');
});

test('forward/backward seeking samples deterministically from any previous state with no cues or animation gameplay callbacks', () => {
  const { runner, onCue, events, completions } = fixture([
    move('a'),
    clip(100, 2000, true),
    cue(0),
    cue(500),
    cue(3000),
  ]);
  runner.seek(600);
  const expected = snapshot(runner);
  assert.equal(runner.status, 'paused');
  assert.equal(runner.actors.get('a')!.position.x, 50);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
  assert.equal(onCue.mock.calls.length, 0);
  for (const previous of [0, 2000, 3000, 600, 200, 900]) {
    runner.seek(previous);
    runner.seek(600);
    assert.deepEqual(snapshot(runner), expected);
  }
  runner.play();
  runner.update(500);
  assert.equal(events.mock.calls.length > 0, true);
  events.mockClear();
  completions.mockClear();
  runner.seek(1500);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
  assert.equal(onCue.mock.calls.length, 0);
  runner.seek(3000);
  assert.equal(runner.status, 'completed');
  runner.restart();
  assert.equal(onCue.mock.calls.length, 1);
});

test('same-position and nearby forward seeks retain Actors and only step newly crossed boundaries', () => {
  const { runner, created, onCue, events, completions } = fixture([
    move('a'),
    clip(100, 2000, true),
    ...Array.from({ length: 250 }, (_, index) => cue(index * 10)),
  ]);
  runner.seek(600);
  const actor = runner.actors.get('a')!;
  const playbackId = actor.puppet.getPlaybackStatus()!.playbackId;
  const movementId = actor.movementStatus!.requestId;
  const updates = vi.spyOn(actor.puppet, 'update');
  const count = created.length;
  for (let repeat = 0; repeat < 10; repeat++) runner.seek(600);
  assert.equal(updates.mock.calls.length, 0);
  runner.seek(601);
  runner.seek(625);
  assert.deepEqual(updates.mock.calls, [[1], [9], [10], [5]]);
  assert.equal(created.length, count);
  assert.strictEqual(runner.actors.get('a'), actor);
  assert.equal(actor.puppet.getPlaybackStatus()!.playbackId, playbackId);
  assert.equal(actor.movementStatus!.requestId, movementId);
  assert.closeTo(actor.position.x, 52.5, 1e-9);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
  assert.equal(onCue.mock.calls.length, 0);
  runner.play();
  runner.update(5);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => event.time),
    [630],
  );
});

test('seeking the playing position pauses without replaying actions and terminal repeats hold completion', () => {
  const { runner, created, onCue } = fixture([move('a', 0), clip(0, 2000, true), cue(0), cue(500)]);
  runner.play();
  runner.update(500);
  const actor = runner.actors.get('a')!;
  const count = created.length;
  const held = snapshot(runner);
  const updates = vi.spyOn(actor.puppet, 'update');
  runner.seek(500);
  assert.equal(runner.status, 'paused');
  assert.deepEqual(snapshot(runner), held);
  assert.equal(updates.mock.calls.length, 0);
  assert.equal(created.length, count);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => event.time),
    [0, 500],
  );
  runner.seek(3000);
  runner.seek(9999);
  assert.equal(runner.status, 'completed');
  assert.equal(created.length, count);
  runner.seek(0);
  assert.isTrue(actor.isDisposed);
  const initial = runner.actors.get('a')!;
  runner.seek(-1);
  assert.strictEqual(runner.actors.get('a'), initial);
});

test('forward seeks recover from invalidated movement ownership and ignore obsolete outcomes', async () => {
  const { runner } = fixture([move('a', 0, 2000), clip(0, 2000, true)]);
  runner.seek(100);
  const previous = runner.actors.get('a')!;
  previous.cancelMovement();
  runner.seek(200);
  await Promise.resolve();
  await Promise.resolve();
  assert.isTrue(previous.isDisposed);
  assert.equal(runner.status, 'paused');
  assert.closeTo(runner.actors.get('a')!.position.x, 10, 1e-9);
});

test.each(['cue', 'animation'] as const)('reentrant %s seeks reconstruct a complete Actor sample', (source) => {
  const { runner, onCue } = fixture([move('a', 0), move('b', 0), clip(0, 2000, true), cue(250)]);
  runner.play();
  const previous = runner.actors.get('a')!;
  if (source === 'cue') onCue.mockImplementation(() => runner.seek(250));
  else previous.puppet.onAnimationEvent(() => runner.seek(250));
  runner.update(250);
  assert.equal(runner.status, 'paused');
  assert.isTrue(previous.isDisposed);
  assert.equal(runner.actors.get('a')!.position.x, 25);
  assert.equal(runner.actors.get('b')!.position.x, 175);
});

test('natural clip completion during seek holds pose and still settles lifecycle waits', async () => {
  const { runner, events, completions } = fixture([clip(0, 2000)]);
  runner.seek(800);
  const actor = runner.actors.get('a')!;
  assert.equal(actor.puppet.getBone('root').pose.x, 50);
  assert.equal(actor.puppet.getPlaybackStatus()?.status, 'completed');
  assert.equal((await actor.waitForPlayback()).status, 'completed');
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
});

test('scene end dispatches terminal markers exactly once, settles waits and freezes all Actors', async () => {
  const { runner, onCue } = fixture([cue(3000), clip(2900, 100)]);
  runner.play();
  runner.update(2900);
  const pending = runner.actors.get('a')!.waitForPlayback();
  runner.update(9999);
  assert.equal(runner.status, 'completed');
  assert.equal((await pending).status, 'stopped');
  const held = snapshot(runner);
  runner.update(1000);
  assert.deepEqual(snapshot(runner), held);
  assert.equal(onCue.mock.calls.length, 1);
});

test('delta partitioning and seeking match playback including gaps, loop boundaries and concurrent movement', () => {
  const actions = [move('a'), move('b', 0, 2000, -200), clip(0, 2000, true)];
  const first = fixture(actions).runner;
  const second = fixture(actions).runner;
  first.play();
  first.update(1750);
  second.play();
  for (const delta of [17, 83, 250, 349, 401, 500, 150]) second.update(delta);
  const expected = snapshot(first);
  snapshot(second).forEach((entry, index) => {
    assert.closeTo(entry.position.x, expected[index]!.position.x, 1e-9);
    assert.closeTo(entry.pose, expected[index]!.pose, 1e-9);
  });
  second.seek(1750);
  assert.deepEqual(snapshot(second), expected);
});

test('authored scenes, character animations, saved state and Undo history remain unchanged', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(scene([move('a'), clip()])));
  const original = document.workingScene!;
  const json = document.exportJson();
  const { createActor } = factory();
  const controller = new SceneEditorPlayback();
  controller.sync(original, true, createActor);
  controller.play();
  controller.update(600);
  controller.pause();
  controller.seek(1500);
  controller.seek(200);
  controller.restart();
  controller.stop();
  assert.strictEqual(document.workingScene, original);
  assert.equal(document.exportJson(), json);
  assert.isFalse(document.dirty);
  assert.isFalse(document.canUndo);
  controller.dispose();
});

test.each(['cancel', 'dispose', 'character-dispose', 'animation-interrupt', 'movement-interrupt'] as const)(
  '%s clears obsolete scheduling and releases owned waits',
  async (mode) => {
    const { runner, onCue, created } = fixture([move('a', 0, 2000), clip(0, 2000), cue(1000)]);
    runner.play();
    runner.update(100);
    const actor = runner.actors.get('a')!;
    const wait = actor.waitForPlayback();
    if (mode === 'cancel') runner.cancel();
    if (mode === 'dispose') runner.dispose();
    if (mode === 'character-dispose') actor.puppet.destroy();
    if (mode === 'animation-interrupt') actor.play('rest');
    if (mode === 'movement-interrupt') {
      actor.cancelMovement();
      await Promise.resolve();
      await Promise.resolve();
    }
    const result = await wait;
    assert.include(['cancelled', 'interrupted', 'disposed', 'stopped'], result.status);
    assert.include(['cancelled', 'interrupted', 'disposed'], runner.status);
    if (runner.status !== 'disposed') runner.update(2000);
    assert.equal(onCue.mock.calls.length, 0);
    runner.dispose();
    assert.isTrue(created.every((instance) => instance.isDisposed && instance.puppet.isDestroyed));
  },
);

test('restart during playback ignores old movement outcomes and cues can stop/restart reentrantly', async () => {
  const { runner, onCue } = fixture([move('a', 0, 2000), cue(1000)]);
  runner.play();
  runner.update(200);
  runner.restart();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runner.status, 'playing');
  onCue.mockImplementation(() => runner.stop());
  runner.update(2000);
  assert.equal(runner.time, 0);
  assert.equal(runner.status, 'stopped');
  assert.equal(onCue.mock.calls.length, 1);
});

test('unsupported scripts, conflicts, missing assets and invalid clock input report explicitly', () => {
  const { runner } = fixture();
  assert.throws(() => new SceneRunner({ ...scene(), actions: [{ type: 'script' }] }, factory()), /Invalid scene/);
  assert.throws(() => new SceneRunner(scene([move('a'), move('a', 200)]), factory()), /Conflicting/);
  const assets = factory();
  assert.throws(() => new SceneRunner(scene([{ ...clip(), animation: 'missing' }]), assets), /unknown animation/);
  assert.isTrue(assets.created.every((actor) => actor.isDisposed));
  assert.throws(() => runner.update(-1), /negative/);
  assert.throws(() => runner.seek(NaN), /finite/);
  assert.throws(() => {
    runner.speed = 0;
  }, /positive/);
  runner.seek(-1);
  assert.equal(runner.time, 0);
  runner.seek(9999);
  assert.equal(runner.time, 3000);
});

test('movement interruption is synchronous before later actions, even without a microtask checkpoint', () => {
  const { runner, onCue } = fixture([move('a', 0, 2000), cue(1000)]);
  runner.play();
  runner.update(100);
  runner.actors.get('a')!.cancelMovement();
  runner.update(2000);
  assert.equal(runner.status, 'interrupted');
  assert.equal(onCue.mock.calls.length, 0);
});

test.each([8, 32])(
  'ownership checking stays linear for %s concurrent Actors, including natural completions',
  (count) => {
    const data = scene();
    data.actors = Array.from({ length: count }, (_, index) => ({ ...data.actors[0]!, id: `actor-${index}` }));
    data.actions = data.actors.flatMap(({ id }) => [
      move(id, 0, 500),
      { ...clip(0, 2000), id: `${id}-clip`, actorId: id },
    ]);
    const runner = new SceneRunner(data, factory());
    runners.push(runner);
    runner.play();
    const playbackReads = [...runner.actors.values()].map((actor) => vi.spyOn(actor.puppet, 'getPlaybackStatus'));
    const movementReads = [...runner.actors.values()].map((actor) => vi.spyOn(actor, 'movementStatus', 'get'));
    for (const delta of [250, 250, 250]) {
      for (const spy of [...playbackReads, ...movementReads]) spy.mockClear();
      runner.update(delta);
      assert.equal(runner.status, 'playing');
      assert.isAtMost(
        playbackReads.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
        count,
      );
      assert.isAtMost(
        movementReads.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
        count,
      );
    }
    for (const actor of runner.actors.values()) {
      assert.equal(actor.movementStatus?.status, 'completed');
      assert.equal(actor.puppet.getPlaybackStatus()?.status, 'completed');
    }
  },
);

test.each(
  (['a', 'b'] as const).flatMap((target) =>
    (['cancel-move', 'replace-move', 'pause', 'stop', 'stop-queue', 'clear', 'replace', 'restart'] as const).map(
      (operation) => ({ target, operation }),
    ),
  ),
)('$operation from another Actor detects ownership loss immediately (target $target)', ({ target, operation }) => {
  const { runner, onCue } = fixture([
    move('a', 0, 2000),
    move('b', 0, 2000),
    clip(0, 2000, true),
    { ...clip(0, 2000, true), id: 'b-clip', actorId: 'b' },
    cue(1000),
  ]);
  runner.play();
  runner.update(1); // Prime the revision before an external callback changes another Actor.
  const actor = runner.actors.get(target)!;
  const source = runner.actors.get(target === 'a' ? 'b' : 'a')!;
  const targetUpdate = vi.spyOn(actor.puppet, 'update');
  const player = actor.puppet.posePipeline.player;
  source.puppet.onUpdate(() => {
    switch (operation) {
      case 'cancel-move':
        actor.cancelMovement();
        break;
      case 'replace-move':
        void actor.moveTo(500, 0);
        break;
      case 'pause':
        player.pause();
        break;
      case 'stop':
        player.stop();
        break;
      case 'stop-queue':
        player.stopQueue();
        break;
      case 'clear':
        player.clearAllLayers();
        break;
      case 'replace':
        actor.play('rest');
        break;
      case 'restart':
        player.restart();
        break;
    }
  });
  runner.update(1500);
  assert.equal(runner.status, 'interrupted');
  assert.equal(onCue.mock.calls.length, 0);
  assert.equal(targetUpdate.mock.calls.length, target === 'b' ? 0 : 1);
  if (operation === 'replace-move') assert.equal(actor.movementStatus?.status, 'moving');
  if (operation === 'replace' || operation === 'restart') assert.isTrue(actor.isPlaying);
});

test.each(['stop', 'stopQueue', 'clearAllLayers', 'restart'] as const)(
  '%s of a held completed clip from another Actor interrupts before later cues',
  (operation) => {
    const { runner, onCue } = fixture([clip(0, 2000), cue(1000)]);
    runner.play();
    runner.update(600);
    const player = runner.actors.get('a')!.puppet.posePipeline.player;
    assert.equal(player.getPlaybackStatus()?.status, 'completed');
    runner.actors.get('b')!.puppet.onUpdate(() => player[operation]());
    runner.update(1500);
    assert.equal(runner.status, 'interrupted');
    assert.equal(onCue.mock.calls.length, 0);
  },
);

test('pausing inside a cue keeps simultaneous commands and all Actor clocks synchronized', () => {
  const { runner, onCue } = fixture([cue(500), clip(500, 1000), move('a', 500), move('b', 500)]);
  onCue.mockImplementation(() => runner.pause());
  runner.play();
  runner.update(900);
  assert.equal(runner.time, 500);
  assert.equal(runner.status, 'paused');
  runner.play();
  runner.update(250);
  assert.equal(runner.actors.get('a')!.position.x, 25);
  assert.equal(runner.actors.get('b')!.position.x, 175);
  assert.equal(runner.actors.get('a')!.puppet.posePipeline.player.elapsedTime, 250);
  assert.equal(onCue.mock.calls.length, 1);
});

test('pausing from an animation event finishes the shared delta for every Actor', () => {
  const { runner } = fixture([clip(0, 1000), move('a', 0), move('b', 0)]);
  runner.play();
  runner.actors.get('a')!.puppet.onAnimationEvent(() => runner.pause());
  runner.update(250);
  assert.equal(runner.status, 'paused');
  assert.equal(runner.actors.get('a')!.puppet.posePipeline.player.elapsedTime, 250);
  assert.equal(runner.actors.get('b')!.puppet.posePipeline.player.elapsedTime, 250);
  assert.equal(runner.actors.get('a')!.position.x, 25);
  assert.equal(runner.actors.get('b')!.position.x, 175);
});

test('controller selection keeps playback live while authored edits and asset unbinding reset it', () => {
  const controller = new SceneEditorPlayback();
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(scene([move('a')])));
  const assets = factory();
  controller.sync(document.workingScene, true, assets.createActor);
  controller.play();
  controller.update(600);
  document.selectActor('b');
  controller.sync(document.workingScene, true, assets.createActor);
  assert.equal(controller.time, 600);
  assert.equal(controller.status, 'playing');
  document.updateActor('a', { position: { x: 40, y: 0 } });
  controller.sync(document.workingScene, true, assets.createActor);
  assert.equal(controller.status, 'stopped');
  assert.equal(controller.time, 0);
  controller.sync(document.workingScene, false, assets.createActor);
  assert.isFalse(controller.ready);
  assert.isTrue(assets.created.every((actor) => actor.isDisposed));
  controller.dispose();
});

test('shipped encounter loads real assets and reproduces before/during/after movement, bow and response without clip mutations', async () => {
  const authored = parseSceneJson(
    await readFile(new URL('../public/scenes/encounter.scene.json', import.meta.url), 'utf8'),
  );
  const definition = await CharacterLoader.load(
    new URL('../public/scenes/encounter/character.json', import.meta.url).href,
    async (input) => new Response(await readFile(new URL(requestUrl(input)))),
  );
  const before = JSON.stringify(definition.animations);
  const onCue = vi.fn<(cue: SceneCue) => void>();
  const runner = new SceneRunner(authored, {
    createActor: (data, depth) =>
      new Actor({
        id: data.id,
        puppetOwnership: 'owned',
        puppet: new Puppet(puppetScene(), { definition, autoUpdate: false, depth }),
      }),
    onCue,
  });
  runners.push(runner);
  for (const [time, ax, bx] of [
    [250, -280, 280],
    [1500, -195, 195],
    [2500, -110, 110],
    [1500, -195, 195],
  ]) {
    runner.seek(time!);
    assert.closeTo(runner.actors.get('a')!.position.x, ax!, 1e-9);
    assert.closeTo(runner.actors.get('b')!.position.x, bx!, 1e-9);
  }
  runner.seek(3400);
  assert.equal(runner.actors.get('a')!.currentAnimation, 'bow');
  assert.closeTo(runner.actors.get('a')!.puppet.getBone('torso').pose.rotation, 0.55, 1e-9);
  assert.equal(runner.actors.get('a')!.facingDirection, 'right');
  assert.equal(runner.actors.get('b')!.facingDirection, 'left');
  runner.seek(5000);
  assert.equal(runner.actors.get('b')!.currentAnimation, 'respond');
  runner.restart();
  runner.update(6500);
  assert.equal(runner.status, 'completed');
  assert.equal(onCue.mock.calls.length, 1);
  assert.equal(JSON.stringify(definition.animations), before);
});

test('silent loop reconstruction avoids gameplay event catch-up work and preserves runtime waits', async () => {
  const { runner, events, completions } = fixture();
  const puppet = runner.actors.get('a')!.puppet;
  puppet.resumeAnimation();
  puppet.update(5_000_000);
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
  const pending = puppet.playAndWait('gesture');
  puppet.update(500);
  assert.equal((await pending).status, 'completed');
  assert.equal(events.mock.calls.length, 0);
  assert.equal(completions.mock.calls.length, 0);
});

test('interrupting a held completed clip stops the scene while preserving the newer playback owner', () => {
  const { runner, onCue } = fixture([clip(0, 2000), cue(1000)]);
  runner.play();
  runner.update(600);
  const actor = runner.actors.get('a')!;
  assert.equal(actor.puppet.getPlaybackStatus()?.status, 'completed');
  actor.play('rest');
  const playback = actor.puppet.getPlaybackStatus()!.playbackId;
  runner.update(1000);
  assert.equal(runner.status, 'interrupted');
  assert.equal(actor.puppet.getPlaybackStatus()!.playbackId, playback);
  assert.isTrue(actor.isPlaying);
  assert.equal(onCue.mock.calls.length, 0);
});

test('newer external movement retains ownership when its predecessor interrupts scene scheduling', async () => {
  const { runner, onCue } = fixture([move('a', 0, 2000), cue(1000)]);
  runner.play();
  runner.update(100);
  const actor = runner.actors.get('a')!;
  const pending = actor.moveTo(200, 0, { speed: 100 });
  const requestId = actor.movementStatus!.requestId;
  runner.update(2000);
  assert.equal(runner.status, 'interrupted');
  assert.equal(actor.movementStatus!.requestId, requestId);
  assert.equal(actor.movementStatus!.status, 'moving');
  assert.equal(onCue.mock.calls.length, 0);
  actor.puppet.update(1000);
  assert.closeTo(actor.position.x, 105, 1e-9);
  runner.dispose();
  assert.equal((await pending).status, 'disposed');
});

test('a cue-triggered restart prevents commands from the obsolete generation', () => {
  const { runner, onCue } = fixture([cue(500), move('a', 500, 1000)]);
  onCue.mockImplementationOnce(() => runner.restart());
  runner.play();
  runner.update(900);
  assert.equal(runner.status, 'playing');
  assert.equal(runner.time, 0);
  assert.equal(runner.actors.get('a')!.position.x, 0);
  runner.update(750);
  assert.equal(runner.time, 750);
  assert.equal(runner.actors.get('a')!.position.x, 25);
});

test('same-clip replacement from a time-zero animation event retains its newer playback identity', () => {
  const assets = factory();
  const runner = new SceneRunner(scene([clip(0, 2000, true)]), {
    createActor(data) {
      const actor = assets.createActor(data);
      let replaced = false;
      actor.puppet.onAnimationEvent((event) => {
        if (event.clip === 'gesture' && !replaced) {
          replaced = true;
          actor.play('gesture');
        }
      });
      return actor;
    },
  });
  runners.push(runner);
  runner.play();
  assert.equal(runner.status, 'interrupted');
  assert.equal(runner.actors.get('a')!.currentAnimation, 'gesture');
  assert.isTrue(runner.actors.get('a')!.isPlaying);
});

test('five concurrent Actors retain deterministic windows through rapid seeks and repeated restart/stop cycles', async () => {
  const assets = factory();
  const data = scene();
  data.actors = Array.from({ length: 5 }, (_, index) => ({ ...data.actors[0]!, id: `actor-${index}` }));
  data.actions = data.actors.flatMap(({ id }, index) => [
    move(id, 0, 1000, 100 + index * 10),
    move(id, 1000, 1000, 200 + index * 10),
    { ...clip(0, 2000, true), id: `${id}-clip`, actorId: id },
  ]);
  const runner = new SceneRunner(data, assets);
  runners.push(runner);
  runner.seek(1500);
  const expected = snapshot(runner);
  for (let iteration = 0; iteration < 12; iteration++) {
    runner.seek(iteration % 2 ? 2900 : 0);
    runner.seek(1500);
    assert.deepEqual(snapshot(runner), expected);
    assert.equal(assets.created.filter((actor) => !actor.isDisposed).length, 5);
    runner.restart();
    runner.update(1500);
    assert.deepEqual(snapshot(runner), expected);
    runner.pause();
    runner.update(10000);
    assert.deepEqual(snapshot(runner), expected);
    runner.stop();
    await Promise.resolve();
    assert.equal(runner.status, 'stopped');
  }
  runner.dispose();
  assert.isTrue(assets.created.every((actor) => actor.isDisposed && actor.puppet.isDestroyed));
  assert.equal(assets.events.mock.calls.filter(([event]) => event.name === 'middle').length, 5 * 3 * 12);
});

test('adjacent scene clips use hard cuts and held poses at the exact boundary', () => {
  const { runner } = fixture([clip(0, 500), { ...clip(500, 1000), animation: 'rest' }]);
  runner.play();
  runner.update(499);
  assert.isUndefined(runner.actors.get('a')!.puppet.posePipeline.player.transition);
  runner.update(1);
  const actor = runner.actors.get('a')!;
  assert.equal(actor.currentAnimation, 'rest');
  assert.equal(actor.puppet.getBone('root').pose.x, 0);
  assert.isUndefined(actor.puppet.posePipeline.player.transition);
  runner.seek(500);
  assert.equal(runner.actors.get('a')!.puppet.getBone('root').pose.x, 0);
});

test('playback disposal clears bindings and releases all Actors when one cleanup observer fails', () => {
  const document = new SceneEditorDocument();
  document.importJson(JSON.stringify(scene()));
  const assets = factory();
  const playback = new SceneEditorPlayback();
  playback.sync(document.workingScene, true, assets.createActor);
  const actor = assets.created[0]!;
  const dispose = actor.dispose.bind(actor);
  vi.spyOn(actor, 'dispose').mockImplementation(() => {
    dispose();
    throw new Error('cleanup observer failed');
  });
  const notified = vi.fn();
  playback.subscribe(notified);
  assert.throws(() => playback.dispose(), /cleanup observer failed/);
  assert.isFalse(playback.ready);
  assert.isUndefined(playback.actors);
  assert.equal(notified.mock.calls.length, 1);
  assert.isTrue(assets.created.every((instance) => instance.isDisposed && instance.puppet.isDestroyed));
  const count = assets.created.length;
  playback.retry();
  assert.equal(assets.created.length, count);
  assert.doesNotThrow(() => playback.dispose());
});

test('zero-delta updates and seeking exactly onto a cue do not replay consumed markers on resume', () => {
  const { runner, onCue } = fixture([cue(0), cue(500), cue(1000)]);
  runner.play();
  for (let iteration = 0; iteration < 3; iteration++) runner.update(0);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => event.time),
    [0],
  );
  runner.seek(500);
  runner.play();
  runner.update(0);
  runner.update(500);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => event.time),
    [0, 1000],
  );
  runner.seek(0);
  runner.play();
  runner.update(500);
  assert.deepEqual(
    onCue.mock.calls.map(([event]) => event.time),
    [0, 1000, 500],
  );
});
