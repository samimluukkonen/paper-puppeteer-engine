import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import {
  AnimationEditorGhostLayer,
  AnimationPoseOverlay,
} from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { DEFAULT_ONION_SKIN_SETTINGS } from '../src/devtools/animation-editor/onionSkinSettings.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { ArtworkController } from '../src/devtools/shared/artwork/ArtworkController.js';
import type { ImportedSprite } from '../src/devtools/shared/artwork/spriteImport.js';
import type { Bone } from '../src/engine/Bone.js';
import type { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { Puppet } from '../src/engine/Puppet.js';
import type { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function sprite(filename = 'replacement.png'): ImportedSprite {
  return {
    filename,
    width: 32,
    height: 64,
    bytes: 30,
    format: 'image/png',
    url: `blob:${filename}`,
    blob: new Blob(['binary']),
    image: {} as HTMLImageElement,
    dispose: vi.fn(),
  };
}

function fixture(frame?: string) {
  const rig = new Rig({
    root: 'root',
    bones: [
      {
        id: 'root',
        sprite: { texture: 'shared', x: 7, y: 9, originX: 0.1, originY: 0.8, scaleX: 2, ...(frame ? { frame } : {}) },
      },
      { id: 'forearm', parent: 'root', x: 20, y: 30, sprite: { texture: 'shared' } },
    ],
    slots: [{ id: 'arm', bone: 'forearm' }],
    attachments: [
      { id: 'armA', texture: 'shared', x: 11, originX: 0.2 },
      { id: 'armB', texture: 'shared' },
    ],
    skins: [
      { version: 1, name: 'a', slots: { arm: 'armA' } },
      { version: 1, name: 'b', slots: { arm: 'armB' } },
    ],
  });
  const scene = puppetScene();
  const makeTexture = (key: string) => ({
    key,
    get: () => ({ width: 16, height: 48 }),
    getSourceImage: () => ({ src: '/original.png' }),
    has: () => true,
  });
  const original = makeTexture('shared');
  const textures = new Map<string, ReturnType<typeof makeTexture>>([['shared', original]]);
  const add = vi.fn((key: string) => {
    const texture = makeTexture(key);
    textures.set(key, texture);
    return texture;
  });
  const remove = vi.fn((key: string) => {
    textures.delete(key);
  });
  scene.textures = {
    exists: (key: string) => textures.has(key),
    get: (key: string) => textures.get(key),
    addImage: add,
    remove,
  } as unknown as Phaser.Textures.TextureManager;
  const puppet = new Puppet(scene, { rig, skin: 'a', autoUpdate: false });
  const definition = {
    textures: { shared: 'assets/original.png' },
    textureUrl: () => '/original.png',
  } as unknown as CharacterDefinition;
  let next = sprite();
  const decode = vi.fn(() => Promise.resolve(next));
  const controller = new ArtworkController(decode);
  controller.bind(scene, puppet, definition);
  return {
    rig,
    scene,
    puppet,
    controller,
    original,
    textures,
    add,
    remove,
    decode,
    definition,
    setNext(value: ImportedSprite) {
      next = value;
    },
    get next() {
      return next;
    },
  };
}
const file = () => new File(['image'], 'replacement.png', { type: 'image/png' });

test('retained hidden onion and pose overlays release old texture references before removal', async () => {
  const f = fixture();
  const state = new AnimationEditorState(f.rig, [{ name: 'idle', duration: 1000, loop: true, tracks: {} }]);
  state.selectAnimation('idle');
  state.setCurrentTime(0.5);
  const layer = new AnimationEditorGhostLayer(f.scene, state, f.puppet);
  layer.setSettings({ enabled: true });
  const overlays = Reflect.get(layer, 'instances') as Map<
    string,
    { bones: Map<string, Bone>; renderer: PuppetRenderer }
  >;
  assert.isAbove(overlays.size, 0);
  const overlay = new AnimationPoseOverlay(f.scene, f.puppet, 'mirror', 0);
  const refresh = () => {
    layer.refreshArtwork();
    overlay.syncAppearance(f.puppet, DEFAULT_ONION_SKIN_SETTINGS, f.puppet.getAppearanceRevision());
  };
  f.controller.dispose();
  const controller = new ArtworkController(f.decode);
  controller.bind(f.scene, f.puppet, f.definition, refresh);
  await controller.import(file());
  controller.preview();
  controller.apply();
  const key = f.puppet.getBone('root').sprite!.texture.key;
  for (const ghost of overlays.values()) assert.equal(ghost.bones.get('root')!.sprite!.texture.key, key);
  layer.setSettings({ enabled: false });
  overlay.hide();
  f.remove.mockImplementation((removed) => {
    for (const ghost of overlays.values()) {
      assert.notEqual(ghost.bones.get('root')!.sprite!.texture.key, removed);
      assert.notEqual(ghost.renderer.getSlotImage('arm')!.texture.key, removed);
    }
    const bones = Reflect.get(overlay, 'bones') as Map<string, Bone>;
    assert.notEqual(bones.get('root')!.sprite!.texture.key, removed);
    f.textures.delete(removed);
  });
  controller.revert();
  assert.isFalse(f.textures.has(key));
  controller.dispose();
  layer.dispose();
  overlay.destroy();
  f.puppet.destroy();
});

test('preview, cancel, commit, superseding and revert preserve originals and authored rig/animation state', async () => {
  const f = fixture();
  const rigEditor = new RigEditorState(f.rig);
  const rigSnapshot = rigEditor.workingCopy;
  const state = new AnimationEditorState(f.rig, [
    {
      name: 'idle',
      duration: 1000,
      loop: true,
      tracks: {
        forearm: [
          { time: 0, rotation: 0 },
          { time: 1000, rotation: 1 },
        ],
      },
    },
    { name: 'walk', duration: 1000, loop: true, tracks: { forearm: [{ time: 0, rotation: 0.3 }] } },
  ]);
  state.selectAnimation('idle');
  const preview = new AnimationEditorPreview(state, f.puppet);
  const animation = state.workingAnimation;
  const hierarchy = f.puppet.getBone('forearm').container.parentContainer;
  const pose = { ...f.puppet.getBone('forearm').pose };
  const artwork = f.puppet.getBone('root').sprite!;
  const transform = [artwork.x, artwork.y, artwork.scaleX, artwork.scaleY, artwork.originX, artwork.originY];
  const target = f.controller.getSnapshot().targets[0]!;
  assert.equal(target.key, 'shared');
  assert.equal(target.filename, 'original.png');
  assert.equal(target.width, 16);
  assert.include(target.references, 'Bone: forearm');
  assert.include(target.references, 'Attachment: armA');
  assert.include(target.references, 'Skin: b');

  await f.controller.import(file());
  assert.equal(artwork.texture.key, 'shared', 'import alone leaves artwork unchanged');
  assert.isFalse(f.controller.hasUnsavedChanges);
  f.controller.apply();
  assert.isFalse(f.controller.hasUnsavedChanges, 'explicit preview is required');
  f.controller.preview();
  const temporary = artwork.texture.key;
  assert.notEqual(temporary, 'shared');
  assert.equal(f.puppet.getBone('forearm').sprite!.texture.key, temporary);
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, temporary);
  f.controller.preview();
  assert.equal(f.decode.mock.calls.length, 1);
  assert.equal(f.add.mock.calls.length, 1, 'repeated preview reuses decoding and texture');
  assert.deepEqual([artwork.x, artwork.y, artwork.scaleX, artwork.scaleY, artwork.originX, artwork.originY], transform);
  assert.deepEqual(f.puppet.getBone('forearm').pose, pose);
  f.controller.cancel();
  assert.equal(artwork.texture.key, 'shared');
  assert.isFalse(f.textures.has(temporary));
  assert.equal(vi.mocked(f.next.dispose).mock.calls.length, 1);
  assert.strictEqual(f.textures.get('shared'), f.original);

  f.setNext(sprite('committed.webp'));
  await f.controller.import(file());
  f.controller.preview();
  f.controller.apply();
  const committed = artwork.texture.key;
  assert.isTrue(f.controller.hasUnsavedChanges);
  assert.equal(f.controller.getSnapshot().pendingCount, 1);
  f.puppet.setSkin('b');
  assert.equal(
    f.puppet.getSlotImage('arm')!.texture.key,
    committed,
    'new attachment images inherit the asset override',
  );
  f.setNext(sprite('second.png'));
  await f.controller.import(file());
  f.controller.preview();
  f.controller.cancel();
  assert.equal(artwork.texture.key, committed, 'cancel restores the last committed working copy');
  f.setNext(sprite('third.png'));
  await f.controller.import(file());
  f.controller.preview();
  f.controller.apply();
  assert.isFalse(f.textures.has(committed), 'superseded temporary texture is released');
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.strictEqual(state.workingAnimation, animation);
  assert.strictEqual(rigEditor.workingCopy, rigSnapshot);
  assert.isFalse(rigEditor.dirty);
  assert.strictEqual(f.puppet.getBone('forearm').container.parentContainer, hierarchy);
  state.selectAnimation('walk');
  state.play();
  state.advancePlayback(0.2);
  state.pause();
  assert.isFalse(state.dirty);
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, artwork.texture.key);
  f.controller.revert();
  assert.equal(artwork.texture.key, 'shared');
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
  assert.equal(f.textures.size, 1);
  assert.isFalse(f.controller.hasUnsavedChanges);
  f.controller.dispose();
  preview.dispose();
  f.puppet.destroy();
});

