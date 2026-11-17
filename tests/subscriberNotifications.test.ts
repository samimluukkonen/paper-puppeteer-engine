import { afterEach, assert, test, vi } from 'vitest';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import { ArtworkController } from '../src/devtools/shared/artwork/ArtworkController.js';
import { notifySubscribers } from '../src/devtools/shared/subscriberNotifications.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('subscriber mutations affect the next notification and all failures are reported together', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const errors = [new Error('First'), new Error('Second')];
  const added = vi.fn();
  const removed = vi.fn(() => {
    throw errors[1];
  });
  const listeners = new Set<() => void>([
    () => {
      listeners.delete(removed);
      listeners.add(added);
      throw errors[0];
    },
    removed,
  ]);
  assert.doesNotThrow(() => notifySubscribers(listeners, 'Subscribers failed.'));
  assert.equal(removed.mock.calls.length, 1);
  assert.equal(added.mock.calls.length, 0);
  const failure: unknown = reporter.mock.calls[0]![0];
  assert.instanceOf(failure, AggregateError);
  if (failure instanceof AggregateError) assert.deepEqual(failure.errors, errors);
  notifySubscribers(listeners, 'Subscribers failed.');
  assert.equal(added.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[1]![0], errors[0]);
});

test('hosts without reportError receive a deferred error after the operation finishes', () => {
  vi.stubGlobal('reportError', undefined);
  let deferred: (() => void) | undefined;
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    deferred = callback;
  });
  const failure = new Error('Subscriber failed');
  assert.doesNotThrow(() =>
    notifySubscribers(
      new Set([
        () => {
          throw failure;
        },
      ]),
      'Subscribers failed.',
    ),
  );
  assert.isDefined(deferred);
  assert.throws(() => deferred!(), /Subscriber failed/);
});

test('attachment refresh completes its subscriber snapshot despite failures and subscription changes', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const controller = new AttachmentController();
  const failure = new Error('Attachment subscriber failed');
  const added = vi.fn();
  const removed = vi.fn();
  let release = () => {};
  controller.subscribe(() => {
    release();
    controller.subscribe(added);
    throw failure;
  });
  release = controller.subscribe(removed);
  const before = controller.getSnapshot();

  assert.doesNotThrow(() => controller.refresh());
  assert.notStrictEqual(controller.getSnapshot(), before);
  assert.equal(removed.mock.calls.length, 1);
  assert.equal(added.mock.calls.length, 0);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
  controller.refresh();
  assert.equal(removed.mock.calls.length, 1);
  assert.equal(added.mock.calls.length, 1);
  controller.dispose();
});

test('attachment disposal releases artwork and all UI subscribers even when a subscriber throws', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const artwork = new ArtworkController();
  const releaseArtwork = vi.fn();
  vi.spyOn(artwork, 'subscribe').mockReturnValue(releaseArtwork);
  const controller = new AttachmentController(artwork);
  const failure = new Error('Attachment subscriber failed');
  controller.subscribe(() => {
    throw failure;
  });
  const listener = vi.fn();
  controller.subscribe(listener);

  assert.doesNotThrow(() => controller.dispose());
  assert.equal(releaseArtwork.mock.calls.length, 1);
  assert.equal(listener.mock.calls.length, 1);
  assert.strictEqual(reporter.mock.calls[0]![0], failure);
  controller.refresh();
  assert.equal(listener.mock.calls.length, 1);
  assert.equal(reporter.mock.calls.length, 1);
  artwork.dispose();
});

test('project and scene edits retain successful history and notify remaining subscribers after a UI failure', () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const project = new ProjectWorkspace('Film');
  const document = new SceneEditorDocument();
  for (const owner of [project, document]) {
    owner.subscribe(() => {
      throw new Error('UI failed');
    });
    const notified = vi.fn();
    owner.subscribe(notified);
    if (owner === project) {
      assert.doesNotThrow(() => project.rename('Renamed'));
      assert.equal(project.definition.name, 'Renamed');
      project.undo();
      assert.equal(project.definition.name, 'Film');
    } else {
      assert.isTrue(document.createScene({ id: 'film', name: 'Film', duration: 1000 }));
      assert.isTrue(document.updateProperties({ name: 'Renamed' }));
      assert.deepEqual(document.validationIssues, []);
      assert.isTrue(document.undo());
      assert.equal(document.workingScene?.name, 'Film');
    }
    assert.isAtLeast(notified.mock.calls.length, 2);
  }
  assert.isAtLeast(reporter.mock.calls.length, 4);
});

test('asset subscriber failures do not turn successful character and image loads into failures', async () => {
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const definition = createNewCharacter({ id: 'hero', name: 'Hero' }).definition;
  const load = vi.fn(() => Promise.resolve(definition));
  const registry = new SceneCharacterRegistry(load);
  const images = new SceneImageRegistry();
  const notified = vi.fn();
  for (const owner of [registry, images]) {
    owner.subscribe(() => {
      throw new Error('UI failed');
    });
    owner.subscribe(notified);
  }
  try {
    assert.strictEqual(await registry.load('character.json'), definition);
    assert.strictEqual(await registry.load('character.json'), definition);
    assert.equal(load.mock.calls.length, 1);
    const bytes = new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>);
    assert.doesNotThrow(() => images.register('../images/paper.png', bytes));
    assert.isTrue(images.has('../images/paper.png'));
    assert.equal(notified.mock.calls.length, 2);
    assert.equal(reporter.mock.calls.length, 2);
  } finally {
    registry.dispose();
  }
});

test('playback UI failures preserve clock commands and resource cleanup', () => {
  vi.stubGlobal('reportError', vi.fn());
  const playback = new SceneEditorPlayback();
  const notified = vi.fn();
  playback.subscribe(() => {
    throw new Error('UI failed');
  });
  playback.subscribe(notified);
  playback.sync(createEmptyScene({ id: 'film', name: 'Film', duration: 1000 }), true, () => {
    throw new Error('Empty scenes have no Actors.');
  });
  playback.play();
  playback.update(250);
  assert.equal(playback.time, 250);
  assert.equal(playback.error, '');
  assert.doesNotThrow(() => playback.dispose());
  assert.isFalse(playback.ready);
  assert.equal(notified.mock.calls.length, 4);
});
