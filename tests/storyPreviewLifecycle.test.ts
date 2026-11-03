import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { StoryPreviewScene } from '../src/devtools/project/StoryPreview.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import type { StandaloneStorySource } from '../src/engine/StandaloneStoryPlayer.js';
import { StoryPackageLoader } from '../src/engine/StoryPackageLoader.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      cameras = { main: {} };
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
  },
}));
vi.mock('../src/devtools/project/projectPackage.js', () => ({
  buildProjectStoryPackage: () => Promise.resolve(new Map()),
}));
vi.mock('../src/engine/StoryPackageLoader.js', () => ({ StoryPackageLoader: { load: vi.fn() } }));

test('a restarted artist preview ticks immediately while cancelled next-scene preparation settles', async () => {
  const definition = {
    version: 1 as const,
    id: 'film',
    name: 'Film',
    scenes: [
      { id: 'first', sceneAssetId: 'a' },
      { id: 'second', sceneAssetId: 'b' },
    ],
  };
  let reject!: (error: Error) => void;
  const delayed = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const runners: SceneRunner[] = [];
  const disposed = vi.fn();
  const source: StandaloneStorySource = {
    definition,
    scenes: new Map(['a', 'b'].map((id) => [id, createEmptyScene({ id, duration: 100 })])),
    prepareScene: (scene, context) => {
      if (context.index === 1) return delayed;
      return Promise.resolve({
        dispose() {},
        activate: () => {
          const runner = new SceneRunner(scene, {
            createActor: () => {
              throw new Error('No Actors');
            },
          });
          runners.push(runner);
          return Promise.resolve({ runner, applyCamera: vi.fn(), dispose: () => runner.dispose() });
        },
      });
    },
    loadScene: () => {
      throw new Error('Expected preparation');
    },
    dispose: disposed,
  };
  vi.spyOn(StoryPackageLoader, 'load').mockResolvedValue(source);
  const report = vi.fn();
  const preview = new StoryPreviewScene(definition, new ProjectWorkspace('Film'), report);
  try {
    preview.create();
    await vi.waitFor(() => expect(runners[0]?.status).toBe('playing'));
    preview.update(0, 100); // Old tick waits for next preparation.
    preview.restart();
    await vi.waitFor(() => expect(runners[1]?.status).toBe('playing'));
    preview.update(0, 25);
    expect(runners[1]!.time).toBe(25);
    reject(new Error('Obsolete preparation failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    preview.update(0, 25);
    expect(runners[1]!.time).toBe(50);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'playing', error: '' }));
  } finally {
    preview.disposePreview();
  }
  preview.disposePreview();
  expect(runners.every((runner) => runner.status === 'disposed')).toBe(true);
  expect(disposed).toHaveBeenCalledOnce();
});
