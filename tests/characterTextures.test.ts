import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { queueCharacterTextures } from '../src/engine/queueCharacterTextures.js';

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
  const load = Object.assign(new EventEmitter(), { image: vi.fn() });
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
  assert.deepEqual(independent.load.image.mock.calls, [['body', 'https://example.test/second/body.png']]);
});

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
  load.image.mockImplementationOnce(() => {
    throw new Error('Queue failed');
  });
  assert.throws(() => queueCharacterTextures(scene, character('first')), /Queue failed/);
  assertClean();
  queueCharacterTextures(scene, character('second'));
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
