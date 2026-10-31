import { afterEach, expect, test, vi } from 'vitest';
import { characterFileFetcher, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import { buildCharacterDraft } from '../src/devtools/shared/autosave/editorDrafts.js';
import { buildProjectDraft, draftImages } from '../src/devtools/shared/autosave/projectDrafts.js';
import {
  buildCharacterPackage,
  CharacterDraftSerializer,
  loadPackageDefinition,
  packageJson,
  type PackageSnapshot,
} from '../src/devtools/shared/package/characterPackage.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import * as imageDecoding from '../src/engine/decodeImage.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const { documents } = artworkFixture();
  const files = new Map(
    Object.entries(documents).map(([path, data]) => [
      path,
      data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(JSON.stringify(data)),
    ]),
  );
  const definition = await loadPackageDefinition(files);
  const snapshot: PackageSnapshot = {
    definition,
    rig: structuredClone(definition.rigFile!),
    skins: definition.standaloneSkins,
    animations: definition.animations,
    replacements: [],
  };
  return { files, snapshot, fetcher: vi.fn(characterFileFetcher(files)) };
}

function browserDecoder() {
  vi.stubGlobal('Image', class {});
  const dispose = vi.fn();
  const decode = vi.spyOn(imageDecoding, 'decodeImage').mockImplementation(async (bytes) => ({
    width: 1,
    height: 1,
    format: 'image/png' as const,
    image: {} as HTMLImageElement,
    url: 'blob:draft',
    blob: new Blob([bytes]),
    dispose,
  }));
  return { decode, dispose };
}

test('unchanged character revisions reuse files; rig edits reuse artwork and frozen animation bytes', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  const { decode, dispose } = browserDecoder();
  const validate = vi.spyOn(CharacterDefinition, 'fromData');
  const load = vi.spyOn(CharacterLoader, 'load');
  const first = await serializer.build(f.snapshot, f.fetcher);
  expect(await serializer.build(f.snapshot, f.fetcher)).toBe(first);
  f.snapshot.rig.bones[0]!.x = 20;
  const second = await serializer.build(f.snapshot, f.fetcher);
  expect(packageJson(second, 'rig.json')).toMatchObject({ bones: [{ id: 'root', x: 20 }] });
  expect(second.get('rig.json')).not.toBe(first.get('rig.json'));
  expect(second.get('animations/wave.json')).toBe(first.get('animations/wave.json'));
  expect(second.get('images/paper.png')).toBe(first.get('images/paper.png'));
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(load).not.toHaveBeenCalled();
  // A complete export still runs its own checks and decodes, independent of the draft cache.
  await buildCharacterPackage(f.snapshot, f.fetcher);
  expect(validate).toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(2);
});

test('replacement binaries are cached by Blob identity and Undo restores the source asset', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  const original = await serializer.build(f.snapshot, f.fetcher);
  const blob = new Blob([f.files.get('images/paper.png')!]);
  const read = vi.spyOn(blob, 'arrayBuffer');
  const replacement = {
    assetKey: 'paper',
    reference: undefined,
    blob,
    format: 'image/png' as const,
    originScaleX: 1,
    originScaleY: 1,
  };
  const input = { ...f.snapshot, replacements: [replacement] };
  const first = await serializer.build(input, f.fetcher);
  input.rig.bones[0]!.x = 30;
  const second = await serializer.build(input, f.fetcher);
  expect(second.get('images/paper_replacement.png')).toBe(first.get('images/paper_replacement.png'));
  expect(read).toHaveBeenCalledTimes(1);
  const changed = await serializer.build(
    { ...input, replacements: [{ ...replacement, blob: new Blob([blob]) }] },
    f.fetcher,
  );
  expect(changed.get('images/paper_replacement.png')).not.toBe(first.get('images/paper_replacement.png'));
  const undone = await serializer.build(f.snapshot, f.fetcher);
  expect(undone.get('images/paper.png')).toBe(original.get('images/paper.png'));
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

test('failed and cancelled asset reads are retried without caching partial revisions', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  f.fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(serializer.build(f.snapshot, f.fetcher)).rejects.toThrow(/Could not include image/);
  const request = new AbortController();
  const fetcher: typeof fetch = async (input, options) => {
    const response = await f.fetcher(input, options);
    request.abort(new Error('cancelled'));
    return response;
  };
  await expect(serializer.build(f.snapshot, fetcher, request.signal)).rejects.toThrow(/cancelled/);
  await expect(serializer.build(f.snapshot, f.fetcher)).resolves.toBeDefined();
  expect(f.fetcher).toHaveBeenCalledTimes(3);
});

