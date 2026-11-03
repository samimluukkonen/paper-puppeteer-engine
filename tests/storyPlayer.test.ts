import { expect, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import { Puppet } from '../src/engine/Puppet.js';
import type { DeepReadonly } from '../src/engine/readonlyData.js';
import { createEmptyScene, type SceneDefinition } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { StoryPlayer, type StorySceneContext, type StorySceneSession } from '../src/engine/StoryPlayer.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(ids = ['a', 'b', 'a']) {
  const scenes = new Map([...new Set(ids)].map((id) => [id, createEmptyScene({ id, duration: 100 })]));
  const story = {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: ids.map((sceneAssetId, index) => ({ id: `entry-${index}`, sceneAssetId })),
  };
  const loaded: { context: StorySceneContext; runner: SceneRunner; dispose: ReturnType<typeof vi.fn> }[] = [];
  const order: string[] = [];
  const loadScene = (definition: DeepReadonly<SceneDefinition>, context: StorySceneContext) => {
    order.push(`load:${context.index}`);
    const runner = new SceneRunner(definition, {
      createActor: ({ id }) =>
        new Actor({
          id,
          puppetOwnership: 'owned',
          puppet: new Puppet(puppetScene(), {
            autoUpdate: false,
            rig: { root: 'root', bones: [{ id: 'root' }] },
            animations: [],
          }),
        }),
    });
    const dispose = vi.fn(() => {
      order.push(`dispose:${context.index}`);
      runner.dispose();
    });
    loaded.push({ context, runner, dispose });
    return Promise.resolve({ runner, dispose });
  };
  return { scenes, story, loaded, order, loadScene };
}

test.each([['a'], ['a', 'b', 'c'], ['a', 'b', 'a']])('plays ordered scenes through completion: %j', async (...ids) => {
  const f = fixture(ids);
  const player = new StoryPlayer(f.story, f);
  await player.start();
  for (const [index, id] of ids.entries()) {
    expect(player.status).toBe('playing');
    expect(player.index).toBe(index);
    expect(player.currentEntry?.sceneAssetId).toBe(id);
    expect(f.loaded[index]!.runner.time).toBe(0);
    await player.update(1000); // Excess time never skips an authored entry.
  }
  expect(player.status).toBe('completed');
  expect(player.currentEntry).toBeUndefined();
  expect(player.currentSession).toBeUndefined();
  expect(f.order).toEqual(ids.flatMap((_, index) => [`load:${index}`, `dispose:${index}`]));
  expect(new Set(f.loaded.map(({ context }) => context.instanceId)).size).toBe(ids.length);
  expect(new Set(f.loaded.map(({ runner }) => runner)).size).toBe(ids.length);
  await player.update(50);
  expect(f.loaded).toHaveLength(ids.length);
  player.dispose();
});

test('stop releases the current session, prevents advancing and restarts with fresh identity', async () => {
  const f = fixture();
  const player = new StoryPlayer(f.story, f);
  await player.start();
  await player.update(40);
  expect(f.loaded[0]!.runner.time).toBe(40);
  player.stop();
  expect(player.index).toBe(-1);
  expect(player.status).toBe('stopped');
  await player.update(1000);
  expect(f.loaded).toHaveLength(1);
  expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
  await player.start();
  expect(f.loaded[1]!.context.instanceId).not.toBe(f.loaded[0]!.context.instanceId);
  expect(player.index).toBe(0);
  player.dispose();
  player.dispose();
  expect(f.loaded[1]!.dispose).toHaveBeenCalledTimes(1);
  await expect(player.start()).rejects.toThrow(/disposed/);
  await expect(player.update(1)).rejects.toThrow(/disposed/);
});

