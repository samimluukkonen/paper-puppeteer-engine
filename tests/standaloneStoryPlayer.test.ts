import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { expect, test, vi } from 'vitest';
import { DialogueKeyboardInput } from '../src/engine/DialogueKeyboardInput.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { StandaloneStoryPlayer, type StandaloneStorySource } from '../src/engine/StandaloneStoryPlayer.js';

vi.mock('phaser', () => ({ default: {} }));

/** Minimal DOM boundary; real focus, bubbling, native controls and Web Audio are covered in Playwright. */
function dom() {
  const doc = { activeElement: null as Element | null, createElement: (_tag: string) => new Element() };
  class Element extends EventTarget {
    ownerDocument = doc;
    style = { cssText: '' };
    textContent = '';
    type = '';
    hidden = false;
    blocked = false;
    tagName = 'DIV';
    children: Element[] = [];
    closest(selector: string) {
      return this.blocked && selector.includes('hidden') ? this : null;
    }
    contains(node: unknown) {
      return node === this || this.children.includes(node as Element);
    }
    setAttribute() {}
    append(...children: Element[]) {
      this.children.push(...children);
    }
    remove() {}
    focus() {
      doc.activeElement = this;
    }
  }
  const element = new Element();
  element.focus();
  const key = (key = 'Enter', options: Partial<KeyboardEvent> = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, repeat: false, ...options });
    element.dispatchEvent(event);
    return event;
  };
  return { element, target: element as unknown as HTMLElement, key, doc };
}