test('texture namespaces avoid collisions and ownership cleanup never removes source/host textures', async () => {
  const f = fixture();
  const collisionKey = `${String(Reflect.get(f.controller, 'namespace'))}1`;
  const collision = { ...f.original, key: collisionKey };
  f.textures.set(collisionKey, collision);
  const other = new ArtworkController(() => Promise.resolve(sprite('other.png')));
  const otherPuppet = new Puppet(f.scene, { rig: f.rig, skin: 'a', autoUpdate: false });
  other.bind(f.scene, otherPuppet, f.definition);
  await f.controller.import(file());
  await other.import(file());
  f.controller.preview();
  other.preview();
  const key = f.puppet.getBone('root').sprite!.texture.key;
  const otherKey = otherPuppet.getBone('root').sprite!.texture.key;
  assert.notEqual(key, otherKey);
  assert.notEqual(key, collisionKey);
  f.controller.apply();
  f.controller.dispose();
  f.controller.dispose();
  assert.isTrue(f.textures.has(otherKey), 'another session still owns its texture');
  assert.strictEqual(f.textures.get('shared'), f.original);
  other.dispose();
  assert.equal(f.textures.size, 2);
  assert.strictEqual(f.textures.get(collisionKey), collision);
  f.puppet.destroy();
  otherPuppet.destroy();
});