test.each(['stop', 'dispose'] as const)(
  '%s during loading aborts and releases a late session without playing it',
  async (command) => {
    const f = fixture();
    let resolve!: (session: StorySceneSession) => void;
    let signal!: AbortSignal;
    const player = new StoryPlayer(f.story, {
      scenes: f.scenes,
      loadScene: (_, context) => {
        signal = context.signal;
        return new Promise((ready) => {
          resolve = ready;
        });
      },
    });
    const starting = player.start();
    expect(player.status).toBe('loading');
    await player.update(1000);
    player[command]();
    expect(signal.aborted).toBe(true);
    const session = {
      runner: { status: 'stopped' as const, error: undefined, play: vi.fn(), update: vi.fn() },
      dispose: vi.fn(),
    };
    resolve(session);
    await starting;
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.runner.play).not.toHaveBeenCalled();
    expect(player.status).toBe(command === 'stop' ? 'stopped' : 'disposed');
    player.dispose();
  },
);

test('a superseded load cannot replace a restarted story session', async () => {
  const f = fixture();
  let resolve!: (session: StorySceneSession) => void;
  let first = true;
  const player = new StoryPlayer(f.story, {
    scenes: f.scenes,
    loadScene: (definition, context) => {
      if (first) {
        first = false;
        return new Promise((ready) => {
          resolve = ready;
        });
      }
      return f.loadScene(definition, context);
    },
  });
  const old = player.start();
  player.stop();
  await player.start();
  const session = {
    runner: { status: 'stopped' as const, error: undefined, play: vi.fn(), update: vi.fn() },
    dispose: vi.fn(),
  };
  resolve(session);
  await old;
  expect(player.currentSession?.runner).toBe(f.loaded[0]!.runner);
  expect(session.dispose).toHaveBeenCalledTimes(1);
  player.dispose();
});

test('loader failure on a later scene stops playback and retains an observable error', async () => {
  const f = fixture();
  const error = new Error('missing artwork');
  const player = new StoryPlayer(f.story, {
    scenes: f.scenes,
    loadScene: (definition, context) =>
      context.index === 1 ? Promise.reject(error) : f.loadScene(definition, context),
  });
  await player.start();
  await expect(player.update(100)).rejects.toBe(error);
  expect(player.status).toBe('failed');
  expect(player.error).toBe(error);
  expect(player.currentSession).toBeUndefined();
  expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
  player.dispose();
});

test('interrupted scene and throwing runtime fail without advancing', async () => {
  for (const throws of [false, true]) {
    const f = fixture();
    const player = new StoryPlayer(f.story, f);
    await player.start();
    if (throws)
      vi.spyOn(f.loaded[0]!.runner, 'update').mockImplementation(() => {
        throw new Error('runtime');
      });
    else f.loaded[0]!.runner.cancel();
    await expect(player.update(100)).rejects.toThrow(throws ? /runtime/ : /cancelled/);
    expect(player.status).toBe('failed');
    expect(f.loaded).toHaveLength(1);
    expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
    player.dispose();
  }
});

test('empty draft cannot start and missing references fail before allocating runtime objects', async () => {
  const f = fixture([]);
  const loadScene = vi.fn(f.loadScene);
  const player = new StoryPlayer(f.story, { ...f, loadScene });
  await expect(player.start()).rejects.toThrow(/Empty story/);
  expect(player.status).toBe('stopped');
  expect(loadScene).not.toHaveBeenCalled();
  expect(() => new StoryPlayer(fixture().story, { scenes: new Map(), loadScene })).toThrow(/Missing scene/);
  player.dispose();
});

test.each(['stop', 'dispose'] as const)(
  'reentrant %s during session cleanup prevents loading another entry',
  async (command) => {
    const f = fixture();
    const player = new StoryPlayer(f.story, f);
    await player.start();
    f.loaded[0]!.dispose.mockImplementation(() => {
      f.loaded[0]!.runner.dispose();
      player[command]();
    });
    await player.update(100);
    expect(player.status).toBe(command === 'stop' ? 'stopped' : 'disposed');
    expect(player.index).toBe(-1);
    expect(f.loaded).toHaveLength(1);
    expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
    player.dispose();
  },
);