test('mutable callers are captured before asset I/O and their later changes invalidate the revision', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  const snapshot = structuredClone({ rig: f.snapshot.rig, skins: f.snapshot.skins, animations: f.snapshot.animations });
  const input = { ...f.snapshot, ...snapshot };
  const pending = serializer.build(input, f.fetcher);
  input.rig.bones[0]!.x = 80;
  input.animations[0]!.duration = 2000;
  const first = await pending;
  expect(packageJson(first, 'rig.json')).not.toMatchObject({ bones: [{ x: 80 }] });
  expect(packageJson(first, 'animations/wave.json')).toMatchObject({ duration: 1000 });
  const second = await serializer.build(input, f.fetcher);
  expect(packageJson(second, 'animations/wave.json')).toMatchObject({ duration: 2000 });
});

test('project metadata and scene edits reuse character documents and validated assets without export inspection', async () => {
  const f = await fixture();
  const workspace = new ProjectWorkspace('Film', 'film');
  await workspace.addCharacter(f.files);
  const otherFiles = new Map(f.files).set(
    'character.json',
    new TextEncoder().encode(JSON.stringify({ ...f.snapshot.definition.manifest, id: 'friend' })),
  );
  await workspace.addCharacter(otherFiles);
  const entry = workspace.character('hero');
  let rig = structuredClone(entry.definition.rigFile!);
  entry.capture = () => ({ ...f.snapshot, rig });
  workspace.createScene({ id: 'opening', name: 'Opening' });
  workspace.scenes.images.register('../images/floor.png', f.files.get('images/paper.png')!, 'Floor');
  const inspect = vi.spyOn(workspace, 'inspect');
  const capture = vi.spyOn(workspace, 'captureCharacter');
  const read = vi.spyOn(workspace.scenes.images, 'read');
  const { decode } = browserDecoder();
  const first = await buildProjectDraft(workspace);
  workspace.rename('Renamed');
  workspace.scenes.updateProperties({ name: 'Later scene' });
  const second = await buildProjectDraft(workspace);
  const prefix = 'characters/character-1/';
  for (const [path, bytes] of first) if (path.startsWith(prefix)) expect(second.get(path)).toBe(bytes);
  expect(second.get('images/floor.png')).toBe(first.get('images/floor.png'));
  expect(read).toHaveBeenCalledTimes(1);
  expect(inspect.mock.calls).toEqual([['draft'], ['draft']]);
  expect(capture).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
  const pending = buildProjectDraft(workspace);
  workspace.rename('Newer');
  rig = { ...rig, bones: rig.bones.map((bone) => ({ ...bone, x: 70 })) };
  const recovered = await importProjectPackage(await pending);
  expect(recovered.definition.name).toBe('Renamed');
  expect(recovered.scenes.scene('opening')!.name).toBe('Later scene');
  expect(recovered.captureCharacter('hero').rig.bones[0]!.x).toBeUndefined();
  const changedFiles = await buildProjectDraft(workspace);
  for (const [path, bytes] of first)
    if (path.startsWith('characters/character-2/')) expect(changedFiles.get(path)).toBe(bytes);
  const changed = await importProjectPackage(changedFiles);
  expect(changed.captureCharacter('hero').rig.bones[0]!.x).toBe(70);
});

