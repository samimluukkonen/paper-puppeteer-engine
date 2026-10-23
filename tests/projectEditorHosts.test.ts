import { afterEach, assert, expect, test, vi } from 'vitest';
import {
  ProjectEditorHosts,
  type ProjectEditorHost,
  type ProjectSession,
} from '../src/devtools/project/ProjectEditorHosts.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import * as packages from '../src/devtools/shared/package/characterPackage.js';

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