test('a failed start releases its session and invalid deltas do not alter playback', async () => {
  const f = fixture();
  const error = new Error('cannot play');
  const player = new StoryPlayer(f.story, {
    ...f,
    loadScene: async (definition, context) => {
      const session = await f.loadScene(definition, context);
      vi.spyOn(session.runner, 'play').mockImplementation(() => {
        throw error;
      });
      return session;
    },
  });
  await expect(player.start()).rejects.toBe(error);
  expect(player.status).toBe('failed');
  expect(player.error).toBe(error);
  expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
  player.dispose();

  const active = new StoryPlayer(f.story, f);
  await active.start();
  await active.start();
  for (const delta of [-1, NaN, Infinity]) await expect(active.update(delta)).rejects.toThrow();
  expect(active.status).toBe('playing');
  expect(active.index).toBe(0);
  active.dispose();
});

test('repeated source scenes and shared assets stay immutable with independent Actor clocks and fades', async () => {
  const f = fixture(['a', 'a']);
  const source = f.scenes.get('a')!;
  source.actors.push({ id: 'hero', character: { manifest: 'shared/character.json' }, position: { x: 5, y: 0 } });
  source.actions.push({
    id: 'move',
    actorId: 'hero',
    type: 'move',
    time: 0,
    duration: 100,
    destination: { x: 105, y: 0 },
  });
  source.transitions = [{ id: 'fade', time: 0, duration: 100, type: 'fade-out', color: '#000000' }];
  const snapshot = structuredClone(source);
  const player = new StoryPlayer(f.story, f);
  source.actors[0]!.position.x = 999; // Mutations after construction do not change the playback snapshot.
  await player.start();
  const first = f.loaded[0]!.runner.actors.get('hero')!;
  await player.update(50);
  expect(first.position.x).toBe(55);
  expect(f.loaded[0]!.runner.transition.opacity).toBe(0.5);
  await player.update(50);
  const second = f.loaded[1]!.runner.actors.get('hero')!;
  expect(second).not.toBe(first);
  expect(first.isDisposed).toBe(true);
  expect(second.position.x).toBe(5);
  await player.update(100);
  expect(player.status).toBe('completed');
  expect(source).toEqual({ ...snapshot, actors: [{ ...snapshot.actors[0], position: { x: 999, y: 0 } }] });
  player.dispose();
});

test('dialogue holds keep the story session alive through its final boundary until explicitly advanced', async () => {
  const f = fixture(['a', 'b']);
  f.scenes.get('a')!.dialogue = [
    { id: 'opening', time: 0, duration: 0, text: 'Who?', progression: 'advance-required' },
    { id: 'end-a', time: 100, duration: 0, text: 'Answer.', progression: 'advance-required' },
    { id: 'end-b', time: 100, duration: 0, text: 'Continue.', progression: 'advance-required' },
  ];
  const player = new StoryPlayer(f.story, f);
  expect(player.advanceDialogue()).toEqual({ advanced: false });
  await player.start();
  await player.update(99999);
  expect(player.status).toBe('playing');
  expect(player.index).toBe(0);
  expect(f.loaded).toHaveLength(1);
  expect(f.loaded[0]!.runner.time).toBe(0);
  player.advanceDialogue();
  await player.update(99999);
  expect(f.loaded[0]!.runner.time).toBe(100);
  expect(f.loaded[0]!.runner.status).toBe('waiting-for-dialogue-advance');
  expect(player.index).toBe(0);
  expect(player.advanceDialogue()).toEqual({ advanced: true, lineId: 'end-a' });
  await player.update(1000);
  expect(player.index).toBe(0);
  expect(player.advanceDialogue()).toEqual({ advanced: true, lineId: 'end-b' });
  expect(player.advanceDialogue()).toEqual({ advanced: false });
  await player.update(0);
  expect(player.index).toBe(1);
  expect(f.loaded[0]!.dispose).toHaveBeenCalledTimes(1);
  await player.update(100);
  expect(player.status).toBe('completed');
  player.stop();
  await player.start();
  expect(f.loaded.at(-1)!.runner.dialogue?.line.id).toBe('opening');
  player.dispose();
});

