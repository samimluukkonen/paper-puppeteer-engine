import { afterEach, assert, expect, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  ProjectEditorHosts,
  type ProjectEditorHost,
  type ProjectSession,
} from '../src/devtools/project/ProjectEditorHosts.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import * as packages from '../src/devtools/shared/package/characterPackage.js';
import { rigCompatibilityRevision } from '../src/engine/rigBoneMapping.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function session(): Promise<ProjectSession> {
  const draft = createNewCharacter({ id: 'hero', name: 'Hero' });
  const workspace = new ProjectWorkspace('Film');
  await workspace.addCharacter(
    await packages.buildCharacterPackage({
      definition: draft.definition,
      rig: draft.definition.rigFile!,
      skins: draft.definition.standaloneSkins,
      animations: [],
      replacements: [],
    }),
  );
  return {
    key: crypto.randomUUID(),
    workspace,
    autosave: new LocalAutosave(
      'film',
      {
        claim: async () => {},
        release: async () => {},
        save: async () => {},
        discard: async () => {},
      },
      () => undefined,
    ),
    releaseAutosave: () => {},
  };
}

function fixture() {
  let hosts: readonly ProjectEditorHost[] = [];
  const activate = vi.fn<(token: string | undefined) => void>();
  const controller = new ProjectEditorHosts({
    baseUrl: 'https://example.test/project/',
    activate,
    changed: (next) => {
      hosts = next;
    },
    validate: () => {},
  });
  return { controller, activate, hosts: () => hosts };
}

test('character hosts retain one owner across view changes and release independent project leases', async () => {
  const first = await session();
  const second = await session();
  const snapshot = first.workspace.captureCharacter('hero');
  const dispose = vi.fn();
  const runtime = vi.spyOn(packages, 'openPackageRuntime').mockImplementation(async () => ({
    definition: first.workspace.character('hero').definition,
    dispose,
  }));
  const f = fixture();
  try {
    await f.controller.open(first, 'character', 'hero');
    const host = f.hosts()[0]!;
    const navigate = vi.fn();
    const unbind = host.context.bindCharacter(
      () => snapshot,
      () => false,
      navigate,
    );
    host.context.navigate('project');
    await f.controller.open(first, 'character', 'hero', 'animation');
    assert.equal(runtime.mock.calls.length, 1);
    assert.deepEqual(navigate.mock.calls, [['animation']]);
    assert.strictEqual(f.controller.resolve(host.token), host.context);
    await f.controller.open(second, 'character', 'hero');
    assert.equal(f.hosts().length, 2);
    assert.equal(runtime.mock.calls.length, 2);
    unbind();
  } finally {
    f.controller.dispose();
  }
  assert.equal(dispose.mock.calls.length, 2);
  f.controller.dispose();
  assert.equal(dispose.mock.calls.length, 2);
});

test('failed initial hosts unblock exports and are removed before a new opening', async () => {
  vi.useFakeTimers();
  const owner = await session();
  const dispose = vi.fn();
  vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({
    definition: owner.workspace.character('hero').definition,
    dispose,
  });
  const f = fixture();
  try {
    await f.controller.open(owner, 'character', 'hero');
    const failed = f.hosts()[0]!;
    assert.isUndefined(owner.workspace.autosaveRevision);
    failed.context.characterLoadFailed();
    assert.isDefined(owner.workspace.autosaveRevision);
    await packages.buildCharacterPackage(owner.workspace.captureCharacter('hero'));
    failed.context.navigate('project');
    assert.isUndefined(f.controller.resolve(failed.token));
    assert.equal(f.hosts().length, 0);
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(dispose.mock.calls.length, 1);
    await f.controller.open(owner, 'character', 'hero');
    assert.notEqual(f.hosts()[0]!.token, failed.token);
  } finally {
    f.controller.dispose();
  }
});

test('teardown releases all scene hosts even if one preview cleanup throws', async () => {
  const owner = await session();
  owner.workspace.createScene({ id: 'one' });
  owner.workspace.createScene({ id: 'two' });
  const f = fixture();
  await f.controller.open(owner, 'scene', 'one');
  const first = f.hosts()[0]!;
  first.context.bindScene(() => {
    throw new Error('Preview cleanup failed');
  });
  await f.controller.open(owner, 'scene', 'two');
  const second = f.hosts()[1]!;
  const release = vi.fn();
  second.context.bindScene(release);
  assert.throws(() => f.controller.dispose(), /Preview cleanup failed/);
  assert.equal(release.mock.calls.length, 1);
  assert.isUndefined(f.controller.resolve(first.token));
  assert.isUndefined(f.controller.resolve(second.token));
});

