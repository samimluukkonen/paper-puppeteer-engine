import { readFileSync } from 'node:fs';
import { afterEach, assert, expect, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { createNewCharacter } from '../src/devtools/shared/newCharacter.js';
import {
  buildCharacterPackage,
  capturePackage,
  loadPackageDefinition,
  openPackageRuntime,
  packageJson,
  type PackageSnapshot,
  validatePackage,
} from '../src/devtools/shared/package/characterPackage.js';
import { PackageController } from '../src/devtools/shared/package/PackageController.js';
import { decodePackageZip, encodePackageZip, packagePath } from '../src/devtools/shared/package/packageZip.js';
import { processPackageZip } from '../src/devtools/shared/package/packageZipTasks.js';
import type { PackageZipProcessor } from '../src/devtools/shared/package/packageZipWorkerClient.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { type AnimationClip, commitIKBake, generateBakedBoneKeys, sampleIKBake } from '../src/engine/core.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { characterManifestSchema } from '../src/engine/schemas.js';
import { downloadBlob } from '../src/shared/downloadJson.js';
import { demoCharacter } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('../src/shared/downloadJson.js', () => ({ downloadBlob: vi.fn() }));
vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(downloadBlob).mockReset();
});
async function rejected(promise: Promise<unknown>, pattern?: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

test('pending proposals block export while committed domain indicators continue to update', async () => {
  let snapshot = fixture();
  const controller = new PackageController();
  controller.bind(() => snapshot);
  snapshot = {
    ...snapshot,
    pendingArtwork: true,
    rig: {
      ...snapshot.rig,
      bones: snapshot.rig.bones.map((bone, index) => (index === 0 ? { ...bone, x: 123 } : bone)),
    },
  };
  controller.refresh();
  assert.deepEqual(controller.getSnapshot().modified, ['Rig']);
  assert.throws(() => capturePackage(snapshot), /Apply or cancel/);
  await controller.download();
  assert.match(controller.getSnapshot().message, /Apply or cancel/);
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 0);
  assert.deepEqual(controller.getSnapshot().modified, ['Rig']);
  controller.dispose();
});
const png = new Uint8Array(
  readFileSync(new URL('../public/characters/demo-puppet/images/paper-head.png', import.meta.url)),
);
const fetchImage: typeof fetch = () => Promise.resolve(new Response(png));

test.each(['first', 'second'])('replacing aliased texture %s exports independent image files', async (assetKey) => {
  const definition = CharacterDefinition.fromData(
    {
      manifest: {
        version: 1,
        id: 'aliased-artwork',
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        animations: [],
        textures: { first: 'images/shared.png', second: 'images/shared.png' },
      },
      rig: {
        version: 1,
        root: 'root',
        bones: [
          { id: 'root', sprite: { texture: 'first' } },
          { id: 'child', parent: 'root', sprite: { texture: 'second' } },
        ],
      },
      skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    },
    'https://source.invalid/character.json',
  );
  const replacement = new Uint8Array(
    readFileSync(new URL('../public/characters/demo-puppet/images/paper-torso.png', import.meta.url)),
  );
  const files = decodePackageZip(
    encodePackageZip(
      await buildCharacterPackage(
        {
          definition,
          rig: structuredClone(definition.rigFile!),
          skins: definition.standaloneSkins,
          animations: definition.animations,
          replacements: [
            {
              assetKey,
              reference: undefined,
              blob: new Blob([replacement]),
              format: 'image/png',
              originScaleX: 1,
              originScaleY: 1,
            },
          ],
        },
        fetchImage,
      ),
    ),
  );
  const exported = await validatePackage(files);
  const otherKey = assetKey === 'first' ? 'second' : 'first';
  assert.notEqual(exported.textures[assetKey], exported.textures[otherKey]);
  assert.deepEqual(files.get(exported.textures[assetKey]!), replacement);
  assert.equal(exported.textures[otherKey], 'images/shared.png');
  assert.deepEqual(files.get('images/shared.png'), png);
  assert.deepEqual(definition.textures, { first: 'images/shared.png', second: 'images/shared.png' });
});
const zipProcessor: PackageZipProcessor = {
  async encode(files, signal) {
    signal.throwIfAborted();
    const result = processPackageZip({ operation: 'encode', files });
    if (result.operation !== 'encode') throw new Error('Unexpected test ZIP result.');
    return result;
  },
  async decode(bytes, signal) {
    signal.throwIfAborted();
    return processPackageZip({ operation: 'decode', bytes }).files;
  },
};

test('new-character package checkpoints only clear after a successful complete download', async () => {
  const draft = createNewCharacter({ name: 'Fresh', id: 'fresh' });
  const snapshot = {
    definition: draft.definition,
    rig: draft.rig.recoveryDraft,
    skins: draft.rig.standaloneSkins,
    animations: [],
    replacements: [],
  };
  const controller = new PackageController(zipProcessor);
  controller.bind(() => snapshot, true);
  vi.mocked(downloadBlob).mockImplementationOnce(() => {
    throw new Error('Download blocked');
  });
  await controller.download();
  assert.isTrue(controller.hasUnsavedCharacter);
  assert.match(controller.getSnapshot().message, /Download blocked/);
  await controller.download();
  assert.isFalse(controller.hasUnsavedCharacter);
  assert.isFalse(controller.hasUnsavedChanges);
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 2);
  controller.dispose();
});

