import type Phaser from 'phaser';
import { afterEach, assert, expect, test, vi } from 'vitest';
import type { SceneImageDefinition } from '../src/engine/SceneDefinition.js';
import { SceneImageLayer } from '../src/engine/SceneImageLayer.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

class TestImage {
  src = '';
  naturalWidth = 1;
  naturalHeight = 1;
  decode: () => Promise<void> = vi.fn<() => Promise<void>>(() => Promise.resolve());
}
class TestObject {
  texture: { key: string };
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  visible = true;
  alpha = 1;
  depth = 0;
  destroyed = false;
  constructor(key: string) {
    this.texture = { key };
  }
  setTexture(key: string) {
    this.texture.key = key;
    return this;
  }
  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  setScale(x: number, y: number) {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setVisible(value: boolean) {
    this.visible = value;
    return this;
  }
  setAlpha(value: number) {
    this.alpha = value;
    return this;
  }
  setDepth(value: number) {
    this.depth = value;
    return this;
  }
  destroy() {
    this.destroyed = true;
  }
}
function stage() {
  vi.stubGlobal('Image', TestImage);
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${Math.random()}`);
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const textures = new Set(['shared-character']);
  const objects: TestObject[] = [];
  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      addImage: (key: string) => {
        textures.add(key);
        return {};
      },
      remove: (key: string) => {
        textures.delete(key);
      },
    },
    add: {
      image: (_x: number, _y: number, key: string) => {
        const image = new TestObject(key);
        objects.push(image);
        return image;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, textures, objects, create, revoke };
}
const image: SceneImageDefinition = {
  id: 'forest',
  image: '../images/forest.png',
  position: { x: 12, y: 35 },
  scale: { x: 2, y: 3 },
  visible: true,
  order: 0,
};
const bytes = () =>
  Promise.resolve(new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('reconciles independent images behind Actors without recreating textures on repeated updates', async () => {
  const { scene, objects, textures, create, revoke } = stage();
  const load = vi.fn(bytes);
  const layer = new SceneImageLayer(scene, load);
  layer.sync([image, { ...image, id: 'mountains', order: 5 }]);
  await layer.ready();
  assert.equal(load.mock.calls.length, 1);
  assert.equal(objects.length, 2);
  assert.equal(objects[0]!.texture.key, objects[1]!.texture.key);
  assert.isBelow(objects[0]!.depth, objects[1]!.depth);
  assert.isBelow(objects[1]!.depth, 0);
  layer.sync([image, { ...image, id: 'mountains' }]);
  assert.isBelow(objects[0]!.depth, objects[1]!.depth);
  layer.sync([{ ...image, id: 'mountains' }, image]);
  assert.isBelow(objects[1]!.depth, objects[0]!.depth);
  for (let x = 20; x < 40; x++) layer.sync([{ ...image, position: { x, y: 10 }, visible: false, opacity: 0.4 }]);
  assert.equal(objects.length, 2);
  assert.equal(objects[0]!.x, 39);
  assert.equal(objects[0]!.scaleX, 2);
  assert.isFalse(objects[0]!.visible);
  assert.equal(objects[0]!.alpha, 0.4);
  assert.isTrue(objects[1]!.destroyed);
  assert.equal(create.mock.calls.length, 1);
  layer.sync([]);
  assert.isTrue(objects[0]!.destroyed);
  assert.deepEqual([...textures], ['shared-character']);
  assert.equal(revoke.mock.calls.length, 1);
  layer.dispose();
  layer.dispose();
  assert.equal(revoke.mock.calls.length, 1);
});

test('replacement destroys the old consumer before releasing its texture and keeps element transforms', async () => {
  const { scene, objects, textures, revoke } = stage();
  const layer = new SceneImageLayer(scene, bytes);
  layer.sync([image]);
  await layer.ready();
  const original = objects[0]!;
  const originalKey = original.texture.key;
  layer.sync([{ ...image, image: '../images/replacement.png' }]);
  assert.isTrue(original.destroyed);
  assert.isFalse(textures.has(originalKey));
  await layer.ready();
  assert.equal(objects.length, 2);
  assert.equal(objects[1]!.x, image.position.x);
  assert.equal(objects[1]!.scaleY, image.scale.y);
  layer.dispose();
  assert.equal(revoke.mock.calls.length, 2);
  assert.deepEqual([...textures], ['shared-character']);
});

test('shutdown releases an in-flight decode; late work never installs a texture', async () => {
  const { scene, textures, create, revoke } = stage();
  let complete = (): void => {};
  class DelayedImage extends TestImage {
    override decode = () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      });
  }
  vi.stubGlobal('Image', DelayedImage);
  const layer = new SceneImageLayer(scene, bytes);
  layer.sync([image]);
  await vi.waitFor(() => assert.equal(create.mock.calls.length, 1));
  layer.dispose();
  complete();
  await layer.ready();
  assert.deepEqual([...textures], ['shared-character']);
  assert.equal(revoke.mock.calls.length, 1);
  assert.equal(layer.objects.size, 0);
});

test('failed decoding is actionable, retryable and releases each failed lease', async () => {
  const { scene, textures, revoke } = stage();
  class BrokenImage extends TestImage {
    override decode = () => Promise.reject(new Error('broken'));
  }
  vi.stubGlobal('Image', BrokenImage);
  const layer = new SceneImageLayer(scene, bytes);
  layer.sync([image]);
  await expect(layer.ready()).rejects.toThrow(/corrupt/);
  assert.equal(revoke.mock.calls.length, 1);
  assert.deepEqual([...textures], ['shared-character']);
  vi.stubGlobal('Image', TestImage);
  layer.retry();
  await layer.ready();
  assert.equal(layer.objects.size, 1);
  layer.dispose();
  assert.equal(revoke.mock.calls.length, 2);
});