function source() {
  const scenes = new Map(
    ['a', 'b'].map((id) => {
      const scene = createEmptyScene({ id, duration: 100 });
      scene.dialogue = ['01', '02'].map((id) => ({
        id,
        text: '森は静かだった。\nA quiet forest.',
        speakerName: '語り手',
        time: 0,
        duration: 0,
        progression: 'advance-required' as const,
      }));
      return [id, scene];
    }),
  );
  const sessions: { runner: SceneRunner; dispose: ReturnType<typeof vi.fn>; applyCamera: ReturnType<typeof vi.fn> }[] =
    [];
  const value: StandaloneStorySource = {
    definition: {
      version: 1,
      id: 'film',
      name: 'Film',
      scenes: [...scenes.keys()].map((sceneAssetId) => ({ id: sceneAssetId, sceneAssetId })),
    },
    scenes,
    loadScene: (definition) => {
      const runner = new SceneRunner(definition, {
        createActor: () => {
          throw new Error('No Actors expected.');
        },
      });
      const session = { runner, dispose: vi.fn(() => runner.dispose()), applyCamera: vi.fn() };
      sessions.push(session);
      return Promise.resolve(session);
    },
  };
  return { value, sessions, scenes };
}
function fixture(loadStory?: (id: string, signal: AbortSignal) => Promise<StandaloneStorySource>) {
  const f = source();
  const d = dom();
  const events = new EventEmitter();
  const scene = { events, cameras: { main: {} } } as unknown as Phaser.Scene;
  const player = new StandaloneStoryPlayer(scene, d.target, {
    loadStory: loadStory ?? (() => Promise.resolve(f.value)),
  });
  const tick = async (delta = 100) => {
    events.emit('update', 0, delta);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { ...f, ...d, player, events, tick };
}

test('Enter advances one line; repeats, no hold, inactive focus and disposed bindings do nothing', () => {
  const d = dom();
  let waiting = false;
  const advanceDialogue = vi.fn();
  const input = new DialogueKeyboardInput(d.target, { waiting: () => waiting, advanceDialogue });
  expect(d.key().defaultPrevented).toBe(false);
  waiting = true;
  expect(d.key().defaultPrevented).toBe(true);
  d.key('Enter', { repeat: true });
  d.key('Enter', { ctrlKey: true });
  d.key('Enter', { metaKey: true });
  d.key('Enter', { altKey: true });
  d.key('Enter', { shiftKey: true });
  d.key('Enter', { isComposing: true });
  d.key(' ');
  d.element.tagName = 'INPUT';
  d.key();
  d.element.tagName = 'DIV';
  d.doc.activeElement = null;
  d.key();
  d.element.focus();
  d.element.blocked = true;
  d.key();
  d.element.blocked = false;
  expect(advanceDialogue).toHaveBeenCalledTimes(1);
  input.dispose();
  input.dispose();
  expect(d.key().defaultPrevented).toBe(false);
  expect(advanceDialogue).toHaveBeenCalledTimes(1);
});

test('equivalent Space input and repeated binding/disposal never duplicate callbacks', () => {
  const d = dom();
  const advanceDialogue = vi.fn();
  for (let i = 0; i < 5; i++) {
    const input = new DialogueKeyboardInput(d.target, { keys: [' '], waiting: () => true, advanceDialogue });
    d.key();
    d.key(' ');
    input.dispose();
    d.key(' ');
  }
  expect(advanceDialogue).toHaveBeenCalledTimes(5);
});

test('load, play, consecutive dialogue, transition, completion, stop and restart share SceneRunner', async () => {
  const f = fixture();
  expect(f.player.status).toBe('empty');
  await expect(f.player.play()).rejects.toThrow(/Load a story/);
  await f.player.load('film');
  expect(f.sessions).toHaveLength(0);
  f.key(); // Initial Enter never implicitly starts playback.
  expect(f.player.status).toBe('stopped');
  await f.player.play();
  expect(f.player.waitingForDialogue).toBe(true);
  expect(f.sessions[0]!.applyCamera).toHaveBeenCalledTimes(1);
  expect(f.element.children[0]!.textContent).toBe('Press Enter to continue');
  expect(f.sessions[0]!.runner.dialogue?.speaker).toBe('語り手');
  f.key();
  f.key('Enter', { repeat: true });
  expect(f.sessions[0]!.runner.dialogue?.line.id).toBe('02');
  f.key();
  f.key(); // No hold: cannot skip the transition.
  await f.tick();
  expect(f.player.index).toBe(1);
  expect(f.sessions[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(f.sessions[1]!.runner.dialogue?.line.id).toBe('01');
  f.key('Enter', { repeat: true });
  expect(f.sessions[1]!.runner.dialogue?.line.id).toBe('01');
  f.player.advanceDialogue(); // Equivalent host input.
  f.player.advanceDialogue();
  await f.tick();
  expect(f.player.status).toBe('completed');
  expect(f.element.children[0]!.textContent).toBe('Story complete');
  await f.player.play();
  expect(f.player.index).toBe(0);
  expect(f.sessions[2]!.runner.dialogue?.line.id).toBe('01');
  f.player.stop();
  expect(f.player.status).toBe('stopped');
  expect(f.player.advanceDialogue()).toEqual({ advanced: false });
  await f.tick();
  expect(f.sessions).toHaveLength(3);
  await f.player.play();
  f.events.emit('shutdown');
  f.player.dispose();
  expect(f.player.status).toBe('disposed');
  expect(f.events.listenerCount('update')).toBe(0);
  expect(f.events.listenerCount('shutdown')).toBe(0);
  expect(f.sessions.every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
  await expect(f.player.load('film')).rejects.toThrow(/disposed/);
});

test.each(['stop', 'dispose', 'load'] as const)('%s cancels a pending story resolution', async (command) => {
  let resolve!: (source: StandaloneStorySource) => void;
  const signals: AbortSignal[] = [];
  const f = fixture((_id, signal) => {
    signals.push(signal);
    return new Promise((ready) => {
      resolve = ready;
    });
  });
  const loading = f.player.load('old');
  const oldResolve = resolve;
  let replacement: Promise<void> | undefined;
  if (command === 'load') replacement = f.player.load('new');
  else f.player[command]();
  expect(signals[0]!.aborted).toBe(true);
  oldResolve(f.value);
  await loading;
  if (replacement) {
    resolve(f.value);
    await replacement;
  }
  expect(f.player.status).toBe(command === 'dispose' ? 'disposed' : command === 'stop' ? 'empty' : 'stopped');
  expect(f.sessions).toHaveLength(0);
  f.player.dispose();
});

test('load failures are observable and a replacement story recovers', async () => {
  const f = fixture();
  await f.player.load('film');
  await f.player.play();
  await f.player.load('replacement');
  expect(f.sessions[0]!.dispose).toHaveBeenCalledTimes(1);
  await f.player.play();
  f.player.dispose();
  const failure = new Error('Missing project story');
  let fail = true;
  const broken = fixture(() => (fail ? Promise.reject(failure) : Promise.resolve(source().value)));
  await expect(broken.player.load('missing')).rejects.toBe(failure);
  expect(broken.player.status).toBe('failed');
  expect(broken.player.error).toBe(failure);
  expect(broken.element.children[0]!.textContent).toContain(failure.message);
  fail = false;
  await broken.player.load('film');
  await broken.player.play();
  expect(broken.player.status).toBe('playing');
  expect(broken.player.error).toBeUndefined();
  broken.player.dispose();
});

test('an uncancelled old transition cannot block ticks or poison a restarted viewer', async () => {
  const original = source();
  let rejectOld!: (error: Error) => void;
  let deferred = false;
  const value: StandaloneStorySource = {
    ...original.value,
    loadScene: (definition, context) => {
      if (context.index === 1 && !deferred) {
        deferred = true;
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      }
      return original.value.loadScene(definition, context);
    },
  };
  const f = fixture(() => Promise.resolve(value));
  await f.player.load('film');
  await f.player.play();
  f.player.advanceDialogue();
  f.player.advanceDialogue();
  await f.tick();
  expect(f.player.status).toBe('loading');
  f.player.stop();
  await f.player.play();
  await f.tick(20);
  expect(original.sessions.at(-1)!.runner.dialogueHoldPlayback?.holdElapsedTime).toBe(20);
  rejectOld(new Error('Late old loader rejection'));
  await f.tick(20);
  expect(f.player.status).toBe('playing');
  expect(f.player.error).toBeUndefined();
  f.player.dispose();
});

test.each(['stop', 'dispose'] as const)(
  '%s releases a late scene without camera changes or playback',
  async (command) => {
    const original = source();
    let resolve!: (value: Awaited<ReturnType<StandaloneStorySource['loadScene']>>) => void;
    let context!: Parameters<StandaloneStorySource['loadScene']>[1];
    const f = fixture(() =>
      Promise.resolve({
        ...original.value,
        loadScene: (_definition, loadingContext) => {
          context = loadingContext;
          return new Promise((ready) => {
            resolve = ready;
          });
        },
      }),
    );
    await f.player.load('film');
    const playing = f.player.play();
    expect(f.player.status).toBe('loading');
    f.player[command]();
    expect(context.signal.aborted).toBe(true);
    const session = await original.value.loadScene(original.scenes.get('a')!, context);
    const late = original.sessions[0]!;
    const play = vi.spyOn(late.runner, 'play');
    resolve(session);
    await playing;
    expect(late.applyCamera).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(late.dispose).toHaveBeenCalledTimes(1);
    f.player.dispose();
  },
);

test.each(['shutdown', 'destroy'])(
  'Phaser %s releases the viewer session and every lifecycle binding',
  async (event) => {
    const f = fixture();
    await f.player.load('film');
    await f.player.play();
    f.events.emit(event);
    expect(f.player.status).toBe('disposed');
    expect(f.sessions[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(f.events.eventNames()).toEqual([]);
  },
);