test('new artwork library images export through the existing manifest without source textures or dummy references', async () => {
  const draft = createNewCharacter({ name: 'Fresh', id: 'fresh' });
  const files = await buildCharacterPackage({
    definition: draft.definition,
    rig: draft.rig.recoveryDraft,
    skins: draft.rig.standaloneSkins,
    animations: [],
    replacements: [
      {
        assetKey: 'first-image',
        reference: undefined,
        blob: new Blob([png]),
        format: 'image/png',
        originScaleX: 1,
        originScaleY: 1,
        newAsset: true,
      },
    ],
  });
  const loaded = await loadPackageDefinition(files);
  assert.deepEqual(loaded.textures, { 'first-image': 'images/first-image.png' });
  assert.deepEqual(files.get('images/first-image.png'), png);
  assert.deepEqual(loaded.rig.bones, [{ id: 'root' }]);
  assert.deepEqual(draft.definition.textures, {});
});
const manifest = {
  version: 1,
  id: 'test',
  rig: 'rigs/body.json',
  defaultSkin: 'default',
  skins: { default: 'skins/base.json', alternate: 'skins/other.json' },
  animations: ['animations/move.json'],
  poses: ['poses/ready.json'],
  textures: { shared: 'images/part.png' },
};
function fixture(): PackageSnapshot {
  const definition = CharacterDefinition.fromData(
    {
      manifest,
      rig: {
        version: 1,
        root: 'root',
        bones: [
          { id: 'root', sprite: { texture: 'shared', x: 3, originX: 0.2, originY: 0.8, depth: 4 } },
          { id: 'child', parent: 'root', x: 20, y: 30 },
        ],
        slots: [{ id: 'slot', bone: 'child', depth: 7 }],
        attachments: [{ id: 'part', texture: 'shared', originX: 0.75, originY: 0.8, rotation: 0.3, scaleX: -2 }],
      },
      skins: {
        'skins/base.json': { version: 1, name: 'default', slots: { slot: 'part' } },
        'skins/other.json': { version: 1, name: 'alternate', slots: { slot: null } },
      },
      animations: {
        'animations/move.json': {
          version: 1,
          name: 'move',
          duration: 1000,
          loop: true,
          playback: { mode: 'stepped', fps: 12 },
          tracks: {
            child: [
              { time: 0, rotation: 0.3 },
              { time: 1000, rotation: -0.7 },
            ],
          },
          events: [{ time: 500, name: 'hit', data: { value: [1, null, true] } }],
        },
      },
      poses: { 'poses/ready.json': { version: 1, name: 'ready', bones: { child: { rotation: 0.2 } } } },
    },
    'https://source.invalid/character.json',
  );
  return {
    definition,
    rig: structuredClone(definition.rigFile!),
    skins: definition.standaloneSkins,
    animations: definition.animations,
    replacements: [],
  };
}

test('new session clips join existing manifest clips without changing source paths, artwork or animations', async () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const state = new AnimationEditorState(source.definition.rig, source.animations, {
    animationPaths: source.definition.animationPaths,
  });
  state.selectAnimation('move');
  assert.isTrue(state.createAnimation({ name: 'idle' }));
  assert.isTrue(state.createAnimation({ name: 'MOVE' }));
  const files = await buildCharacterPackage({ ...source, animations: state.packageAnimations() }, fetchImage);
  const loaded = await loadPackageDefinition(files);
  assert.deepEqual(loaded.manifest!.animations, [
    'animations/move.json',
    'animations/idle.json',
    'animations/MOVE_2.json',
  ]);
  assert.deepEqual(loaded.animations[0], source.animations[0]);
  assert.deepEqual(files.get('images/part.png'), png);
  assert.equal(JSON.stringify(source), before);
});

test('complete ZIP includes metadata and exact binaries and reloads with CharacterLoader', async () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const files = await buildCharacterPackage(source, fetchImage);
  const archive = encodePackageZip(files);
  const reloaded = await loadPackageDefinition(decodePackageZip(archive));
  assert.deepEqual(reloaded.manifest, source.definition.manifest);
  assert.deepEqual(reloaded.rigFile, source.rig);
  assert.deepEqual(reloaded.animations, source.animations);
  assert.deepEqual(reloaded.poses, source.definition.poses);
  assert.deepEqual(
    Object.fromEntries(reloaded.standaloneSkins.map((skin) => [skin.name, skin])),
    Object.fromEntries(source.skins.map((skin) => [skin.name, skin])),
  );
  assert.deepEqual(files.get('images/part.png'), png);
  assert.equal(files.size, 7);
  assert.equal(JSON.stringify(source), before);
  assert.notInclude(new TextDecoder().decode(files.get('character.json')), 'blob:');
  const repeated = await buildCharacterPackage(
    {
      definition: reloaded,
      rig: structuredClone(reloaded.rigFile!),
      skins: reloaded.standaloneSkins,
      animations: reloaded.animations,
      replacements: [],
    },
    fetchImage,
  );
  for (const [path, bytes] of files) assert.deepEqual(repeated.get(path), bytes, path);
});

