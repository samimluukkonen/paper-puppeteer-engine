import { afterEach, assert, expect, test, vi } from 'vitest';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import type { CharacterEditorContext, SceneEditorContext } from '../src/devtools/project/projectBridge.js';
import {
  ProjectEditorHosts,
  type ProjectEditorHost,
  type ProjectSession,
} from '../src/devtools/project/ProjectEditorHosts.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
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
    detachAutosave: () => {},
  };
}

function characterContext(host: ProjectEditorHost): CharacterEditorContext {
  if (host.context.kind !== 'character') throw new Error(`Expected a character host, got ${host.context.kind}.`);
  return host.context;
}

function sceneContext(host: ProjectEditorHost): SceneEditorContext {
  if (host.context.kind !== 'scene') throw new Error(`Expected a scene host, got ${host.context.kind}.`);
  return host.context;
}

function fixture(changed?: (hosts: readonly ProjectEditorHost[]) => void) {
  let hosts: readonly ProjectEditorHost[] = [];
  const activate = vi.fn<(token: string | undefined) => void>();
  const controller = new ProjectEditorHosts({
    baseUrl: 'https://example.test/project/',
    activate,
    changed: (next) => {
      hosts = next;
      changed?.(next);
    },
    validate: () => {},
  });
  return { controller, activate, hosts: () => hosts };
}

