import type Phaser from 'phaser';
import { afterEach, assert, expect, test, vi } from 'vitest';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { EnvironmentPreviewLayer } from '../src/devtools/animation-editor/EnvironmentPreviewLayer.js';
import { CharacterTextureBudget } from '../src/engine/characterTextureLimits.js';
import type { SceneImageDefinition } from '../src/engine/SceneDefinition.js';
import { SceneImageLayer } from '../src/engine/SceneImageLayer.js';
import { DEFAULT_SCENE_LAYERS, sceneActorDepth } from '../src/engine/sceneLayers.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

// EnvironmentPreviewLayer loads the runtime barrel; Phaser itself cannot load without a browser.
vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

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
  scrollFactorX = 1;
  scrollFactorY = 1;
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

test('removing and restoring an image during decoding gives the restored image a fresh lease', async () => {
  const { scene, textures, revoke } = stage();
  let decoding = (): void => {};
  const started = new Promise<void>((resolve) => {
    decoding = resolve;
  });
  let complete = (): void => {};
  vi.stubGlobal(
    'Image',
    class extends TestImage {
      override decode = () => {
        decoding();
        return new Promise<void>((resolve) => {
          complete = resolve;
        });
      };
    },
  );
  const layer = new SceneImageLayer(scene, bytes, () => {}, new CharacterTextureBudget({ maxTotalImagePixels: 1 }));
  try {
    layer.sync([image]);
    await started;
    layer.sync([]);
    vi.stubGlobal('Image', TestImage);
    layer.sync([image]);
    await layer.ready();
    complete();
    await Promise.resolve();
    assert.equal(layer.error, '');
    assert.equal(layer.objects.size, 1);
    assert.equal(textures.size, 2);
    assert.equal(revoke.mock.calls.length, 1);
  } finally {
    layer.dispose();
  }
  assert.equal(revoke.mock.calls.length, 2);
});

test('restoring an image replaces a stalled resource request and ignores its late failure', async () => {
  const { scene } = stage();
  let started = (): void => {};
  const loading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let rejectOld = (_error: Error): void => {};
  let requests = 0;
  const layer = new SceneImageLayer(scene, () => {
    if (requests++ > 0) return bytes();
    started();
    return new Promise<Uint8Array<ArrayBuffer>>((_resolve, reject) => {
      rejectOld = reject;
    });
  });
  try {
    layer.sync([image]);
    await loading;
    const obsolete = layer.ready();
    layer.sync([]);
    layer.sync([image]);
    await layer.ready();
    await obsolete;
    rejectOld(new Error('Obsolete download failed.'));
    await Promise.resolve();
    assert.equal(requests, 2);
    assert.equal(layer.error, '');
    assert.equal(layer.objects.size, 1);
  } finally {
    layer.dispose();
  }
});