test.each(['constructor', 'toString', 'hasOwnProperty'])(
  'new clips and skins named %s export and retain their paths after reloading',
  async (name) => {
    const source = fixture();
    const files = await buildCharacterPackage(
      {
        ...source,
        skins: [...source.skins, { version: 1, name, slots: { slot: 'part' } }],
        animations: [...source.animations, { name, duration: 1000, loop: true, tracks: {} }],
      },
      fetchImage,
    );
    const definition = await loadPackageDefinition(decodePackageZip(encodePackageZip(files)));
    assert.equal(definition.animationPaths[name], `animations/${name}.json`);
    assert.equal(definition.manifest!.skins[name], `skins/${name}.json`);
    const reexported = await buildCharacterPackage(
      {
        definition,
        rig: structuredClone(definition.rigFile!),
        skins: definition.standaloneSkins,
        animations: definition.animations,
        replacements: [],
      },
      fetchImage,
    );
    assert.deepEqual((await loadPackageDefinition(reexported)).manifest, definition.manifest);
  },
);

test('generated paths disambiguate sanitized, case-folded and source filename collisions deterministically', async () => {
  const source = fixture();
  const names = ['walk 2', 'walk_2', 'walk_2_2', 'Walk', 'walk', 'käsi', 'k_si', 'MOVE'];
  const snapshot = {
    ...source,
    skins: [...source.skins, ...['base', 'base?', 'BASE'].map((name) => ({ version: 1 as const, name, slots: {} }))],
    // Put generated names before source clips to exercise reservations independent of insertion order.
    animations: [...names.map((name) => ({ name, duration: 1000, loop: true, tracks: {} })), ...source.animations],
  };
  const files = await buildCharacterPackage(snapshot, fetchImage);
  const repeated = await buildCharacterPackage(snapshot, fetchImage);
  assert.deepEqual([...files.keys()], [...repeated.keys()]);
  const definition = await loadPackageDefinition(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual(
    definition.animations.map((clip) => clip.name),
    [...names, 'move'],
  );
  assert.equal(definition.animationPaths.move, 'animations/move.json');
  assert.equal(definition.manifest!.skins.default, 'skins/base.json');
  assert.equal(definition.animationPaths['walk 2'], 'animations/walk_2.json');
  assert.equal(definition.animationPaths.walk_2, 'animations/walk_2_2.json');
  assert.equal(definition.animationPaths.walk_2_2, 'animations/walk_2_2_2.json');
  assert.equal(new Set([...files.keys()].map((path) => path.toLowerCase())).size, files.size);
  assert.deepEqual(
    Object.fromEntries(definition.standaloneSkins.map((skin) => [skin.name, skin])),
    Object.fromEntries(snapshot.skins.map((skin) => [skin.name, skin])),
  );
});

test('individual artwork paths avoid existing metadata and other generated image paths', async () => {
  const source = fixture();
  const files = await buildCharacterPackage(source, fetchImage);
  const rigPath = 'images/shared_replacement_1.png';
  const definition = CharacterDefinition.fromData({
    manifest: { ...source.definition.manifest!, rig: rigPath },
    rig: source.rig,
    skins: Object.fromEntries(Object.values(manifest.skins).map((path) => [path, packageJson(files, path)])),
    animations: Object.fromEntries(manifest.animations.map((path) => [path, packageJson(files, path)])),
    poses: Object.fromEntries(manifest.poses.map((path) => [path, packageJson(files, path)])),
  });
  const output = await buildCharacterPackage(
    {
      ...source,
      definition,
      replacements: [
        {
          assetKey: 'shared',
          reference: 'attachment:part',
          blob: new Blob([png]),
          format: 'image/png',
          originScaleX: 1,
          originScaleY: 1,
        },
      ],
    },
    fetchImage,
  );
  const reloaded = await loadPackageDefinition(decodePackageZip(encodePackageZip(output)));
  assert.equal(reloaded.rigPath, rigPath);
  assert.equal(reloaded.textures.shared_replacement_1, 'images/shared_replacement_1_2.png');
  assert.equal(reloaded.rig.attachments[0]!.texture, 'shared_replacement_1');
});

test('shared and individual replacements preserve stable IDs and precedence with distinct static assets', async () => {
  const source = fixture();
  source.replacements.push(
    {
      assetKey: 'shared',
      reference: undefined,
      blob: new Blob([png]),
      format: 'image/png',
      originScaleX: 1.5,
      originScaleY: 0.5,
    },
    {
      assetKey: 'shared',
      reference: 'attachment:part',
      blob: new Blob([png]),
      format: 'image/png',
      originScaleX: 0.5,
      originScaleY: 1,
    },
  );
  const definition = await validatePackage(await buildCharacterPackage(source, fetchImage));
  assert.equal(definition.rig.bones[0]!.sprite!.texture, 'shared');
  assert.closeTo(definition.rig.bones[0]!.sprite!.originX!, 0.3, 1e-12);
  assert.equal(definition.rig.attachments[0]!.id, 'part');
  assert.equal(definition.rig.attachments[0]!.originX, 0.375);
  assert.notEqual(definition.rig.attachments[0]!.texture, 'shared');
  assert.deepEqual(definition.rig.slots, source.definition.rig.slots);
  assert.deepEqual(
    Object.fromEntries(definition.standaloneSkins.map((skin) => [skin.name, skin])),
    Object.fromEntries(source.skins.map((skin) => [skin.name, skin])),
  );
  assert.deepEqual(definition.animations, source.animations);
});

test('pixel pivots outside normalized bounds migrate into exact rotated/scaled offsets', async () => {
  const source = fixture();
  const replacement = {
    assetKey: 'shared',
    reference: 'attachment:part' as const,
    blob: new Blob([png]),
    format: 'image/png' as const,
    originScaleX: 4,
    originScaleY: 3,
  };
  source.replacements.push(replacement);
  const output = await validatePackage(await buildCharacterPackage(source, fetchImage));
  const original = source.rig.attachments![0]!,
    next = output.rig.attachments[0]!;
  const width = new DataView(png.buffer).getUint32(16),
    height = new DataView(png.buffer).getUint32(20);
  const point = (sprite: typeof original, ox: number, oy: number) => {
    const x = -ox * width * (sprite.scaleX ?? 1),
      y = -oy * height * (sprite.scaleY ?? 1);
    return {
      x: (sprite.x ?? 0) + Math.cos(sprite.rotation ?? 0) * x - Math.sin(sprite.rotation ?? 0) * y,
      y: (sprite.y ?? 0) + Math.sin(sprite.rotation ?? 0) * x + Math.cos(sprite.rotation ?? 0) * y,
    };
  };
  const before = point(original, original.originX! * 4, original.originY! * 3);
  const after = point(next, next.originX!, next.originY!);
  assert.closeTo(before.x, after.x, 1e-9);
  assert.closeTo(before.y, after.y, 1e-9);
  assert.equal(next.originX, 1);
  assert.equal(next.originY, 1);
});

test('snapshot is captured before delayed image fetch and source edits never leak into export', async () => {
  const source = fixture();
  let complete!: (response: Response) => void;
  const pending = buildCharacterPackage(
    source,
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  source.rig.bones[0]!.x = 900;
  complete(new Response(png));
  const output = await validatePackage(await pending);
  assert.isUndefined(output.rig.bones[0]!.x);
  assert.equal(source.rig.bones[0]!.x, 900);
});

for (const path of [
  '../escape.png',
  '/root.png',
  'blob:temporary',
  'https://example.com/a',
  'a\\b',
  'a/%2e%2e/b',
  './a',
  'a//b',
  'a?b',
  'a#b',
  'a/../b',
  'a\u0000b',
  'a./b',
]) {
  test(`unsafe package path rejected: ${JSON.stringify(path)}`, () =>
    assert.throws(() => packagePath(path), /Invalid package path/));
}

test('manifest paths, missing images, invalid JSON, versions and duplicate clip IDs fail atomically', async () => {
  const files = new Map(await buildCharacterPackage(fixture(), fetchImage));
  files.delete('images/part.png');
  await rejected(validatePackage(files), /rejected by policy|Missing image/);
  const change = async (path: string, value: unknown) => {
    const changed = new Map(await buildCharacterPackage(fixture(), fetchImage));
    changed.set(path, new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
    return validatePackage(changed);
  };
  await rejected(change('character.json', '{broken'), /JSON/);
  await rejected(change('character.json', { ...manifest, version: 99 }), /Invalid input/);
  await rejected(change('character.json', { ...manifest, rig: '../escape.json' }), /policy|path/);
  await rejected(
    change('character.json', { ...manifest, animations: ['animations/move.json', 'animations/move.json'] }),
    /Duplicate/,
  );
  await rejected(change('rigs/body.json', { ...fixture().rig, bones: [{ id: 'root' }, { id: 'root' }] }), /Duplicate/);
});

test('frame references, stale replacement targets and file collisions give actionable errors', async () => {
  const framed = fixture();
  framed.rig.bones[0]!.sprite!.frame = 3;
  await rejected(buildCharacterPackage(framed, fetchImage), /frame "3"/);
  const stale = fixture();
  stale.replacements.push({
    assetKey: 'shared',
    reference: 'attachment:deleted',
    blob: new Blob([png]),
    format: 'image/png',
    originScaleX: 1,
    originScaleY: 1,
  });
  await rejected(buildCharacterPackage(stale, fetchImage), /no longer exists/);
  const files = new Map(await buildCharacterPackage(fixture(), fetchImage));
  files.set('CHARACTER.JSON', files.get('character.json')!);
  assert.throws(() => encodePackageZip(files), /Duplicate/);
});

test('invalid image, failed fetch and cancellation leave the source intact', async () => {
  const source = fixture(),
    before = JSON.stringify(source);
  await rejected(
    buildCharacterPackage(source, () => Promise.resolve(new Response('not an image'))),
    /valid PNG or WebP/,
  );
  await rejected(
    buildCharacterPackage(source, () => Promise.resolve(new Response(null, { status: 404 }))),
    /Could not include image/,
  );
  const request = new AbortController();
  request.abort(new Error('Interrupted'));
  await rejected(buildCharacterPackage(source, fetchImage, request.signal), /Interrupted/);
  assert.equal(JSON.stringify(source), before);
});

test('ZIP checksum, truncation, unsupported compression and traversal are rejected', async () => {
  const zip = encodePackageZip(await buildCharacterPackage(fixture(), fetchImage));
  const damaged = new Uint8Array(zip);
  damaged[100] = damaged[100]! ^ 1;
  assert.throws(() => decodePackageZip(damaged), /Damaged|Invalid/);
  assert.throws(() => decodePackageZip(zip.subarray(0, -1)), /Unsupported ZIP/);
  const compressed = new Uint8Array(zip);
  compressed[8] = 8;
  assert.throws(() => decodePackageZip(compressed), /Unsupported/);
  const malicious = new Uint8Array(zip);
  const original = new TextEncoder().encode('rigs/body.json');
  const traversal = new TextEncoder().encode('../x/body.json');
  for (let i = 0; i <= malicious.length - original.length; i++)
    if (original.every((byte, j) => malicious[i + j] === byte)) malicious.set(traversal, i);
  assert.throws(() => decodePackageZip(malicious), /Invalid package path/);
});

test('package checkpoints cover each domain and delayed download cannot clean newer edits', async () => {
  let current = fixture();
  const controller = new PackageController(zipProcessor);
  controller.bind(() => current);
  assert.deepEqual(controller.getSnapshot().modified, []);
  const rig = new RigEditorState(new Rig(current.definition.rig, []), current.rig, {
    defaultSkin: current.definition.defaultSkin,
    standaloneSkins: current.skins,
  });
  const animations = new AnimationEditorState(current.definition.rig, current.animations);
  animations.selectAnimation('move');
  animations.setBonePropertyKeyframe('child', 'x', 42, 0.5);
  current = { ...current, animations: animations.packageAnimations() };
  controller.refresh();
  assert.deepEqual(controller.getSnapshot().modified, ['Animations']);
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const downloading = controller.download();
  current = { ...current, rig: { ...current.rig, bones: current.rig.bones.map((bone) => ({ ...bone, x: 12 })) } };
  controller.refresh();
  complete(new Response(png));
  await downloading;
  assert.deepEqual(controller.getSnapshot().modified, ['Rig']);
  assert.isTrue(animations.dirty);
  assert.isFalse(rig.dirty);
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 1);
  controller.previewExport();
  assert.isNotNull(controller.getSnapshot().preview);
  controller.closePreview();
  assert.isNull(controller.getSnapshot().preview);
  const before = controller.getSnapshot();
  await controller.importPreview(new File(['invalid'], 'invalid.zip'));
  assert.equal(controller.getSnapshot().modified, before.modified);
  assert.isNull(controller.getSnapshot().preview);
  controller.dispose();
});

test('failed download and disposed in-flight requests cannot establish clean checkpoints', async () => {
  const source = fixture();
  source.rig.bones[0]!.x = 7;
  const controller = new PackageController(zipProcessor);
  controller.bind(() => source);
  vi.stubGlobal('fetch', fetchImage);
  vi.mocked(downloadBlob).mockImplementation(() => {
    throw new Error('Download denied');
  });
  await controller.download();
  assert.isTrue(controller.hasUnsavedChanges);
  assert.include(controller.getSnapshot().message, 'Download denied');
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = controller.download();
  controller.dispose();
  complete(new Response(png));
  await pending;
  assert.isFalse(controller.getSnapshot().ready);
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 1);
});

test('throwing subscribers cannot interrupt package downloads or leave the controller busy', async () => {
  const source = fixture();
  source.rig.bones[0]!.x = 7;
  const controller = new PackageController(zipProcessor);
  controller.bind(() => source);
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  vi.stubGlobal('fetch', fetchImage);
  const failure = new Error('Subscriber failed');
  controller.subscribe(() => {
    throw failure;
  });
  const observer = vi.fn(() => controller.getSnapshot());
  controller.subscribe(observer);
  await controller.download();
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 1);
  assert.isFalse(controller.getSnapshot().busy);
  assert.isFalse(controller.hasUnsavedChanges);
  controller.previewExport();
  assert.isNotNull(controller.getSnapshot().preview);
  controller.closePreview();
  await controller.importPreview(new File(['invalid'], 'invalid.zip'));
  assert.isFalse(controller.getSnapshot().busy);
  assert.include(controller.getSnapshot().message, 'Invalid ZIP size');
  assert.equal(observer.mock.calls.length, reporter.mock.calls.length);
  assert.isTrue(reporter.mock.calls.every(([error]) => error === failure));
  controller.dispose();
});