test('a preview for another target cancels the proposal and leaves other puppets sharing the original unchanged', async () => {
  const f = fixture();
  f.textures.set('other', { ...f.original, key: 'other' });
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', sprite: { texture: 'shared' } },
      { id: 'other', parent: 'root', sprite: { texture: 'other' } },
    ],
  });
  const puppet = new Puppet(f.scene, { rig, autoUpdate: false });
  f.controller.bind(f.scene, puppet, f.definition);
  await f.controller.import(file());
  f.controller.preview();
  assert.notEqual(puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  f.controller.select('other');
  assert.equal(puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.controller.getSnapshot().selectedKey, 'other');
  assert.isNull(f.controller.getSnapshot().proposed);
  assert.equal(f.textures.size, 2);
  f.controller.dispose();
  f.puppet.destroy();
  puppet.destroy();
});

test('rebind restores a cancelled preview and reapplies pending artwork after rig reload', async () => {
  const f = fixture();
  await f.controller.import(file());
  f.controller.preview();
  f.controller.apply();
  const key = f.puppet.getBone('root').sprite!.texture.key;
  f.setNext(sprite('unapplied.png'));
  await f.controller.import(file());
  f.controller.preview();
  const candidate = f.puppet.getBone('root').sprite!.texture.key;
  const puppet = new Puppet(f.scene, { rig: f.rig, skin: 'a', autoUpdate: false });
  f.controller.bind(f.scene, puppet, f.definition);
  assert.equal(puppet.getBone('root').sprite!.texture.key, key);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, key);
  assert.isFalse(f.textures.has(candidate));
  f.puppet.destroy();
  f.controller.unbind();
  assert.equal(puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.textures.size, 1);
  puppet.destroy();
});