test('variant editor requests share the sole owner host and expose shared impact and scene rig identity', async () => {
  const owner = await session();
  owner.workspace.createCharacterVariant('hero', 'Blue Soldier', 'default', 'blue');
  vi.spyOn(packages, 'openPackageRuntime').mockImplementation(async () => ({
    definition: owner.workspace.character('hero').definition,
    dispose() {},
  }));
  const f = fixture();
  try {
    await f.controller.open(owner, 'character', 'blue');
    const host = f.hosts()[0]!;
    assert.equal(host.asset, 'hero');
    assert.strictEqual(characterContext(host).characterDocuments, owner.workspace.characterDocuments('hero'));
    assert.include(characterContext(host).sharedRigNotice!, 'Blue Soldier');
    assert.include(characterContext(host).sharedRigNotice!, 'independent character copy');
    characterContext(host).bindCharacter(
      () => false,
      () => {},
    );
    await f.controller.open(owner, 'character', 'hero', 'animation');
    assert.lengthOf(f.hosts(), 1);
    assert.isUndefined(owner.workspace.character('blue').documents);
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
});

test('renderer cache suspends inactive hosts and evicts LRU renderers without losing documents or history', async () => {
  const sessions: ProjectSession[] = [];
  for (let index = 0; index < 6; index++) sessions.push(await session());
  const releases: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(packages, 'openPackageRuntime').mockImplementation(async () => {
    const dispose = vi.fn();
    releases.push(dispose);
    return { definition: sessions[0]!.workspace.character('hero').definition, dispose };
  });
  const f = fixture();
  const renderers = [];
  const tokens: string[] = [];
  try {
    for (const owner of sessions) {
      await f.controller.open(owner, 'character', 'hero');
      const host = f.hosts().find((entry) => entry.session === owner)!;
      tokens.push(host.token);
      const document = characterContext(host).characterDocuments;
      document.rig.editBone('root', 'x', 42);
      expect(
        document.animation.createDerivedAnimation({ name: 'draft', duration: 1000, loop: false, tracks: {} }),
      ).toBe(true);
      expect(document.animation.setAuthoredPlaybackMode('stepped')).toBe(true);
      const unbind = characterContext(host).bindCharacter(
        () => false,
        () => {},
      );
      const renderer = { activate: vi.fn(), suspend: vi.fn(), dispose: vi.fn(() => unbind()) };
      host.context.bindRenderer(renderer);
      renderers.push(renderer);
      host.context.navigate('project');
      expect(renderer.suspend).toHaveBeenCalledOnce();
      expect(f.hosts().length).toBeLessThanOrEqual(ProjectEditorHosts.rendererLimit);
      expect(owner.workspace.characterDraft('hero').rig.bones[0]!.x).toBe(42);
    }
    expect(releases.filter((release) => release.mock.calls.length)).toHaveLength(4);
    expect(f.controller.resolve(tokens[0]!)).toBeUndefined();
    expect(renderers[0]!.dispose).toHaveBeenCalledOnce();
    const owner = sessions[0]!;
    const document = owner.workspace.characterDocuments('hero');
    expect(owner.workspace.animationLibrary()[0]!.clip.name).toBe('draft');
    expect(owner.workspace.characterDirty('hero')).toBe(true);
    await f.controller.open(owner, 'character', 'hero', 'animation');
    const reopened = f.hosts().find((host) => host.session === owner)!;
    expect(reopened.token).not.toBe(tokens[0]);
    expect(characterContext(reopened).characterDocuments).toBe(document);
    characterContext(reopened).bindCharacter(
      () => false,
      () => {},
    );
    expect(document.animation.undo()).toBe(true);
    expect(document.animation.isNewAnimation()).toBe(true);
    expect(document.rig.undo()).toBe(true);
    expect(owner.workspace.characterDraft('hero').rig.bones[0]!.x ?? 0).toBe(0);
  } finally {
    f.controller.dispose();
    for (const owner of sessions) {
      owner.workspace.disposeCharacterDocuments();
      owner.autosave.dispose();
    }
  }
  expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
});

test('temporary edits pin suspended hosts without letting the renderer cache grow', async () => {
  const owners = [await session(), await session(), await session()];
  vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({
    definition: owners[0]!.workspace.character('hero').definition,
    dispose: vi.fn(),
  });
  const f = fixture();
  let pending = true;
  try {
    for (const owner of owners.slice(0, 2)) {
      await f.controller.open(owner, 'character', 'hero');
      const host = f.hosts().find((entry) => entry.session === owner)!;
      characterContext(host).bindCharacter(
        () => pending,
        () => {},
      );
      host.context.navigate('project');
    }
    await expect(f.controller.open(owners[2]!, 'character', 'hero')).rejects.toThrow(/Finish temporary edits/);
    expect(f.hosts()).toHaveLength(2);
    await f.controller.open(owners[0]!, 'character', 'hero');
    const resumed = f.hosts().find((host) => host.session === owners[0])!;
    expect(resumed.active).toBe(true);
    resumed.context.navigate('project');
    pending = false;
    await f.controller.open(owners[2]!, 'character', 'hero');
    expect(f.hosts()).toHaveLength(2);
  } finally {
    f.controller.dispose();
  }
});

test('reusing a collected character ID replaces its cached renderer and document context', async () => {
  const owner = await session();
  const files = owner.workspace.character('hero').files;
  const release = vi.fn();
  vi.spyOn(packages, 'openPackageRuntime').mockImplementation(async () => ({
    definition: owner.workspace.character('hero').definition,
    dispose: release,
  }));
  const f = fixture();
  try {
    await f.controller.open(owner, 'character', 'hero');
    const previous = f.hosts()[0]!;
    const documents = characterContext(previous).characterDocuments;
    documents.rig.editBone('root', 'x', 42);
    const unbind = characterContext(previous).bindCharacter(
      () => false,
      () => {},
    );
    const dispose = vi.fn(unbind);
    previous.context.bindRenderer({ activate: () => {}, suspend: () => {}, dispose });
    previous.context.navigate('project');
    owner.workspace.remove('characters', 'hero');
    for (let index = 0; index < 105; index++) owner.workspace.rename(`Film ${index}`);
    await owner.workspace.addCharacter(files);
    await f.controller.open(owner, 'character', 'hero');
    const current = f.hosts()[0]!;
    expect(current.token).not.toBe(previous.token);
    expect(characterContext(current).characterDocuments).toBe(owner.workspace.characterDocuments('hero'));
    expect(characterContext(current).characterDocuments).not.toBe(documents);
    expect(characterContext(current).characterDocuments.rig.recoveryDraft.bones[0]!.x ?? 0).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(f.controller.resolve(previous.token)).toBeUndefined();
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
});

test('concurrent opens share one renderer and reactivate the retained host', async () => {
  const owner = await session();
  let finish!: (value: Awaited<ReturnType<typeof packages.openPackageRuntime>>) => void;
  const runtime = vi.spyOn(packages, 'openPackageRuntime').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const navigate = vi.fn();
  const f = fixture((hosts) => {
    characterContext(hosts[0]!).bindCharacter(() => false, navigate);
  });
  try {
    const first = f.controller.open(owner, 'character', 'hero');
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledOnce());
    const second = f.controller.open(owner, 'character', 'hero', 'animation', true, 'animation-guide', {
      name: 'walk',
      copy: true,
    });
    expect(f.hosts()).toHaveLength(0);
    const dispose = vi.fn();
    finish({ definition: owner.workspace.character('hero').definition, dispose });
    await Promise.all([first, second]);
    expect(f.hosts()).toHaveLength(1);
    expect(runtime).toHaveBeenCalledOnce();
    const host = f.hosts()[0]!;
    expect(navigate).toHaveBeenCalledExactlyOnceWith('animation');
    const guide = vi.fn();
    const select = vi.fn();
    host.context.bindGuide(guide);
    characterContext(host).bindAnimationSelection(select);
    expect(guide).toHaveBeenCalledExactlyOnceWith('animation-guide');
    expect(select).toHaveBeenCalledExactlyOnceWith('walk', true);
    expect(owner.workspace.character('hero').capture).toBe(characterContext(host).characterDocuments.capture);
    const renderer = { activate: vi.fn(), suspend: vi.fn(), dispose: vi.fn() };
    host.context.bindRenderer(renderer);
    host.context.navigate('project');
    await f.controller.open(owner, 'character', 'hero');
    expect(renderer.activate).toHaveBeenCalledTimes(2);
    expect(renderer.suspend).toHaveBeenCalledOnce();
    f.controller.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
});

test('concurrent opening failures are shared and a later request can retry', async () => {
  const owner = await session();
  let fail!: (error: Error) => void;
  const runtime = vi
    .spyOn(packages, 'openPackageRuntime')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue({ definition: owner.workspace.character('hero').definition, dispose: vi.fn() });
  const f = fixture();
  try {
    const first = f.controller.open(owner, 'character', 'hero');
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledOnce());
    const second = f.controller.open(owner, 'character', 'hero');
    const error = new Error('Package preparation failed.');
    const rejected = Promise.all([expect(first).rejects.toBe(error), expect(second).rejects.toBe(error)]);
    fail(error);
    await rejected;
    expect(f.hosts()).toHaveLength(0);
    expect(runtime).toHaveBeenCalledOnce();
    await f.controller.open(owner, 'character', 'hero');
    expect(f.hosts()).toHaveLength(1);
    expect(runtime).toHaveBeenCalledTimes(2);
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
});

test.each(['session', 'asset', 'kind'] as const)(
  'openings with a different %s remain independent',
  async (difference) => {
    const owner = await session();
    const other = difference === 'session' ? await session() : owner;
    owner.workspace.createScene({ id: 'hero' });
    if (difference === 'asset') owner.workspace.createScene({ id: 'other' });
    if (other !== owner) other.workspace.createScene({ id: 'hero' });
    vi.spyOn(packages, 'openPackageRuntime').mockResolvedValue({
      definition: owner.workspace.character('hero').definition,
      dispose: vi.fn(),
    });
    const f = fixture();
    try {
      const first = f.controller.open(owner, 'scene', 'hero');
      const second = f.controller.open(
        other,
        difference === 'kind' ? 'character' : 'scene',
        difference === 'asset' ? 'other' : 'hero',
      );
      expect(second).not.toBe(first);
      await Promise.all([first, second]);
      expect(f.hosts()).toHaveLength(2);
      expect(f.hosts()[1]).toMatchObject({
        session: other,
        kind: difference === 'kind' ? 'character' : 'scene',
        asset: difference === 'asset' ? 'other' : 'hero',
      });
    } finally {
      f.controller.dispose();
      for (const entry of new Set([owner, other])) {
        entry.workspace.disposeCharacterDocuments();
        entry.autosave.dispose();
      }
    }
  },
);

test('interleaved duplicate requests preserve the latest requested host activation', async () => {
  const owner = await session();
  owner.workspace.createScene({ id: 'one' });
  owner.workspace.createScene({ id: 'two' });
  const f = fixture();
  try {
    await Promise.all([
      f.controller.open(owner, 'scene', 'one'),
      f.controller.open(owner, 'scene', 'two'),
      f.controller.open(owner, 'scene', 'one'),
    ]);
    expect(f.hosts()).toHaveLength(2);
    const latest = f.hosts().find((host) => host.asset === 'one')!;
    expect(latest.active).toBe(true);
    expect(f.activate).toHaveBeenLastCalledWith(latest.token);
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
});

test('closing a scene aborts and releases late character preview leases', async () => {
  const owner = await session();
  owner.workspace.createScene({ id: 'scene' });
  let finish!: (value: Awaited<ReturnType<typeof packages.openPackageRuntime>>) => void;
  const runtime = vi.spyOn(packages, 'openPackageRuntime').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const f = fixture();
  try {
    await f.controller.open(owner, 'scene', 'scene');
    const host = f.hosts()[0]!;
    const loading = sceneContext(host).loadCharacter(owner.workspace.characterReference('hero'));
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledOnce());
    host.context.navigate('project');
    expect(runtime.mock.calls[0]![1].aborted).toBe(true);
    const dispose = vi.fn();
    finish({ definition: owner.workspace.character('hero').definition, dispose });
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    expect(f.hosts()).toHaveLength(0);
  } finally {
    f.controller.dispose();
  }
});

test('character hosts retain one owner across view changes and release independent project leases', async () => {
  const first = await session();
  const second = await session();
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
    const unbind = characterContext(host).bindCharacter(() => false, navigate);
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
    characterContext(failed).characterLoadFailed();
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
  sceneContext(first).bindScene(() => {
    throw new Error('Preview cleanup failed');
  });
  await f.controller.open(owner, 'scene', 'two');
  const second = f.hosts()[1]!;
  const release = vi.fn();
  sceneContext(second).bindScene(release);
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
  const duplicate = f.controller.open(owner, 'character', 'hero');
  const duplicateRejected = expect(duplicate).rejects.toMatchObject({ name: 'AbortError' });
  f.controller.dispose();
  const dispose = vi.fn();
  finish({ definition: owner.workspace.character('hero').definition, dispose });
  await rejected;
  await duplicateRejected;
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
    const release = characterContext(host).bindAnimationSelection(select);
    assert.deepEqual(select.mock.calls, [['cut', false]]);
    await f.controller.open(owner, 'character', 'hero', 'animation', false, undefined, { name: 'cut', copy: true });
    assert.deepEqual(select.mock.calls, [
      ['cut', false],
      ['cut', true],
    ]);
    assert.equal(f.hosts().length, 1);
    release();
    const next = vi.fn();
    characterContext(host).bindAnimationSelection(next);
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
  const state = owner.workspace.characterDocuments('hero').animation;
  const clip = { name: 'retarget-new', duration: 1000, loop: false, tracks: {} };
  const creation = f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig));
  try {
    await vi.waitFor(() => expect(f.hosts()[0]?.pendingCreation).toBeDefined());
    expect(owner.workspace.animationLibrary()).toEqual([]);
    const host = f.hosts()[0]!;
    characterContext(host).bindCharacter(
      () => false,
      () => {},
    );
    characterContext(host).bindAnimationCreation((clip) => state.createDerivedAnimation(clip));
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
  characterContext(f.hosts()[0]!).characterLoadFailed();
  await failed;
  expect(f.hosts()).toHaveLength(0);
  await f.controller.open(owner, 'character', 'hero', 'animation');
  const host = f.hosts()[0]!;
  const create = vi.fn(() => true);
  characterContext(host).bindCharacter(
    () => false,
    () => {},
  );
  characterContext(host).bindAnimationCreation(create);
  await expect(f.controller.createAnimation(owner, 'hero', clip, `rig-v1:${'0'.repeat(64)}`)).rejects.toThrow(
    /Target rig changed/,
  );
  expect(create).not.toHaveBeenCalled();
  const unbind = characterContext(host).bindAnimationCreation(create);
  unbind();
  const pending = f.controller.createAnimation(owner, 'hero', clip, rigCompatibilityRevision(snapshot.rig));
  const disposed = expect(pending).rejects.toThrow(/closed/);
  await vi.waitFor(() => expect(host.pendingCreation).toBeDefined());
  f.controller.dispose();
  await disposed;
  expect(owner.workspace.animationLibrary()).toEqual([]);
  owner.autosave.dispose();
});

test('scene stage and detached preview renderers suspend together and release independently', async () => {
  const owner = await session();
  owner.workspace.createScene({ id: 'reuse-preview' });
  owner.workspace.createScene({ id: 'another-scene' });
  const f = fixture();
  const stage = { activate: vi.fn(), suspend: vi.fn(), dispose: vi.fn() };
  const preview = { activate: vi.fn(), suspend: vi.fn(), dispose: vi.fn() };
  try {
    await f.controller.open(owner, 'scene', 'reuse-preview');
    const host = f.hosts()[0]!;
    host.context.bindRenderer(stage);
    const releasePreview = host.context.bindRenderer(preview);
    await f.controller.open(owner, 'scene', 'another-scene');
    expect(stage.suspend).toHaveBeenCalledOnce();
    expect(preview.suspend).toHaveBeenCalledOnce();
    releasePreview();
    const previous = stage.activate.mock.calls.length;
    await f.controller.open(owner, 'scene', 'reuse-preview');
    expect(stage.activate.mock.calls.length).toBe(previous + 1);
    expect(preview.activate).toHaveBeenCalledOnce();
  } finally {
    f.controller.dispose();
    owner.workspace.disposeCharacterDocuments();
    owner.autosave.dispose();
  }
  expect(stage.dispose).toHaveBeenCalledOnce();
  expect(preview.dispose).not.toHaveBeenCalled();
});