test('edits during ZIP processing remain modified after the captured archive finishes', async () => {
  let source = fixture();
  vi.stubGlobal('fetch', fetchImage);
  let complete!: (result: Awaited<ReturnType<PackageZipProcessor['encode']>>) => void;
  const encode = vi.fn<PackageZipProcessor['encode']>(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const controller = new PackageController({ ...zipProcessor, encode });
  controller.bind(() => source);
  const pending = controller.download();
  await vi.waitFor(() => assert.equal(encode.mock.calls.length, 1));
  assert.isTrue(controller.getSnapshot().busy);
  source = { ...source, rig: { ...source.rig, bones: source.rig.bones.map((bone) => ({ ...bone, x: 42 })) } };
  controller.refresh();
  complete(await zipProcessor.encode(encode.mock.calls[0]![0], new AbortController().signal));
  await pending;
  assert.deepEqual(controller.getSnapshot().modified, ['Rig']);
  assert.isFalse(controller.getSnapshot().busy);
  assert.equal(vi.mocked(downloadBlob).mock.calls.length, 1);
  controller.previewExport();
  const definition = await loadPackageDefinition(controller.getSnapshot().preview!);
  assert.isUndefined(definition.rig.bones[0]!.x);
  controller.dispose();
});

test.each(['dispose', 'rebind'] as const)(
  'ZIP completion after %s cannot download or install a stale checkpoint',
  async (action) => {
    const source = fixture();
    vi.stubGlobal('fetch', fetchImage);
    let complete!: (result: Awaited<ReturnType<PackageZipProcessor['encode']>>) => void;
    const encode = vi.fn<PackageZipProcessor['encode']>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new PackageController({ ...zipProcessor, encode });
    controller.bind(() => source);
    const pending = controller.download();
    await vi.waitFor(() => assert.equal(encode.mock.calls.length, 1));
    const [files, signal] = encode.mock.calls[0]!;
    if (action === 'dispose') controller.dispose();
    else {
      const replacement = fixture();
      replacement.rig.bones[0]!.x = 99;
      controller.bind(() => replacement);
    }
    const before = controller.getSnapshot();
    assert.isTrue(signal.aborted);
    complete(await zipProcessor.encode(files, new AbortController().signal));
    await pending;
    assert.strictEqual(controller.getSnapshot(), before);
    assert.equal(vi.mocked(downloadBlob).mock.calls.length, 0);
    assert.isNull(controller.getSnapshot().preview);
    controller.dispose();
  },
);

test('canceling a ZIP import prevents a delayed decoded archive from opening a preview', async () => {
  const files = await buildCharacterPackage(fixture(), fetchImage);
  let complete!: (result: Awaited<ReturnType<PackageZipProcessor['decode']>>) => void;
  const decode = vi.fn<PackageZipProcessor['decode']>(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const controller = new PackageController({ ...zipProcessor, decode });
  const pending = controller.importPreview(new File([encodePackageZip(files)], 'character.zip'));
  await vi.waitFor(() => assert.equal(decode.mock.calls.length, 1));
  controller.unbind();
  assert.isTrue(decode.mock.calls[0]![1].aborted);
  complete(files);
  await pending;
  assert.isFalse(controller.getSnapshot().busy);
  assert.isNull(controller.getSnapshot().preview);
  controller.dispose();
});

test('runtime preview leases revoke every object URL on disposal and cancellation', async () => {
  const files = await buildCharacterPackage(fixture(), fetchImage);
  const create = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const runtime = await openPackageRuntime(files, new AbortController().signal);
  assert.match(runtime.definition.textureUrl('shared'), /^blob:/);
  runtime.dispose();
  runtime.dispose();
  assert.equal(revoke.mock.calls.length, create.mock.calls.length);
  const request = new AbortController();
  const pending = openPackageRuntime(files, request.signal);
  request.abort();
  await rejected(pending);
  assert.equal(revoke.mock.calls.length, create.mock.calls.length);
});

test('all shipped animations, IK and baked IK round-trip through ZIP → CharacterLoader → Puppet in both facings', async () => {
  const fetcher: typeof fetch = (input) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      new Response(readFileSync(new URL(`../public/characters/demo-puppet/${path}`, import.meta.url))),
    );
  };
  const authoredIK: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: true,
    tracks: {},
    ikTracks: {
      leftArm: [
        { time: 0, x: -90, y: -50, mix: 1 },
        { time: 1000, x: -80, y: -30, mix: 0.8 },
      ],
    },
  };
  // Use actual shipped IK names; clip-local baked suppression must survive export unchanged.
  const chain = demoCharacter.rig.ik?.[0];
  const animations = [...demoCharacter.animations];
  if (chain) {
    const clip = { ...authoredIK, ikTracks: { [chain.name]: authoredIK.ikTracks!.leftArm! } };
    const sampling = sampleIKBake(clip, demoCharacter.rig, [chain.name], { fps: 24 });
    assert.isTrue(sampling.success);
    if (sampling.success) {
      const proposal = generateBakedBoneKeys(sampling, demoCharacter.rig, { animation: clip });
      assert.isTrue(proposal.success);
      if (proposal.success) {
        const baked = commitIKBake(clip, proposal, demoCharacter.rig);
        assert.isTrue(baked.success);
        if (baked.success) animations.push(clip, { ...baked.animation, name: 'baked' });
      }
    }
  }
  const files = await buildCharacterPackage(
    {
      definition: demoCharacter,
      rig: structuredClone(demoCharacter.rigFile!),
      skins: demoCharacter.standaloneSkins,
      animations,
      replacements: [],
    },
    fetcher,
  );
  const definition = await loadPackageDefinition(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual(definition.animations, animations);
  for (const facing of ['left', 'right'] as const) {
    const original = new Puppet(puppetScene(), { rig: demoCharacter.rig, animations, autoUpdate: false, facing });
    const reloaded = new Puppet(puppetScene(), { definition, autoUpdate: false, facing });
    for (const clip of animations) {
      original.play(clip.name);
      reloaded.play(clip.name);
      for (const time of [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration - 0.001]) {
        original.animationPlayer.sample(time);
        reloaded.animationPlayer.sample(time);
        original.syncPose();
        reloaded.syncPose();
        for (const bone of definition.rig.bones) {
          assert.deepEqual(reloaded.getBone(bone.id).pose, original.getBone(bone.id).pose);
          assert.deepEqual(
            reloaded.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0),
            original.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0),
          );
        }
      }
    }
    for (const skin of definition.rig.skins) {
      original.setSkin(skin.name);
      reloaded.setSkin(skin.name);
    }
    original.destroy();
    reloaded.destroy();
  }
  assert.isObject(packageJson(files, 'character.json'));
  assert.notStrictEqual(capturePackage(fixture()).rig, fixture().rig);
});