test('failed Phaser installation and invalid decode leave the original visible', async () => {
  const f = fixture();
  f.decode.mockRejectedValueOnce(new Error('corrupt image'));
  await f.controller.import(file());
  assert.include(f.controller.getSnapshot().message, 'corrupt');
  assert.isNull(f.controller.getSnapshot().proposed);
  await f.controller.import(file());
  f.add.mockImplementationOnce(() => null as unknown as ReturnType<typeof f.add>);
  f.controller.preview();
  assert.isFalse(f.controller.getSnapshot().previewing);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.isFalse(f.controller.hasUnsavedChanges);
  f.controller.dispose();
  f.puppet.destroy();
});

test('late import completion cannot replace a newer candidate or survive disposal', async () => {
  const f = fixture();
  let finish!: (sprite: ImportedSprite) => void;
  f.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.controller.import(file());
  const latest = sprite('latest.png');
  f.setNext(latest);
  await f.controller.import(file());
  const stale = sprite('stale.png');
  finish(stale);
  await pending;
  assert.strictEqual(f.controller.getSnapshot().proposed, latest);
  assert.equal(vi.mocked(stale.dispose).mock.calls.length, 1);
  f.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const disposed = f.controller.import(file());
  f.controller.dispose();
  const late = sprite('late.png');
  finish(late);
  await disposed;
  assert.equal(vi.mocked(late.dispose).mock.calls.length, 1);
  assert.isNull(f.controller.getSnapshot().proposed);
  assert.equal(f.textures.size, 1);
  f.puppet.destroy();
});

test('frame assets explain deferred replacement and do not decode', async () => {
  const f = fixture('atlas-frame');
  await f.controller.import(file());
  assert.include(f.controller.getSnapshot().message, 'Atlas/frame');
  assert.equal(f.decode.mock.calls.length, 0);
  f.controller.dispose();
  f.puppet.destroy();
});

test('cleanup preserves a host texture that takes over a temporary key', async () => {
  const f = fixture();
  await f.controller.import(file());
  f.controller.preview();
  const key = f.puppet.getBone('root').sprite!.texture.key;
  const host = { ...f.original, key };
  f.textures.set(key, host);
  f.controller.cancel();
  assert.strictEqual(f.textures.get(key), host);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.remove.mock.calls.length, 0);
  f.controller.dispose();
  f.puppet.destroy();
});

test('runtime override restoration preserves edited origins even if a frame has its own pivot', () => {
  const f = fixture('frame');
  const image = f.puppet.getBone('root').sprite!;
  const setTexture = image.setTexture.bind(image);
  image.setTexture = (key, frame) => setTexture(key, frame).setOrigin(0.5, 0.5);
  image.setOrigin(0.2, 0.7);
  f.puppet.setArtworkTexture('shared', 'shared');
  f.puppet.setArtworkTexture('shared');
  assert.equal(image.originX, 0.2);
  assert.equal(image.originY, 0.7);
  assert.equal(image.frame.name, 'frame');
  f.controller.dispose();
  f.puppet.destroy();
});