test('failed decoding is actionable, retryable and releases each failed lease', async () => {
  const { scene, textures, revoke } = stage();
  class BrokenImage extends TestImage {
    override decode = () => Promise.reject(new Error('broken'));
  }
  vi.stubGlobal('Image', BrokenImage);
  const layer = new SceneImageLayer(scene, bytes, () => {}, new CharacterTextureBudget({ maxTotalImagePixels: 1 }));
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

test('shared renderer applies layer depth, visibility and native parallax without changing authored data', async () => {
  const { scene, objects } = stage();
  const layers = [...DEFAULT_SCENE_LAYERS, { id: 'foreground', name: 'Trees', visible: true, parallax: 1.2 }];
  const elements = [image, { ...image, id: 'tree', layerId: 'foreground' }];
  const authored = JSON.stringify(elements);
  const layer = new SceneImageLayer(scene, bytes);
  layer.sync(elements, layers);
  await layer.ready();
  assert.isBelow(objects[0]!.depth, sceneActorDepth({ layers }, 0));
  assert.isAbove(objects[1]!.depth, sceneActorDepth({ layers }, 255));
  assert.equal(objects[1]!.scrollFactorX, 1.2);
  assert.equal(objects[1]!.scrollFactorY, 1.2);
  layer.sync(
    elements,
    layers.map((entry) => ({ ...entry, visible: false })),
  );
  assert.isFalse(objects[0]!.visible);
  assert.isFalse(objects[1]!.visible);
  layer.sync(elements, [...layers].reverse());
  assert.isBelow(objects[1]!.depth, objects[0]!.depth);
  // Editor uses only explicit cinematic scroll for compensation. Native camera pan is separate.
  layer.sync(elements, layers, { x: 100, y: 50 });
  assert.closeTo(objects[1]!.x, image.position.x - 20, 1e-9);
  assert.closeTo(objects[1]!.y, image.position.y - 10, 1e-9);
  assert.equal(objects[1]!.scrollFactorX, 1);
  assert.equal(JSON.stringify(elements), authored);
  assert.lengthOf(objects, 2);
  layer.dispose();
});

test('camera pans and zoom samples retain texture consumers without queuing unchanged depth sorts', async () => {
  const { scene, objects } = stage();
  const layer = new SceneImageLayer(scene, bytes);
  layer.sync([image]);
  await layer.ready();
  const object = objects[0]!;
  const depth = vi.spyOn(object, 'setDepth');
  const texture = vi.spyOn(object, 'setTexture');
  for (let x = 0; x < 60; x++) layer.sync([image], undefined, { x, y: x / 2 });
  assert.equal(depth.mock.calls.length, 0);
  assert.equal(texture.mock.calls.length, 0);
  assert.equal(objects.length, 1);
  layer.sync([{ ...image, order: 2 }]);
  assert.equal(depth.mock.calls.length, 1);
  layer.dispose();
});

test('switching artwork releases its shared pixel budget before the next scene allocates textures', async () => {
  const { scene, textures } = stage();
  const budget = new CharacterTextureBudget({ maxTotalImagePixels: 1 });
  const layer = new SceneImageLayer(scene, bytes, () => {}, budget);
  try {
    for (let index = 0; index < 4; index++) {
      layer.sync([{ ...image, image: `images/scene-${index}.png` }]);
      await layer.ready();
      assert.equal(layer.objects.size, 1);
      assert.equal(textures.size, 2); // One private image and the shared character texture.
    }
  } finally {
    layer.dispose();
  }
  assert.deepEqual([...textures], ['shared-character']);
});

test('independent renderers charge separate textures and a rejected allocation can retry after disposal', async () => {
  const { scene, textures } = stage();
  const budget = new CharacterTextureBudget({ maxTotalImagePixels: 1 });
  const first = new SceneImageLayer(scene, bytes, () => {}, budget);
  const second = new SceneImageLayer(scene, bytes, () => {}, budget);
  try {
    first.sync([image]);
    await first.ready();
    second.sync([image]);
    await expect(second.ready()).rejects.toThrow(/1-pixel total limit/);
    assert.equal(first.objects.size, 1);
    assert.equal(second.objects.size, 0);
    first.dispose();
    second.retry();
    await second.ready();
    assert.equal(second.objects.size, 1);
  } finally {
    first.dispose();
    second.dispose();
  }
  assert.deepEqual([...textures], ['shared-character']);
});

test('animation environment owns one world image, preserves navigation transforms and cleans resources on toggles/disposal', async () => {
  const { scene, objects, textures, revoke } = stage();
  const controller = new EnvironmentPreviewController();
  controller.images.register(image.image, await bytes());
  controller.update({ enabled: true, image: image.image, x: 380, y: 435, scale: 2 });
  const layer = new EnvironmentPreviewLayer(scene, controller);
  layer.setActive(true);
  await vi.waitFor(() => assert.equal(objects.length, 1));
  const first = objects[0]!;
  assert.equal(first.x, 380);
  assert.equal(first.y, 435);
  assert.equal(first.scrollFactorX, 1);
  assert.isBelow(first.depth, 0);
  Object.assign(scene, { cameras: { main: { zoom: 2, scrollX: -130, scrollY: 240, width: 900, height: 600 } } });
  controller.update({ x: 410 });
  assert.equal(first.x, 410);
  assert.equal(first.y, 435);
  assert.equal(first.scaleX, 2);
  assert.equal(objects.length, 1);
  controller.update({ visible: false });
  assert.isTrue(first.destroyed);
  assert.deepEqual([...textures], ['shared-character']);
  controller.update({ visible: true });
  await vi.waitFor(() => assert.equal(objects.length, 2));
  controller.update({ enabled: false });
  assert.deepEqual([...textures], ['shared-character']);
  controller.update({ enabled: true });
  await vi.waitFor(() => assert.equal(objects.length, 3));
  layer.setActive(false); // Rig view uses the same canvas, without environment artwork.
  assert.deepEqual([...textures], ['shared-character']);
  layer.setActive(true);
  await vi.waitFor(() => assert.equal(objects.length, 4));
  layer.dispose();
  layer.dispose();
  controller.update({ x: 500 });
  assert.deepEqual([...textures], ['shared-character']);
  assert.equal(revoke.mock.calls.length, 4);
  controller.dispose();
});

test('missing animation environment artwork reports failure and recovers when the shared registry receives the image', async () => {
  const { scene, objects, textures } = stage();
  const controller = new EnvironmentPreviewController();
  const layer = new EnvironmentPreviewLayer(scene, controller);
  controller.update({ enabled: true, image: image.image });
  layer.setActive(true);
  await vi.waitFor(() => assert.match(controller.getSnapshot().error, /Missing image/));
  assert.equal(objects.length, 0);
  controller.images.register(image.image, await bytes());
  await vi.waitFor(() => assert.equal(objects.length, 1));
  assert.equal(controller.getSnapshot().error, '');
  controller.images.removeUnused(new Set());
  assert.isTrue(objects[0]!.destroyed);
  assert.deepEqual([...textures], ['shared-character']);
  controller.update({ image: '../images/absent.png' });
  await vi.waitFor(() => assert.match(controller.getSnapshot().error, /Missing image/));
  controller.clear();
  assert.equal(controller.getSnapshot().error, '');
  assert.deepEqual([...textures], ['shared-character']);
  layer.dispose();
  controller.dispose();
});