test('draft serialization rejects pending character edits before capture', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  await expect(serializer.build({ ...f.snapshot, pendingArtwork: true }, f.fetcher)).rejects.toThrow(
    /pending|proposal/,
  );
  expect(f.fetcher).not.toHaveBeenCalled();
  const workspace = new ProjectWorkspace('Film');
  await workspace.addCharacter(f.files);
  const entry = workspace.character('hero');
  const capture = vi.fn(() => f.snapshot);
  entry.capture = capture;
  entry.pending = () => true;
  await expect(buildProjectDraft(workspace)).rejects.toThrow(/pending edits/);
  expect(capture).not.toHaveBeenCalled();
  entry.pending = () => false;
  await expect(buildProjectDraft(workspace)).resolves.toBeDefined();
});

test('standalone drafts bypass temporary registration and preserve the recovery layout', async () => {
  const f = await fixture();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(f.fetcher);
  const register = vi.spyOn(ProjectWorkspace.prototype, 'addCharacter');
  const first = await buildCharacterDraft(f.snapshot, 'film');
  f.snapshot.rig.bones[0]!.x = 40;
  const second = await buildCharacterDraft(f.snapshot, 'film');
  expect(register).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second.get('characters/character-1/images/paper.png')).toBe(
    first.get('characters/character-1/images/paper.png'),
  );
  const recovered = await importProjectPackage(second);
  expect(recovered.definition.id).toBe('film');
  expect(recovered.captureCharacter('hero').rig.bones[0]!.x).toBe(40);
});

test('image cache follows registry membership revisions, including removal and reimport at the same path', () => {
  const registry = new SceneImageRegistry();
  const bytes = artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>;
  registry.register('../images/floor.png', bytes);
  const first = draftImages(registry);
  expect(draftImages(registry)).toBe(first);
  registry.removeUnused(new Set());
  expect(draftImages(registry).size).toBe(0);
  const changed = new Uint8Array(bytes);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  registry.register('../images/floor.png', changed);
  expect(draftImages(registry).get('../images/floor.png')).toEqual(changed);
  expect(first.get('../images/floor.png')).toEqual(bytes);
});

test('a new immutable definition invalidates cached files even when authored domains match', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  const first = await serializer.build(f.snapshot, f.fetcher);
  const manifest = { ...f.snapshot.definition.manifest!, id: 'other-hero' };
  const files = new Map(f.files).set('character.json', new TextEncoder().encode(JSON.stringify(manifest)));
  const definition = await loadPackageDefinition(files);
  const second = await serializer.build({ ...f.snapshot, definition, rig: freezeData(f.snapshot.rig) }, f.fetcher);
  expect(second).not.toBe(first);
  expect(packageJson(second, 'character.json')).toMatchObject({ id: 'other-hero' });
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});

test('broken character metadata and scene dependencies cannot replace recoverable draft revisions', async () => {
  const f = await fixture();
  const serializer = new CharacterDraftSerializer();
  const first = await serializer.build(f.snapshot, f.fetcher);
  await expect(serializer.build({ ...f.snapshot, skins: [] }, f.fetcher)).rejects.toThrow(/default skin|defaultSkin/);
  expect(await serializer.build(f.snapshot, f.fetcher)).toBe(first);
  expect(f.fetcher).toHaveBeenCalledTimes(1);

  const workspace = new ProjectWorkspace('Film');
  await workspace.addCharacter(f.files);
  workspace.addScene({
    version: 2,
    id: 'opening',
    name: 'Opening',
    duration: 1000,
    actions: [],
    actors: [
      {
        id: 'hero',
        character: { manifest: workspace.characterReference('hero') },
        position: { x: 0, y: 0 },
        animation: 'wave',
      },
    ],
  });
  await buildProjectDraft(workspace);
  workspace.character('hero').capture = () => ({ ...f.snapshot, animations: [] });
  await expect(buildProjectDraft(workspace)).rejects.toThrow(/Unknown animation/);
  workspace.character('hero').capture = () => f.snapshot;
  await expect(buildProjectDraft(workspace)).resolves.toBeDefined();
});
