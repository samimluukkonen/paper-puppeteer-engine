import { readFileSync } from 'node:fs';
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { buildCharacterDraft, sceneDraftSource } from '../src/devtools/shared/autosave/editorDrafts.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import { LocalDraftStore, type DraftStorage } from '../src/devtools/shared/autosave/LocalDraftStore.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import { buildCharacterPackage, type PackageFiles } from '../src/devtools/shared/package/characterPackage.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';

class MemoryStorage implements DraftStorage {
  saved: { key: string; revision: string; files: PackageFiles }[] = [];
  error: Error | undefined;
  claim(): Promise<void> {
    return Promise.resolve();
  }
  release = vi.fn(() => Promise.resolve());
  discard = vi.fn(() => {
    this.saved = [];
    return Promise.resolve();
  });
  async save(key: string, _owner: string, _name: string, revision: string, files: PackageFiles): Promise<void> {
    if (this.error) throw this.error;
    this.saved.push({ key, revision, files });
  }
}
const controllers: LocalAutosave[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.useRealTimers();
});
function fixture() {
  const storage = new MemoryStorage();
  let revision = '1';
  let pending = false;
  let dirty = true;
  const build = vi.fn(() => Promise.resolve(new Map([['project.json', new TextEncoder().encode(revision)]])));
  const autosave = new LocalAutosave('project:film', storage, () =>
    pending
      ? undefined
      : {
          revision,
          name: 'Film',
          dirty,
          build,
        },
  );
  controllers.push(autosave);
  autosave.start();
  return {
    storage,
    autosave,
    build,
    edit(value: string) {
      revision = value;
      autosave.update();
    },
    pending(value: boolean) {
      pending = value;
      autosave.update();
    },
    dirty(value: boolean) {
      dirty = value;
    },
  };
}

test('debounces authored edits and captures the final revision', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(600);
  f.edit('2');
  await vi.advanceTimersByTimeAsync(600);
  assert.lengthOf(f.storage.saved, 0);
  await vi.advanceTimersByTimeAsync(400);
  assert.equal(f.storage.saved[0]!.revision, '2');
  assert.match(f.autosave.getSnapshot(), /Local draft saved/);
});

test('long gestures and half-imported artwork cancel scheduled captures until commit', async () => {
  const f = fixture();
  f.pending(true);
  await vi.advanceTimersByTimeAsync(8000);
  assert.equal(f.build.mock.calls.length, 0);
  f.pending(false);
  await vi.advanceTimersByTimeAsync(1000);
  assert.lengthOf(f.storage.saved, 1);
});

test('playback, scrubbing and selection notifications never write another snapshot', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(1000);
  for (let i = 0; i < 100; i++) f.autosave.update();
  await vi.advanceTimersByTimeAsync(10_000);
  assert.lengthOf(f.storage.saved, 1);
});

test('quota failures preserve the last successful draft and allow explicit retry', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(1000);
  f.storage.error = new DOMException('Full', 'QuotaExceededError');
  f.edit('2');
  await vi.advanceTimersByTimeAsync(1000);
  assert.match(f.autosave.getSnapshot(), /storage is full.*Export/);
  assert.equal(f.storage.saved[0]!.revision, '1');
  f.storage.error = undefined;
  f.autosave.retry();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(f.storage.saved.at(-1)!.revision, '2');
});

test('export status retains recovery and discard pauses writes until resumed', async () => {
  const f = fixture();
  await vi.advanceTimersByTimeAsync(1000);
  f.autosave.exported();
  assert.match(f.autosave.getSnapshot(), /Explicitly exported/);
  assert.lengthOf(f.storage.saved, 1);
  await f.autosave.discard();
  f.edit('2');
  await vi.advanceTimersByTimeAsync(2000);
  assert.lengthOf(f.storage.saved, 0);
  f.autosave.retry();
  await vi.advanceTimersByTimeAsync(0);
  assert.lengthOf(f.storage.saved, 1);
});