test('browser image validation rejects corrupt bodies and releases decode URLs before any download', async () => {
  const files = await buildCharacterPackage(fixture(), fetchImage);
  const create = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode(): Promise<void> {
        return Promise.reject(new Error('damaged image'));
      }
    },
  );
  await rejected(validatePackage(files), /Image "images\/part.png" could not be decoded/);
  assert.equal(create.mock.calls.length, 1);
  assert.equal(revoke.mock.calls.length, 1);
});

test('package skin and artwork checkpoints survive undo/revert and retain rig-animation separation', async () => {
  let source = fixture();
  const controller = new PackageController(zipProcessor);
  controller.bind(() => source);
  const original = source;
  source = { ...source, skins: source.skins.map((skin) => ({ ...skin, slots: {} })) };
  controller.refresh();
  assert.deepEqual(controller.getSnapshot().modified, ['Skins']);
  const changedSkins = source;
  source = {
    ...source,
    replacements: [
      {
        assetKey: 'shared',
        reference: undefined,
        blob: new Blob([png]),
        format: 'image/png',
        originScaleX: 1,
        originScaleY: 1,
      },
    ],
  };
  controller.refresh();
  assert.deepEqual(controller.getSnapshot().modified, ['Skins', 'Assets']);
  source = changedSkins;
  controller.refresh();
  assert.deepEqual(controller.getSnapshot().modified, ['Skins']);
  source = original;
  controller.refresh();
  assert.isFalse(controller.hasUnsavedChanges);
  const animation = new AnimationEditorState(source.definition.rig, source.animations);
  animation.selectAnimation('move');
  animation.setBonePropertyKeyframe('child', 'rotation', 0.5, 0.25);
  const working = animation.workingAnimation,
    history = animation.historyLength;
  const files = await buildCharacterPackage({ ...source, animations: animation.packageAnimations() }, fetchImage);
  assert.strictEqual(animation.workingAnimation, working);
  assert.equal(animation.historyLength, history);
  assert.isTrue(animation.dirty);
  assert.deepEqual((await loadPackageDefinition(files)).rigFile, source.rig);
  controller.dispose();
});