test('entry fades own the handoff clock, hold opaque during loading, and preserve next time-zero dialogue', async () => {
  const f = fixture(['a', 'b']);
  f.scenes.get('b')!.dialogue = [{ id: 'first', time: 0, duration: 0, text: 'Start', progression: 'advance-required' }];
  const story = {
    ...f.story,
    scenes: [
      f.story.scenes[0]!,
      { ...f.story.scenes[1]!, transition: { type: 'fade', duration: 200, color: '#123456' } },
    ],
  };
  const overlay = { setTransition: vi.fn() };
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const player = new StoryPlayer(story, {
    ...f,
    transitionOverlay: overlay,
    loadScene: async (definition, context) => {
      if (context.index === 1) await gate;
      return f.loadScene(definition, context);
    },
  });
  await player.start();
  await player.update(100);
  expect(player.status).toBe('transitioning');
  await player.update(50);
  expect(overlay.setTransition).toHaveBeenLastCalledWith({ color: '#123456', opacity: 0.5 });
  expect(f.loaded[0]!.dispose).not.toHaveBeenCalled();
  const handoff = player.update(50);
  expect(player.status).toBe('loading');
  expect(overlay.setTransition).toHaveBeenLastCalledWith({ color: '#123456', opacity: 1 });
  await player.update(999999);
  finish();
  await handoff;
  expect(f.loaded[1]!.runner.time).toBe(0);
  expect(f.loaded[1]!.runner.status).toBe('stopped');
  expect(player.advanceDialogue()).toEqual({ advanced: false });
  await player.update(100);
  expect(player.status).toBe('playing');
  expect(f.loaded[1]!.runner.status).toBe('waiting-for-dialogue-advance');
  expect(f.loaded[1]!.runner.time).toBe(0);
  player.dispose();
});