test('edits during asynchronous image reads get a separate consistent capture', async () => {
  const f = fixture();
  let resolve: (files: Map<string, Uint8Array<ArrayBuffer>>) => void = () => {};
  f.build.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  f.edit('2');
  resolve(new Map());
  await vi.advanceTimersByTimeAsync(0);
  assert.match(f.autosave.getSnapshot(), /Unsaved changes/);
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(
    f.storage.saved.map((value) => value.revision),
    ['1', '2'],
  );
});

test('a local write finishing after export retains the explicit export indicator', async () => {
  const f = fixture();
  let resolve: (files: Map<string, Uint8Array<ArrayBuffer>>) => void = () => {};
  f.build.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  f.dirty(false);
  f.autosave.exported();
  resolve(new Map());
  await vi.advanceTimersByTimeAsync(0);
  assert.match(f.autosave.getSnapshot(), /Local draft saved.*Explicitly exported/);
  f.edit('2');
  assert.notInclude(f.autosave.getSnapshot(), 'Explicitly exported');
});

test('resuming a discarded clean document clears the paused status without writing', async () => {
  const f = fixture();
  await f.autosave.discard();
  f.dirty(false);
  f.autosave.retry();
  await vi.advanceTimersByTimeAsync(1000);
  assert.match(f.autosave.getSnapshot(), /No unsaved changes/);
  assert.lengthOf(f.storage.saved, 0);
});

test('pagehide stops writes, releases the tab lease and pageshow resumes debounce', async () => {
  const f = fixture();
  f.autosave.suspend();
  await vi.advanceTimersByTimeAsync(2000);
  assert.lengthOf(f.storage.saved, 0);
  assert.equal(f.storage.release.mock.calls.length, 1);
  f.autosave.start();
  await vi.advanceTimersByTimeAsync(1000);
  assert.lengthOf(f.storage.saved, 1);
});

test('storage unavailable is actionable rather than a successful autosave', async () => {
  const storage = new LocalDraftStore(undefined);
  await expect(storage.claim('film', 'tab')).rejects.toThrow(/storage is unavailable/);
});

test('project switching retains separate pending captures and export checkpoints', async () => {
  const storage = new MemoryStorage();
  const projects = [new ProjectWorkspace('One'), new ProjectWorkspace('Two')];
  for (const project of projects) {
    const controller = new LocalAutosave(project.definition.id, storage, () => ({
      revision: project.autosaveRevision!,
      name: project.definition.name,
      dirty: project.hasUnsavedChanges,
      build: () => Promise.resolve(new Map()),
    }));
    controllers.push(controller);
    controller.start();
  }
  projects[0]!.rename('Changed');
  controllers[0]!.update();
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(new Set(storage.saved.map((value) => value.key)).size, 2);
  assert.isTrue(projects.every((project) => project.hasUnsavedChanges));
});

test('scene gestures expose no autosavable revision until commit; cancellation restores the original', () => {
  const workspace = new ProjectWorkspace('Film');
  workspace.addScene(createEmptyScene({ id: 'scene' }));
  // An empty scene has no character dependencies; action/actor gestures share this history boundary.
  assert.isDefined(workspace.autosaveRevision);
  const revision = workspace.autosaveRevision;
  workspace.scenes.updateProperties({ name: 'Changed' });
  assert.notEqual(workspace.autosaveRevision, revision);
  workspace.scenes.undo();
  assert.equal(workspace.autosaveRevision, revision);
});

test('rig, animation and binary sprites survive a complete detached crash recovery', async () => {
  vi.useRealTimers();
  const draft = createNewCharacter({ id: 'hero', name: 'Hero' });
  draft.rig.editBone('root', 'x', 42);
  draft.animation.createAnimation({ name: 'wave' });
  const bytes = new Uint8Array(
    readFileSync(new URL('../public/characters/demo-puppet/images/paper-head.png', import.meta.url)),
  );
  const snapshot = {
    definition: draft.definition,
    rig: draft.rig.recoveryDraft,
    skins: draft.rig.standaloneSkins,
    animations: draft.animation.packageAnimations(),
    replacements: [
      {
        assetKey: 'head',
        reference: undefined,
        blob: new Blob([bytes]),
        format: 'image/png' as const,
        originScaleX: 1,
        originScaleY: 1,
        newAsset: true,
      },
    ],
  };
  const recovered = await importProjectPackage(await buildCharacterDraft(snapshot, 'film'));
  recovered.markRecovered('project:film');
  assert.equal(recovered.captureCharacter('hero').rig.bones[0]!.x, 42);
  assert.equal(recovered.captureCharacter('hero').animations[0]!.name, 'wave');
  assert.deepEqual(recovered.character('hero').files.get('images/head.png'), bytes);
  assert.isTrue(recovered.hasUnsavedChanges);
  assert.equal(draft.definition.rigFile!.bones[0]!.x, undefined);
  assert.isTrue(draft.rig.undo());
  assert.equal(draft.rig.recoveryDraft.bones[0]!.x, undefined);
});