test('an opening that completes after teardown releases its lease without publishing a host', async () => {
  const owner = await session();
  let finish!: (value: Awaited<ReturnType<typeof packages.openPackageRuntime>>) => void;
  const runtime = vi.spyOn(packages, 'openPackageRuntime').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const f = fixture();
  const opening = f.controller.open(owner, 'character', 'hero');
  const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => assert.equal(runtime.mock.calls.length, 1));
  f.controller.dispose();
  const dispose = vi.fn();
  finish({ definition: owner.workspace.character('hero').definition, dispose });
  await rejected;
  assert.equal(dispose.mock.calls.length, 1);
  assert.equal(f.hosts().length, 0);
});

test('library asset requests reach the original editor once, before or after its animation owner binds', async () => {
  const owner = await session();
  const dispose = vi.fn();
  vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({
    definition: owner.workspace.character('hero').definition,
    dispose,
  });
  const f = fixture();
  try {
    await f.controller.open(owner, 'character', 'hero', 'animation', false, undefined, { name: 'cut', copy: false });
    const host = f.hosts()[0]!;
    const select = vi.fn();
    const release = host.context.bindAnimationSelection!(select);
    assert.deepEqual(select.mock.calls, [['cut', false]]);
    await f.controller.open(owner, 'character', 'hero', 'animation', false, undefined, { name: 'cut', copy: true });
    assert.deepEqual(select.mock.calls, [
      ['cut', false],
      ['cut', true],
    ]);
    assert.equal(f.hosts().length, 1);
    release();
    const next = vi.fn();
    host.context.bindAnimationSelection!(next);
    assert.equal(next.mock.calls.length, 0);
  } finally {
    f.controller.dispose();
  }
  assert.equal(dispose.mock.calls.length, 1);
});

test('generated animation waits for the sole target owner and commits one recoverable document', async () => {
  const owner = await session();
  const snapshot = owner.workspace.captureCharacter('hero');
  vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({ definition: snapshot.definition, dispose: vi.fn() });
  const f = fixture();
  const state = new AnimationEditorState(snapshot.definition.rig);
  const clip = { name: 'retarget-new', duration: 1000, loop: false, tracks: {} };
  const creation = f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig));
  try {
    await vi.waitFor(() => expect(f.hosts()[0]?.pendingCreation).toBeDefined());
    expect(owner.workspace.animationLibrary()).toEqual([]);
    const host = f.hosts()[0]!;
    host.context.bindCharacter(
      () => ({ ...snapshot, animations: state.packageAnimations() }),
      () => false,
      () => {},
    );
    host.context.bindAnimationCreation!((clip) => state.createDerivedAnimation(clip));
    await creation;
    expect(state.selectedAnimationId).toBe(clip.name);
    expect(state.hasUnsavedChanges).toBe(true);
    expect(owner.workspace.animationLibrary()[0]!.clip).toEqual({ ...clip, version: 1 });
    expect(host.pendingCreation).toBeUndefined();
    await expect(
      f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig)),
    ).rejects.toThrow(/Could not create/);
    expect(state.animationIds).toEqual([clip.name]);
    expect(f.activate).toHaveBeenLastCalledWith(undefined);
  } finally {
    f.controller.dispose();
    owner.autosave.dispose();
  }
});

test('failed target loading, stale revisions and disposal reject creation before registration', async () => {
  const owner = await session();
  const snapshot = owner.workspace.captureCharacter('hero');
  vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({ definition: snapshot.definition, dispose: vi.fn() });
  const f = fixture();
  const clip = { name: 'retarget-new', duration: 1000, loop: false, tracks: {} };
  const creation = f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig));
  const failed = expect(creation).rejects.toThrow(/failed to load/);
  await vi.waitFor(() => expect(f.hosts()[0]?.pendingCreation).toBeDefined());
  f.hosts()[0]!.context.characterLoadFailed();
  await failed;
  expect(f.hosts()).toHaveLength(0);
  await f.controller.open(owner, 'character', 'hero', 'animation');
  const host = f.hosts()[0]!;
  const create = vi.fn(() => true);
  host.context.bindCharacter(
    () => snapshot,
    () => false,
    () => {},
  );
  host.context.bindAnimationCreation!(create);
  await expect(f.controller.createAnimation(owner, 'hero', clip, `rig-v1:${'0'.repeat(64)}`)).rejects.toThrow(
    /Target rig changed/,
  );
  expect(create).not.toHaveBeenCalled();
  const unbind = host.context.bindAnimationCreation!(create);
  unbind();
  const pending = f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig));
  const disposed = expect(pending).rejects.toThrow(/closed/);
  await vi.waitFor(() => expect(host.pendingCreation).toBeDefined());
  f.controller.dispose();
  await disposed;
  expect(owner.workspace.animationLibrary()).toEqual([]);
  owner.autosave.dispose();
});