test('preloads only the next entry, activates on handoff, and releases late work on stop', async () => {
  const f = fixture(['a', 'b', 'c']);
  const prepared: {
    index: number;
    dispose: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    signal: AbortSignal;
  }[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const player = new StoryPlayer(f.story, {
    ...f,
    prepareScene: async (definition, context) => {
      const value = {
        index: context.index,
        signal: context.signal,
        dispose: vi.fn(),
        activate: vi.fn(() => f.loadScene(definition, context)),
      };
      prepared.push(value);
      if (context.index === 1) await gate;
      return value;
    },
  });
  await player.start();
  await Promise.resolve();
  expect(prepared.map(({ index }) => index)).toEqual([0, 1]);
  expect(prepared[1]!.activate).not.toHaveBeenCalled();
  player.stop();
  expect(prepared[1]!.signal.aborted).toBe(true);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(prepared[0]!.dispose).toHaveBeenCalledOnce();
  expect(prepared[1]!.dispose).toHaveBeenCalledOnce();
  expect(prepared[1]!.activate).not.toHaveBeenCalled();
  expect(f.loaded).toHaveLength(1);
  player.dispose();
});

test('failed background preparation is observed at the boundary and releases the active session', async () => {
  const f = fixture(['a', 'b']);
  const error = new Error('Missing next texture');
  const player = new StoryPlayer(f.story, {
    ...f,
    prepareScene: (definition, context) =>
      context.index === 1
        ? Promise.reject(error)
        : Promise.resolve({ activate: () => f.loadScene(definition, context), dispose() {} }),
  });
  await player.start();
  await Promise.resolve();
  await expect(player.update(100)).rejects.toBe(error);
  expect(player.status).toBe('failed');
  expect(f.loaded[0]!.dispose).toHaveBeenCalledOnce();
  player.dispose();
});

test('a fade on the first entry reveals before starting, and stop clears its overlay', async () => {
  const f = fixture(['a']);
  const overlay = { setTransition: vi.fn() };
  const player = new StoryPlayer(
    { ...f.story, scenes: [{ ...f.story.scenes[0], transition: { type: 'fade', duration: 100, color: '#000000' } }] },
    { ...f, transitionOverlay: overlay },
  );
  await player.start();
  expect(player.status).toBe('transitioning');
  expect(f.loaded[0]!.runner.time).toBe(0);
  await player.update(25);
  expect(overlay.setTransition).toHaveBeenLastCalledWith({ color: '#000000', opacity: 0.5 });
  player.stop();
  expect(overlay.setTransition).toHaveBeenLastCalledWith({ color: '#000000', opacity: 0 });
  expect(f.loaded[0]!.dispose).toHaveBeenCalledOnce();
  player.dispose();
});

test.each(['stop', 'dispose'] as const)('a %s from the fade renderer cannot resurrect playback', async (command) => {
  const f = fixture(['a', 'b']);
  let cancel = false;
  const overlay = {
    setTransition: () => {
      if (!cancel) return;
      cancel = false;
      player[command]();
    },
  };
  const player = new StoryPlayer(
    {
      ...f.story,
      scenes: [
        f.story.scenes[0]!,
        { ...f.story.scenes[1]!, transition: { type: 'fade', duration: 100, color: '#000000' } },
      ],
    },
    { ...f, transitionOverlay: overlay },
  );
  await player.start();
  await player.update(100);
  cancel = true;
  await player.update(50);
  expect(player.status).toBe(command === 'stop' ? 'stopped' : 'disposed');
  expect(player.currentSession).toBeUndefined();
  expect(f.loaded).toHaveLength(1);
  expect(f.loaded[0]!.dispose).toHaveBeenCalledOnce();
  player.dispose();
});

test('cancellation from an initial opaque overlay prevents scene allocation', async () => {
  const f = fixture(['a']);
  let cancel = true;
  const player = new StoryPlayer(f.story, {
    ...f,
    transitionOverlay: {
      setTransition: ({ opacity }) => {
        if (!cancel || opacity !== 1) return;
        cancel = false;
        player.dispose();
      },
    },
  });
  await player.start();
  expect(player.status).toBe('disposed');
  expect(player.index).toBe(-1);
  expect(f.loaded).toHaveLength(0);
});

test('a failing handoff renderer rejects start and leaves an observable failed player', async () => {
  const f = fixture(['a']);
  const error = new Error('Overlay unavailable');
  const player = new StoryPlayer(f.story, {
    ...f,
    transitionOverlay: {
      setTransition: ({ opacity }) => {
        if (opacity === 1) throw error;
      },
    },
  });
  await expect(player.start()).rejects.toBe(error);
  expect(player.status).toBe('failed');
  expect(player.error).toBe(error);
  expect(player.currentSession).toBeUndefined();
  player.dispose();
});

test('a failed load during a fade rejects its tick and releases the outgoing scene', async () => {
  const f = fixture(['a', 'b']);
  const error = new Error('Incoming scene unavailable');
  const player = new StoryPlayer(
    {
      ...f.story,
      scenes: [
        f.story.scenes[0]!,
        {
          ...f.story.scenes[1]!,
          transition: { type: 'fade', duration: 100, color: '#000000' },
        },
      ],
    },
    {
      ...f,
      transitionOverlay: { setTransition() {} },
      loadScene: (scene, context) => {
        if (context.index === 1) return Promise.reject(error);
        return f.loadScene(scene, context);
      },
    },
  );
  await player.start();
  await player.update(100);
  await expect(player.update(50)).rejects.toBe(error);
  expect(player.status).toBe('failed');
  expect(f.loaded[0]!.dispose).toHaveBeenCalledOnce();
  player.dispose();
});

test.each([1, 2])(
  'stopping at prepared handoff overlay %s releases the next lease without activation',
  async (opaqueCall) => {
    const f = fixture(['a', 'b']);
    const release = vi.fn();
    let remaining = Number.POSITIVE_INFINITY;
    const player = new StoryPlayer(f.story, {
      ...f,
      prepareScene: (scene, context) =>
        Promise.resolve({
          activate: () => f.loadScene(scene, context),
          dispose: release,
        }),
      transitionOverlay: {
        setTransition: ({ opacity }) => {
          if (opacity !== 1 || --remaining !== 0) return;
          player.stop();
        },
      },
    });
    await player.start();
    await Promise.resolve();
    remaining = opaqueCall;
    await player.update(100);
    await Promise.resolve();
    expect(player.status).toBe('stopped');
    expect(f.loaded).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(2);
    player.dispose();
  },
);
