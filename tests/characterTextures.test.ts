import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import {
  DEFAULT_CHARACTER_TEXTURE_LIMITS,
  DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS,
  queueCharacterTextures,
} from '../src/engine/queueCharacterTextures.js';

function character(id: string, textures: Record<string, string> = { body: 'body.png' }) {
  return CharacterDefinition.fromData(
    {
      manifest: {
        version: 1,
        id,
        rig: 'rig.json',
        skins: { default: 'skin.json' },
        defaultSkin: 'default',
        animations: [],
        textures,
      },
      rig: { version: 1, root: 'root', bones: [{ id: 'root' }] },
      skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    },
    `https://example.test/${id}/character.json`,
  );
}

function fixture(
  textures = {
    loaded: new Set<string>(),
    exists(key: string) {
      return this.loaded.has(key);
    },
  },
) {
  const load = Object.assign(new EventEmitter(), {
    image: vi.fn(),
    prefix: '',
    imageLoadType: 'HTMLImageElement',
    list: new Set<Phaser.Loader.File>(),
    inflight: new Set<Phaser.Loader.File>(),
    queue: new Set<Phaser.Loader.File>(),
  });
  const events = new EventEmitter();
  const scene = { textures, load, events } as unknown as Phaser.Scene;
  const assertClean = () => {
    assert.equal(load.listenerCount('complete'), 0);
    assert.equal(events.listenerCount('shutdown'), 0);
  };
  return { scene, load, events, textures, assertClean };
}

test('loaded character keys reject different image URLs across scenes before queueing any files', () => {
  const first = fixture();
  queueCharacterTextures(first.scene, character('first'));
  first.textures.loaded.add('body');
  first.load.emit('complete');
  first.assertClean();
  const second = fixture(first.textures);
  assert.throws(
    () => queueCharacterTextures(second.scene, character('second', { extra: 'extra.png', body: 'body.png' })),
    /Texture key "body".*first\/body.png.*second.*second\/body.png.*unique texture keys/,
  );
  assert.equal(second.load.image.mock.calls.length, 0);
  second.assertClean();
});

for (const phase of ['list', 'inflight', 'queue'] as const) {
  test.each(['body.png', 'other.png'])(
    `a host image in ${phase} rejects character reuse of its key (%s) before queueing`,
    (path) => {
      const PhaserFile = createRequire(import.meta.url)(
        '../node_modules/phaser/src/loader/File.js',
      ) as typeof Phaser.Loader.File;
      const { scene, load, assertClean } = fixture();
      const hostFile = new PhaserFile(scene.load, {
        type: 'image',
        key: 'body',
        url: `https://example.test/first/${path}`,
        cache: false,
      });
      load[phase].add(hostFile);
      const progress: unknown = Reflect.get(hostFile, 'onProgress');
      assert.throws(
        () =>
          queueCharacterTextures(scene, character('first', { extra: 'extra.png', body: 'body.png' }), {
            maxImageBytes: 1,
          }),
        /Texture key "body" is already pending/,
      );
      assert.equal(load.image.mock.calls.length, 0);
      assert.strictEqual(Reflect.get(hostFile, 'onProgress'), progress);
      assert.isTrue(load[phase].has(hostFile));
      assertClean();
      load[phase].delete(hostFile);
      queueCharacterTextures(scene, character('second'));
      assert.equal(load.image.mock.calls.length, 1);
      load.emit('complete');
      assertClean();
    },
  );
}

test('shared character images are reused and different texture managers remain independent', () => {
  const first = fixture();
  queueCharacterTextures(first.scene, character('first'));
  first.textures.loaded.add('body');
  first.load.emit('complete');
  const shared = fixture(first.textures);
  queueCharacterTextures(shared.scene, character('second', { body: 'https://example.test/first/body.png' }));
  assert.equal(shared.load.image.mock.calls.length, 0);
  shared.assertClean();
  const independent = fixture();
  queueCharacterTextures(independent.scene, character('second'));
  assert.deepEqual(independent.load.image.mock.calls, [
    [
      'body',
      'https://example.test/second/body.png',
      { responseType: 'blob', timeout: DEFAULT_CHARACTER_TEXTURE_TIMEOUT_MS },
    ],
  ]);
});

test('custom image timeouts reach Phaser without changing the shared loader settings', () => {
  const { scene, load } = fixture();
  queueCharacterTextures(scene, character('custom'), { timeoutMs: 5000 });
  assert.deepEqual(load.image.mock.calls, [
    ['body', 'https://example.test/custom/body.png', { responseType: 'blob', timeout: 5000 }],
  ]);
});

test('manifest keys survive a host loader prefix in actual Phaser files', () => {
  // File is renderer-independent; loading Phaser's browser entry is unnecessary.
  const PhaserFile = createRequire(import.meta.url)(
    '../node_modules/phaser/src/loader/File.js',
  ) as typeof Phaser.Loader.File;
  const { scene, load, textures } = fixture();
  load.prefix = 'host.';
  const files: Phaser.Loader.File[] = [];
  load.image.mockImplementation((key: string, url: string) => {
    const file = new PhaserFile(scene.load, { type: 'image', key, url, cache: false });
    files.push(file);
    textures.loaded.add(file.key);
  });
  queueCharacterTextures(scene, character('first'));
  assert.deepEqual(
    files.map((file) => file.key),
    ['body'],
  );
  assert.isTrue(scene.textures.exists('body'));
  assert.equal(load.prefix, 'host.');
  load.emit('complete');
  assert.throws(() => queueCharacterTextures(scene, character('second')), /Texture key "body"/);
  assert.equal(files.length, 1);
});