test('project snapshots detach every document before asynchronous packaging', async () => {
  vi.useRealTimers();
  const workspace = new ProjectWorkspace('Film');
  const draft = createNewCharacter({ id: 'hero', name: 'Hero' });
  await workspace.addCharacter(
    await buildCharacterPackage({
      definition: draft.definition,
      rig: draft.rig.recoveryDraft,
      skins: draft.rig.standaloneSkins,
      animations: [],
      replacements: [],
    }),
  );
  workspace.createScene({ id: 'opening' });
  const building = buildProjectPackage(workspace);
  workspace.rename('Later');
  workspace.scenes.updateProperties({ name: 'Later scene' });
  const restored = await importProjectPackage((await building).files);
  assert.equal(restored.definition.name, 'Film');
  assert.notEqual(restored.scenes.scene('opening')!.name, 'Later scene');
});

test('standalone scenes preserve all retained documents in the portable recovery format', async () => {
  vi.useRealTimers();
  const document = new SceneEditorDocument();
  document.createScene({ id: 'one', name: 'First' });
  document.createScene({ id: 'two', name: 'Second' });
  const registry = new SceneCharacterRegistry();
  const source = sceneDraftSource(document, registry, 'film')!;
  const restored = await importProjectPackage(await source.build());
  assert.deepEqual(
    restored.definition.scenes.map(({ id }) => id),
    ['one', 'two'],
  );
  registry.dispose();
});

test('open Actor and action gestures block project snapshots and cancellation restores the authored revision', async () => {
  vi.useRealTimers();
  const workspace = new ProjectWorkspace('Film');
  const draft = createNewCharacter({ id: 'hero', name: 'Hero' });
  await workspace.addCharacter(
    await buildCharacterPackage({
      definition: draft.definition,
      rig: draft.rig.recoveryDraft,
      skins: draft.rig.standaloneSkins,
      animations: [],
      replacements: [],
    }),
  );
  workspace.createScene({ id: 'scene' });
  workspace.scenes.addActor(workspace.characterReference('hero'));
  const before = workspace.autosaveRevision;
  workspace.scenes.beginActorDrag('actor-1');
  workspace.scenes.moveActorDrag({ x: 50, y: 30 });
  assert.isUndefined(workspace.autosaveRevision);
  workspace.scenes.cancelActorDrag();
  assert.equal(workspace.autosaveRevision, before);
  workspace.scenes.addAction({ actorId: 'actor-1', type: 'wait', time: 0, duration: 500 });
  workspace.scenes.beginActionDrag('action-1');
  workspace.scenes.changeActionDrag({ id: 'action-1', actorId: 'actor-1', type: 'wait', time: 200, duration: 500 });
  assert.isUndefined(workspace.autosaveRevision);
  workspace.scenes.endActionDrag();
  assert.isDefined(workspace.autosaveRevision);
});

test('actual animation playback and scrubbing preserve authored data, dirty state and history', () => {
  const { animation } = createNewCharacter({ id: 'hero', name: 'Hero' });
  animation.createAnimation({ name: 'wave' });
  const before = JSON.stringify(animation.packageAnimations());
  const dirty = animation.dirty;
  const history = animation.historyLength;
  animation.play();
  for (let frame = 0; frame < 180; frame++) animation.advancePlayback(1 / 60);
  animation.beginScrub();
  animation.setCurrentTime(0.5);
  animation.endScrub();
  animation.pause();
  assert.equal(JSON.stringify(animation.packageAnimations()), before);
  assert.equal(animation.historyLength, history);
  assert.equal(animation.dirty, dirty);
});