test('plain relative filenames with spaces and Unicode resolve through the production loader', async () => {
  const files = new Map(await buildCharacterPackage(fixture(), fetchImage));
  const source = fixture().definition.manifest!;
  const rigPath = 'rigs/my body.json',
    imagePath = 'images/käsi part.png';
  files.set(rigPath, files.get(source.rig)!);
  files.delete(source.rig);
  files.set(imagePath, files.get(source.textures.shared!)!);
  files.delete(source.textures.shared!);
  files.set(
    'character.json',
    new TextEncoder().encode(JSON.stringify({ ...source, rig: rigPath, textures: { shared: imagePath } })),
  );
  const definition = await validatePackage(decodePackageZip(encodePackageZip(files)));
  assert.equal(definition.rigPath, rigPath);
  assert.equal(definition.textures.shared, imagePath);
  const runtime = await openPackageRuntime(files, new AbortController().signal);
  assert.match(runtime.definition.textureUrl('shared'), /^blob:/);
  runtime.dispose();
});

test('reassigned logical artwork rejects an obsolete individual override instead of changing its new asset', async () => {
  const source = fixture();
  const files = await buildCharacterPackage(source, fetchImage);
  const manifest = {
    ...source.definition.manifest!,
    textures: { shared: 'images/part.png', other: 'images/other.png' },
  };
  const definition = CharacterDefinition.fromData({
    manifest,
    rig: source.rig,
    skins: Object.fromEntries(Object.values(manifest.skins).map((path) => [path, packageJson(files, path)])),
    animations: Object.fromEntries(manifest.animations.map((path) => [path, packageJson(files, path)])),
    poses: Object.fromEntries((manifest.poses ?? []).map((path) => [path, packageJson(files, path)])),
  });
  source.rig.attachments![0]!.texture = 'other';
  await rejected(
    buildCharacterPackage(
      {
        ...source,
        definition,
        replacements: [
          {
            assetKey: 'shared',
            reference: 'attachment:part',
            blob: new Blob([png]),
            format: 'image/png',
            originScaleX: 1,
            originScaleY: 1,
          },
        ],
      },
      fetchImage,
    ),
    /now uses another texture/,
  );
});

