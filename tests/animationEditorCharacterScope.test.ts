import { EventEmitter } from 'eventemitter3';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorScene } from '../src/devtools/animation-editor/AnimationEditorScene.js';
import { characterScope } from '../src/devtools/animation-editor/characterScope.js';
import { EnvironmentPreviewCamera } from '../src/devtools/animation-editor/EnvironmentPreviewCamera.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import {
  AUTOSAVE_POLL_MS,
  attachLocalAutosave,
  LocalAutosave,
  type PageLifecycleEvents,
} from '../src/devtools/shared/autosave/LocalAutosave.js';
import type { DraftStorage } from '../src/devtools/shared/autosave/LocalDraftStore.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));
vi.mock('../src/devtools/animation-editor/EnvironmentPreviewCamera.js', () => ({
  EnvironmentPreviewCamera: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

class MemoryStorage implements DraftStorage {
  claim = vi.fn(() => Promise.resolve());
  release = vi.fn(() => Promise.resolve());
  discard = vi.fn(() => Promise.resolve());
  save = vi.fn(() => Promise.resolve());
}

function loadScene(open: Parameters<typeof characterScope<[unknown, string]>>[0]) {
  vi.stubGlobal('window', { location: { href: 'https://example.test/animation-editor/' } });
  vi.mocked(loadSceneCharacter).mockResolvedValue(demoCharacter);
  const failed = vi.fn();
  const character = characterScope(open, failed);
  const environment = new EnvironmentPreviewController();
  const scene = new AnimationEditorScene(character.ready, character.failed, { environment });
  const fixture = puppetScene();
  Object.assign(scene, {
    add: fixture.add,
    textures: fixture.textures,
    input: new EventEmitter(),
    cameras: { main: {} },
  });
  scene.create();
  return { scene, failed, character, environment };
}

test('a throw after ready releases the character autosave and project binding', async () => {
  vi.useFakeTimers();
  vi.mocked(EnvironmentPreviewCamera).mockImplementation(function () {
    throw new Error('Camera failed');
  });
  const storage = new MemoryStorage();
  const page = { window: new EventTarget(), document: new EventTarget() } as unknown as PageLifecycleEvents;
  const releaseProject = vi.fn();
  let captures = 0;
  let autosave: LocalAutosave | undefined;
  const { scene, failed, environment } = loadScene((scope, _state, id) => {
    scope.add(releaseProject);
    autosave = new LocalAutosave(`character:${id}`, storage, () => {
      captures++;
      const snapshot = scene.packageSnapshot();
      return {
        name: id,
        revision: JSON.stringify(snapshot.rig),
        dirty: false,
        build: () => Promise.resolve(new Map()),
      };
    });
    scope.add(attachLocalAutosave(autosave, { page }));
  });
  await vi.waitFor(() => assert.equal(failed.mock.calls.length, 1));
  assert.deepEqual(failed.mock.calls, [['Error: Camera failed']]);
  assert.equal(releaseProject.mock.calls.length, 1);
  const capturesAtFailure = captures;
  const claimsAtFailure = storage.claim.mock.calls.length;
  vi.advanceTimersByTime(Math.max(AUTOSAVE_POLL_MS, 5000) * 2);
  assert.equal(captures, capturesAtFailure, 'no autosave poll reads the failed character');
  assert.equal(storage.claim.mock.calls.length, claimsAtFailure, 'no heartbeat renews the failed draft lease');
  assert.notEqual(autosave!.getSnapshot(), 'No character is loaded.');
  environment.dispose();
});

test('a throw part-way through the ready callback releases what it had already bound', async () => {
  const bound = vi.fn();
  const { failed, environment } = loadScene((scope) => {
    scope.add(bound);
    throw new Error('Ready failed');
  });
  await vi.waitFor(() => assert.equal(failed.mock.calls.length, 1));
  assert.deepEqual(failed.mock.calls, [['Error: Ready failed']]);
  assert.equal(bound.mock.calls.length, 1);
  environment.dispose();
});

test('the next ready releases the previous character before opening the new one', () => {
  const order: string[] = [];
  const character = characterScope<[string]>((scope, id) => {
    order.push(`open ${id}`);
    scope.add(() => order.push(`release ${id}`));
  }, vi.fn());
  character.ready('first');
  character.ready('second');
  character.close();
  character.close();
  assert.deepEqual(order, ['open first', 'release first', 'open second', 'release second']);
});

test('failure work still runs when a release throws', () => {
  const failed = vi.fn();
  const character = characterScope<[]>((scope) => {
    scope.add(() => {
      throw new Error('Release failed');
    });
  }, failed);
  character.ready();
  assert.throws(() => character.failed('Load failed'), AggregateError);
  assert.deepEqual(failed.mock.calls, [['Load failed']]);
});