test('character files use guarded XHR even when the host prefers image-element loading', () => {
  const ImageFile = createRequire(import.meta.url)(
    '../node_modules/phaser/src/loader/filetypes/ImageFile.js',
  ) as typeof Phaser.Loader.FileTypes.ImageFile;
  const { scene, load } = fixture();
  let file: Phaser.Loader.FileTypes.ImageFile | undefined;
  load.image.mockImplementation((key: string, url: string) => {
    file = new ImageFile(scene.load, key, url);
    load.emit('addfile', file.key, file.type, load, file);
  });
  const release = queueCharacterTextures(scene, character('guarded'));
  assert.ok(file);
  assert.equal(Reflect.get(file, 'useImageElementLoad'), false);
  assert.equal(load.imageLoadType, 'HTMLImageElement');
  release();
});

for (const name of Object.keys(DEFAULT_CHARACTER_TEXTURE_LIMITS) as (keyof typeof DEFAULT_CHARACTER_TEXTURE_LIMITS)[]) {
  test.each([0, -1, NaN, Infinity, 1.5])(`invalid ${name} %s fails before queueing`, (value) => {
    const { scene, load, assertClean } = fixture();
    assert.throws(() => queueCharacterTextures(scene, character('first'), { [name]: value }), /positive safe integer/);
    assert.equal(load.image.mock.calls.length, 0);
    assertClean();
    queueCharacterTextures(scene, character('second'));
    assert.equal(load.image.mock.calls.length, 1);
  });
}

test('inline image limits fail before queueing files or reserving their keys', () => {
  const { scene, load, assertClean } = fixture();
  const oversized = character('first', { body: 'data:image/png;base64,YWJjZA==' });
  assert.throws(() => queueCharacterTextures(scene, oversized, { maxImageBytes: 3 }), /3-byte limit/);
  assert.equal(load.image.mock.calls.length, 0);
  assertClean();
  queueCharacterTextures(scene, character('second'));
  assert.equal(load.image.mock.calls.length, 1);
});

test.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])(
  'invalid image timeout %s cannot acquire reservations',
  (timeoutMs) => {
    const { scene, load, assertClean } = fixture();
    assert.throws(() => queueCharacterTextures(scene, character('first'), { timeoutMs }));
    assert.equal(load.image.mock.calls.length, 0);
    assertClean();
    queueCharacterTextures(scene, character('second'));
    assert.equal(load.image.mock.calls.length, 1);
  },
);

test.each(['complete', 'shutdown', 'release'] as const)(
  'failed or abandoned reservations are released after %s',
  (finish) => {
    const first = fixture();
    const release = queueCharacterTextures(first.scene, character('first'));
    const second = fixture(first.textures);
    assert.throws(() => queueCharacterTextures(second.scene, character('second')), /Texture key "body"/);
    if (finish === 'release') release();
    else if (finish === 'shutdown') first.events.emit('shutdown');
    else first.load.emit('complete');
    release();
    first.assertClean();
    queueCharacterTextures(second.scene, character('second'));
    assert.equal(second.load.image.mock.calls.length, 1);
  },
);

test("a failed concurrent shared load does not release another scene's pending reservation", () => {
  const first = fixture();
  const second = fixture(first.textures);
  const third = fixture(first.textures);
  queueCharacterTextures(first.scene, character('first'));
  queueCharacterTextures(second.scene, character('first'));
  first.load.emit('complete');
  assert.throws(() => queueCharacterTextures(third.scene, character('third')), /Texture key "body"/);
  second.events.emit('shutdown');
  queueCharacterTextures(third.scene, character('third'));
  assert.equal(third.load.image.mock.calls.length, 1);
});

test('host-preloaded atlas keys retain their intentional override', () => {
  const { scene, textures, load, assertClean } = fixture();
  textures.loaded.add('body');
  queueCharacterTextures(scene, character('first'));
  queueCharacterTextures(scene, character('second'));
  assert.equal(load.image.mock.calls.length, 0);
  assertClean();
});

test('removed textures can be replaced with a different character image', () => {
  const { scene, textures, load } = fixture();
  queueCharacterTextures(scene, character('first'));
  textures.loaded.add('body');
  load.emit('complete');
  textures.loaded.delete('body');
  queueCharacterTextures(scene, character('second'));
  assert.equal(load.image.mock.calls.length, 2);
});

test('queue exceptions release reservations and listeners', () => {
  const { scene, load, assertClean } = fixture();
  load.prefix = 'host.';
  load.image.mockImplementationOnce(() => {
    throw new Error('Queue failed');
  });
  assert.throws(() => queueCharacterTextures(scene, character('first')), /Queue failed/);
  assert.equal(load.prefix, 'host.');
  assert.equal(load.imageLoadType, 'HTMLImageElement');
  assertClean();
  queueCharacterTextures(scene, character('second'));
  assert.equal(load.prefix, 'host.');
  assert.equal(load.imageLoadType, 'HTMLImageElement');
  assert.equal(load.image.mock.calls.length, 2);
});

test('Phaser dictionary method names are rejected before any textures are queued', () => {
  // Match Phaser's texture dictionary: registering hasOwnProperty would break all later lookups.
  const list: Record<string, object> = {};
  const { scene, load, assertClean } = fixture({
    loaded: new Set<string>(),
    exists(key: string) {
      return list.hasOwnProperty(key);
    },
  });
  load.image.mockImplementation((key: string) => {
    list[key] = { key };
  });
  assert.throws(
    () => queueCharacterTextures(scene, character('unsafe', { body: 'body.png', hasOwnProperty: 'unsafe.png' })),
    /Texture key "hasOwnProperty" is reserved by Phaser/,
  );
  assert.equal(load.image.mock.calls.length, 0);
  assertClean();
  queueCharacterTextures(scene, character('safe'));
  assert.isTrue(scene.textures.exists('body'));
  load.emit('complete');
  assertClean();
});