test('ZIP size budgets include the exact UTF-8 filename and directory bytes before encoding', () => {
  const bytes = new Uint8Array(408_000);
  const files = new Map(Array.from({ length: 256 }, (_, index) => [`${'图'.repeat(500)}/${index}.png`, bytes]));
  assert.throws(() => encodePackageZip(files), /exceeds 100 MiB/);
});

test.each(['IMAGEs/part.png', 'images', 'images/part.png/child'])(
  'validation rejects portable file collisions before opening a preview: %s',
  async (path) => {
    const files = new Map(await buildCharacterPackage(fixture(), fetchImage));
    files.set(path, png);
    await rejected(validatePackage(files), /Duplicate|collision/);
  },
);

test('image aliases within runtime budgets are fetched and validated by browser decoding once', async () => {
  const source = fixture();
  const data = {
    manifest: {
      ...manifest,
      textures: Object.fromEntries(
        Array.from({ length: 4 }, (_, index) => [index ? `alias${index}` : 'shared', 'images/part.png']),
      ),
    },
    rig: source.rig,
    skins: Object.fromEntries(
      source.skins.map((skin) => [manifest.skins[skin.name as keyof typeof manifest.skins], skin]),
    ),
    animations: { 'animations/move.json': { ...source.animations[0], version: 1 } },
    poses: { 'poses/ready.json': source.definition.poses[0] },
  };
  const largeHeader = new Uint8Array(png);
  const view = new DataView(largeHeader.buffer);
  view.setUint32(16, 4096);
  view.setUint32(20, 4096);
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(largeHeader)));
  // Four runtime textures reach the 64-megapixel budget; ZIP storage and validation decode remain deduplicated.
  const files = await buildCharacterPackage({ ...source, definition: CharacterDefinition.fromData(data) }, fetcher);
  assert.equal(fetcher.mock.calls.length, 1);
  const decode = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 4096;
      naturalHeight = 4096;
      decode = decode;
    },
  );
  await validatePackage(files);
  assert.equal(decode.mock.calls.length, 1);
  const loadedManifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  const extraAlias = new Map(files);
  extraAlias.set(
    'character.json',
    new TextEncoder().encode(
      JSON.stringify({
        ...loadedManifest,
        textures: { ...loadedManifest.textures, overBudget: 'images/part.png' },
      }),
    ),
  );
  await rejected(validatePackage(extraAlias), /67108864-pixel total limit/);
  await rejected(openPackageRuntime(extraAlias, new AbortController().signal), /67108864-pixel total limit/);
  assert.equal(decode.mock.calls.length, 1, 'Reject excess aliases before allocating decoded pixels.');
});

test.each([
  ['rigs/body.json', { ...fixture().rig, version: 99 }, /Unsupported|version/],
  ['skins/base.json', { version: 99, name: 'default', slots: {} }, /Invalid input|version/],
  ['skins/base.json', { version: 1, name: 'default', slots: { missing: 'part' } }, /slot/],
  [
    'animations/move.json',
    { version: 1, name: 'move', duration: 1000, loop: true, tracks: { missing: [{ time: 0, x: 1 }] } },
    /bone/,
  ],
  [
    'animations/move.json',
    { version: 99, name: 'move', duration: 1000, loop: true, tracks: {} },
    /Unsupported|version/,
  ],
] as const)('export validation rejects incompatible document %s', async (path, data, error) => {
  const files = new Map(await buildCharacterPackage(fixture(), fetchImage));
  files.set(path, new TextEncoder().encode(JSON.stringify(data)));
  await rejected(validatePackage(files), error);
});
