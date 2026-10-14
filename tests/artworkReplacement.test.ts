import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import {
  AnimationEditorGhostLayer,
  AnimationPoseOverlay,
} from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { mirrorSelectedKeyframes } from '../src/devtools/animation-editor/keyframeMirroring.js';
import { DEFAULT_ONION_SKIN_SETTINGS } from '../src/devtools/animation-editor/onionSkinSettings.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { ArtworkController } from '../src/devtools/shared/artwork/ArtworkController.js';
import type { ImportedSprite } from '../src/devtools/shared/artwork/spriteImport.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import type { Bone } from '../src/engine/Bone.js';
import type { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { type AnimationClip, commitIKBake, generateBakedBoneKeys, sampleIKBake } from '../src/engine/core.js';
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

function sprite(filename = 'replacement.png', width = 16, height = 48): ImportedSprite {
  return {
    filename,
    width,
    height,
    bytes: 30,
    format: 'image/png',
    url: `blob:${filename}`,
    blob: new Blob(['binary']),
    image: { width, height } as HTMLImageElement,
    dispose: vi.fn(),
  };
}

function fixture(frame?: string | number, overrideRig?: Rig) {
  const rig =
    overrideRig ??
    new Rig({
      root: 'root',
      bones: [
        {
          id: 'root',
          sprite: {
            texture: 'shared',
            x: 7,
            y: 9,
            originX: 0.1,
            originY: 0.8,
            scaleX: 2,
            ...(frame !== undefined ? { frame } : {}),
          },
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
  const makeTexture = (key: string, width = 16, height = 48) => ({
    key,
    get: () => ({ width, height }),
    getSourceImage: () => ({ src: '/original.png' }),
    has: () => true,
  });
  const original = makeTexture('shared');
  const textures = new Map<string, ReturnType<typeof makeTexture>>([['shared', original]]);
  const add = vi.fn((key: string, image: HTMLImageElement) => {
    const texture = makeTexture(key, image.width, image.height);
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

afterEach(() => vi.unstubAllGlobals());

test('throwing subscribers cannot dispose accepted proposals or interrupt artwork history', async () => {
  const f = fixture();
  const reporter = vi.fn();
  vi.stubGlobal('reportError', reporter);
  const failure = new Error('Subscriber failed');
  f.controller.subscribe(() => {
    throw failure;
  });
  const observer = vi.fn(() => f.controller.getSnapshot());
  f.controller.subscribe(observer);
  await f.controller.import(file());
  assert.strictEqual(f.controller.getSnapshot().proposed, f.next);
  assert.equal(vi.mocked(f.next.dispose).mock.calls.length, 0);
  assert.isFalse(f.controller.getSnapshot().importing);
  f.controller.preview();
  f.controller.apply();
  assert.equal(f.controller.exportReplacements().length, 1);
  assert.isFalse(f.controller.hasPendingProposal);
  assert.equal(vi.mocked(f.next.dispose).mock.calls.length, 0);
  f.controller.undo();
  assert.equal(f.controller.exportReplacements().length, 0);
  f.controller.redo();
  assert.equal(f.controller.exportReplacements().length, 1);
  assert.isAbove(observer.mock.calls.length, 0);
  assert.equal(observer.mock.calls.length, reporter.mock.calls.length);
  assert.isTrue(reporter.mock.calls.every(([error]) => error === failure));
  f.controller.dispose();
  assert.equal(vi.mocked(f.next.dispose).mock.calls.length, 1);
  f.puppet.destroy();
});

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
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared', 'old preview releases its overrides on rebind');
  assert.isFalse(f.textures.has(candidate));
  f.puppet.destroy();
  f.controller.unbind();
  assert.equal(puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.textures.size, 1);
  puppet.destroy();
});

test('incompatible rebind preserves the active artwork, proposal, and controller ownership', async () => {
  const f = fixture();
  f.controller.selectReference('bone:forearm');
  await f.controller.import(file());
  f.controller.preview();
  f.controller.apply();
  const key = f.puppet.getBone('forearm').sprite!.texture.key;
  f.setNext(sprite('proposal.png'));
  await f.controller.import(file());
  const snapshot = f.controller.getSnapshot();
  const incompatible = new Puppet(f.scene, {
    rig: { root: 'root', bones: [{ id: 'root', sprite: { texture: 'shared' } }] },
    autoUpdate: false,
  });
  assert.throws(() => f.controller.bind(f.scene, incompatible, f.definition), /no longer uses/);
  assert.strictEqual(f.controller.getSnapshot(), snapshot);
  assert.equal(f.puppet.getBone('forearm').sprite!.texture.key, key);
  f.controller.cancel();
  f.controller.undo();
  assert.equal(f.puppet.getBone('forearm').sprite!.texture.key, 'shared');
  f.controller.redo();
  assert.notEqual(f.puppet.getBone('forearm').sprite!.texture.key, 'shared');
  f.controller.dispose();
  assert.equal(f.textures.size, 1);
  f.puppet.destroy();
  incompatible.destroy();
});

test.each(['replacement', 'original'] as const)('failed %s refresh rolls back artwork binding', async (failing) => {
  const f = fixture();
  await f.controller.import(file());
  f.controller.preview();
  f.controller.apply();
  const key = f.puppet.getBone('root').sprite!.texture.key;
  const puppet = new Puppet(f.scene, { rig: f.rig, skin: 'a', autoUpdate: false });
  const refreshOld = vi.fn();
  const refreshNew = vi.fn();
  f.controller.bind(f.scene, f.puppet, f.definition, refreshOld);
  (failing === 'original' ? refreshOld : refreshNew).mockImplementationOnce(() => {
    throw new Error('Refresh failed');
  });
  assert.throws(() => f.controller.bind(f.scene, puppet, f.definition, refreshNew), /Refresh failed/);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, key);
  assert.equal(puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.controller.exportReplacements().length, 1);
  f.controller.undo();
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  f.controller.redo();
  assert.notEqual(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(puppet.getBone('root').sprite!.texture.key, 'shared');
  f.controller.dispose();
  assert.equal(f.textures.size, 1);
  f.puppet.destroy();
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

async function replace(
  f: ReturnType<typeof fixture>,
  filename: string,
  width = 16,
  height = 48,
  policy: 'normalized' | 'pixels' | 'manual' = 'normalized',
) {
  f.setNext(sprite(filename, width, height));
  await f.controller.import(file());
  f.controller.setPolicy(policy);
  f.controller.preview();
  assert.isTrue(f.controller.getSnapshot().previewing, f.controller.getSnapshot().message);
  f.controller.apply();
}

test('dimension changes require an explicit policy; pixel pivots compose through v1 → v2 → v3 and revert', async () => {
  const f = fixture();
  const image = f.puppet.getBone('root').sprite!;
  const source = JSON.stringify(f.rig);
  f.setNext(sprite('forearm-v2.png', 32, 96));
  await f.controller.import(file());
  assert.deepEqual(f.controller.getSnapshot().previousSize, { width: 16, height: 48 });
  assert.isNull(f.controller.getSnapshot().policy);
  f.controller.preview();
  assert.equal(image.texture.key, 'shared');
  assert.equal(f.add.mock.calls.length, 0);
  f.controller.setPolicy('pixels');
  f.controller.preview();
  assert.approximately(image.originX, 0.05, 1e-12);
  assert.approximately(image.originY, 0.4, 1e-12);
  f.controller.apply();
  const v2 = image.texture.key;
  await replace(f, 'forearm-v3.png', 64, 192, 'pixels');
  assert.approximately(image.originX * 64, 0.1 * 16, 1e-12);
  assert.approximately(image.originY * 192, 0.8 * 48, 1e-12);
  assert.equal(f.textures.size, 2, 'only original and currently rendered replacement textures remain');
  assert.isFalse(f.textures.has(v2));
  assert.deepEqual([image.x, image.y, image.scaleX], [7, 9, 2]);
  assert.equal(JSON.stringify(f.rig), source);
  f.puppet.setSkin('b').setSkin('a');
  assert.approximately(f.puppet.getSlotImage('arm')!.originX, 0.05, 1e-12);
  f.controller.revert();
  assert.deepEqual([image.originX, image.originY], [0.1, 0.8]);
  assert.equal(f.textures.size, 1);
  f.controller.dispose();
  f.puppet.destroy();
});

test('previewing alternate normalized, pixel and manual policies restores its baseline and invalidates Apply', async () => {
  const f = fixture();
  const image = f.puppet.getBone('root').sprite!;
  f.setNext(sprite('larger.png', 32, 96));
  await f.controller.import(file());
  f.controller.setPolicy('pixels');
  f.controller.preview();
  assert.equal(image.originX, 0.05);
  f.controller.setPolicy('normalized');
  assert.isFalse(f.controller.getSnapshot().previewing);
  f.controller.apply();
  assert.isFalse(f.controller.hasUnsavedChanges);
  assert.equal(image.originX, 0.1);
  f.controller.preview();
  assert.equal(image.originX, 0.1);
  f.controller.setPolicy('manual');
  f.controller.preview();
  assert.equal(image.originX, 0.1);
  assert.include(f.controller.getSnapshot().message, 'realign');
  f.controller.cancel();
  assert.deepEqual([image.originX, image.originY, image.texture.key], [0.1, 0.8, 'shared']);
  f.controller.dispose();
  f.puppet.destroy();
});

test('individual attachment replacement has stable identity across skins and supersedes shared replacement', async () => {
  const f = fixture();
  const authored = JSON.stringify(f.rig);
  const order = f.puppet.getRenderOrder();
  const mount = f.puppet.getSlotImage('arm')!.parentContainer;
  f.puppet.setSlotDepth('arm', 99).setFacing('left');
  f.controller.selectReference('attachment:armA');
  await replace(f, 'unrelated-filename.png', 32, 96, 'pixels');
  const individual = f.puppet.getSlotImage('arm')!.texture.key;
  assert.equal(f.puppet.getAttachment('arm'), 'armA');
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  f.puppet.setSkin('b');
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
  f.controller.selectReference(null);
  await replace(f, 'shared-v2.png');
  const shared = f.puppet.getBone('root').sprite!.texture.key;
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, shared);
  f.puppet.setSkin('a');
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, individual);
  assert.equal(f.puppet.getSlotImage('arm')!.originX, 0.1);
  assert.strictEqual(f.puppet.getSlotImage('arm')!.parentContainer, mount);
  assert.deepEqual(f.puppet.getRenderOrder(), order);
  assert.equal(f.puppet.facingDirection, 'left');
  assert.equal(mount.parentContainer.parentContainer.depth, 99);
  assert.equal(JSON.stringify(f.rig), authored);
  assert.isTrue(f.controller.assetPreview('shared', 'attachment:armA')!.imported);
  f.controller.selectReference('attachment:armA');
  f.controller.revert();
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, shared);
  assert.equal(f.puppet.getSlotImage('arm')!.originX, 0.2);
  f.controller.dispose();
  f.puppet.destroy();
});

test('one bone can replace its artwork without touching attachments or other bones', async () => {
  const f = fixture();
  f.controller.selectReference('bone:forearm');
  await replace(f, 'forearm.png');
  assert.notEqual(f.puppet.getBone('forearm').sprite!.texture.key, 'shared');
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.equal(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
  f.controller.dispose();
  f.puppet.destroy();
});

test('artwork history recreates released textures, restores exact pivots and keeps rig/animation history clean', async () => {
  const f = fixture();
  const animation = new AnimationEditorState(f.rig, [{ name: 'idle', duration: 1000, loop: true, tracks: {} }]);
  const image = f.puppet.getBone('root').sprite!;
  await replace(f, 'v2.png', 32, 96, 'pixels');
  await replace(f, 'v3.png', 64, 192, 'normalized');
  assert.equal(image.originX, 0.05);
  f.controller.undo();
  assert.equal(f.controller.getSnapshot().applied!.filename, 'v2.png');
  assert.equal(image.originX, 0.05);
  assert.equal(f.textures.size, 2);
  f.controller.undo();
  assert.equal(image.texture.key, 'shared');
  assert.equal(image.originX, 0.1);
  assert.isFalse(f.controller.hasUnsavedChanges);
  assert.isTrue(f.controller.getSnapshot().canRedo);
  f.controller.redo();
  assert.equal(image.originX, 0.05);
  f.controller.redo();
  f.controller.revert();
  assert.equal(image.originX, 0.1);
  f.controller.undo();
  assert.equal(image.originX, 0.05);
  assert.equal(f.controller.getSnapshot().applied!.filename, 'v3.png');
  assert.isFalse(animation.dirty);
  assert.isFalse(animation.canUndo);
  assert.equal(f.textures.size, 2);
  f.controller.dispose();
  f.puppet.destroy();
});

test('branched and bounded artwork history disposes unreachable images without stale texture accumulation', async () => {
  const f = fixture();
  await replace(f, 'first.png');
  const first = f.next;
  await replace(f, 'second.png');
  const second = f.next;
  f.controller.undo();
  await replace(f, 'branch.png');
  assert.equal(vi.mocked(second.dispose).mock.calls.length, 1);
  assert.isFalse(f.controller.getSnapshot().canRedo);
  for (let i = 0; i < 22; i++) {
    await replace(f, `revision-${i}.png`);
    assert.equal(f.textures.size, 2);
  }
  assert.equal(vi.mocked(first.dispose).mock.calls.length, 1);
  f.controller.dispose();
  assert.equal(vi.mocked(f.next.dispose).mock.calls.length, 1);
  f.puppet.destroy();
});

test('framed shared artwork is blocked while a whole-image individual reference can replace safely', async () => {
  const f = fixture('arm-frame');
  await f.controller.import(file());
  assert.equal(f.decode.mock.calls.length, 0);
  f.controller.selectReference('bone:forearm');
  await replace(f, 'whole.png');
  assert.equal(f.puppet.getBone('root').sprite!.frame.name, 'arm-frame');
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  f.controller.selectReference('bone:root');
  await f.controller.import(file());
  assert.equal(f.decode.mock.calls.length, 1);
  assert.include(f.controller.getSnapshot().message, 'arm-frame');
  f.controller.dispose();
  f.puppet.destroy();
});

test('runtime replacement rejects missing named/numeric frames before changing any image or override', () => {
  for (const frame of ['frame', 0]) {
    const f = fixture(frame);
    f.textures.set('static', { ...f.original, key: 'static', has: (name?: string) => name === '__BASE' });
    const revision = f.puppet.getAppearanceRevision();
    assert.throws(() => f.puppet.setArtworkTexture('shared', 'static'), /lacks frame/);
    assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
    assert.equal(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
    assert.equal(f.puppet.getAppearanceRevision(), revision);
    assert.isUndefined(f.puppet.getArtworkReplacement('shared'));
    f.controller.dispose();
    f.puppet.destroy();
  }
});

test('failed image installation rolls all images and origins back to the last committed revision', async () => {
  const f = fixture();
  await replace(f, 'committed.png', 32, 96, 'pixels');
  const committed = f.puppet.getBone('root').sprite!.texture.key;
  const slot = f.puppet.getSlotImage('arm')!;
  const original = slot.setTexture.bind(slot);
  slot.setTexture = vi.fn(original).mockImplementationOnce(() => {
    throw new Error('texture upload failed');
  });
  f.setNext(sprite('failed.png', 64, 192));
  await f.controller.import(file());
  f.controller.setPolicy('pixels');
  f.controller.preview();
  assert.isFalse(f.controller.getSnapshot().previewing);
  assert.include(f.controller.getSnapshot().message, 'upload failed');
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, committed);
  assert.equal(f.puppet.getBone('root').sprite!.originX, 0.05);
  assert.equal(slot.texture.key, committed);
  assert.equal(slot.originX, 0.1);
  assert.equal(f.textures.size, 2);
  assert.equal(f.controller.getSnapshot().applied!.filename, 'committed.png');
  f.controller.cancel();
  f.controller.dispose();
  f.puppet.destroy();
});

test('texture registration that throws after cache insertion is cleaned up without committing', async () => {
  const f = fixture();
  const add = f.add.getMockImplementation()!;
  f.add.mockImplementationOnce((key, image) => {
    add(key, image);
    throw new Error('GPU registration failed');
  });
  await f.controller.import(file());
  f.controller.preview();
  assert.equal(f.textures.size, 1);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.isFalse(f.controller.getSnapshot().canUndo);
  assert.include(f.controller.getSnapshot().message, 'GPU');
  f.controller.dispose();
  f.puppet.destroy();
});

test('failed appearance refresh restores main and hidden previews before releasing proposal textures', async () => {
  const f = fixture();
  const state = new AnimationEditorState(f.rig, [{ name: 'idle', duration: 1000, loop: true, tracks: {} }]);
  const layer = new AnimationEditorGhostLayer(f.scene, state, f.puppet);
  const refresh = vi.fn(() => layer.refreshArtwork());
  f.controller.bind(f.scene, f.puppet, f.definition, refresh);
  // Same-puppet binding updates its callback too, without discarding pending artwork.
  await f.controller.import(file());
  refresh.mockImplementationOnce(() => {
    layer.refreshArtwork();
    throw new Error('preview synchronization failed');
  });
  f.controller.preview();
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.isFalse(f.controller.getSnapshot().previewing);
  assert.equal(f.textures.size, 1);
  assert.include(f.controller.getSnapshot().message, 'synchronization');
  f.controller.dispose();
  layer.dispose();
  f.puppet.destroy();
});

test('pixel policy survives rig projection, artwork alignment edits, Cancel and Revert', async () => {
  const f = fixture();
  const editor = new RigEditor(f.scene, f.puppet, () => {});
  editor.state.selectBone('root');
  editor.refresh();
  await replace(f, 'larger.png', 32, 96, 'pixels');
  editor.refresh();
  const image = f.puppet.getBone('root').sprite!;
  assert.equal(image.originX, 0.05);
  assert.deepEqual(editor.getArtworkOriginScale(), { x: 0.5, y: 0.5 });
  editor.editSprite('root', 'originX', 0.3);
  assert.equal(image.originX, 0.15);
  f.controller.revert();
  assert.equal(image.originX, 0.3, 'authored alignment edits survive artwork reversion');
  assert.equal(editor.state.getBone('root').sprite!.originX, 0.3);
  f.controller.dispose();
  f.puppet.destroy();
});

test('live catalogs include newly created attachments and skins and validate newly introduced frames at commit', async () => {
  const f = fixture();
  const attachments = [...f.rig.attachments, { id: 'new-part', texture: 'shared' }];
  const skins = [...f.rig.skins, { version: 1 as const, name: 'new-skin', slots: { arm: 'new-part' } }];
  f.puppet.updateSlotDefinitions(attachments, skins);
  f.controller.refreshTargets();
  assert.include(f.controller.getSnapshot().targets[0]!.references, 'Skin: new-skin');
  assert.include(f.controller.getSnapshot().targets[0]!.references, 'Attachment: new-part');
  f.controller.selectReference('attachment:new-part');
  await replace(f, 'new-part-v2.png');
  f.puppet.setSkin('new-skin');
  assert.notEqual(f.puppet.getSlotImage('arm')!.texture.key, 'shared');
  f.controller.selectReference(null);
  await f.controller.import(file());
  f.controller.preview();
  assert.isTrue(f.controller.getSnapshot().previewing);
  const key = f.puppet.getBone('root').sprite!.texture.key;
  const texture = f.textures.get(key)!;
  texture.has = (frame?: string) => frame === '__BASE';
  f.puppet.updateSlotDefinitions([...attachments, { id: 'framed', texture: 'shared', frame: 'absent' }], skins);
  f.controller.apply();
  assert.include(f.controller.getSnapshot().message, 'lacks frame');
  assert.equal(f.controller.getSnapshot().pendingCount, 1, 'failed commit never installs the shared proposal');
  f.controller.cancel();
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  f.controller.dispose();
  f.puppet.destroy();
});

test('idle, walk, attack, IK, baked IK and mirrored motion preserve every sampled joint and animation document', async () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', sprite: { texture: 'shared' } },
      { id: 'upper', parent: 'root', x: 10 },
      { id: 'forearm', parent: 'upper', y: 60, sprite: { texture: 'shared', originX: 0.1 } },
      { id: 'hand', parent: 'forearm', y: 50 },
      { id: 'otherUpper', parent: 'root', x: -10 },
      { id: 'otherForearm', parent: 'otherUpper', y: 60, sprite: { texture: 'shared' } },
      { id: 'otherHand', parent: 'otherForearm', y: 50 },
    ],
    slots: [{ id: 'arm', bone: 'forearm', depth: 25 }],
    attachments: [
      { id: 'armA', texture: 'shared', originX: 0.2 },
      { id: 'armB', texture: 'shared' },
    ],
    skins: [
      { version: 1, name: 'a', slots: { arm: 'armA' } },
      { version: 1, name: 'b', slots: { arm: 'armB' } },
    ],
    ik: [{ name: 'armIK', rootBone: 'upper', middleBone: 'forearm', endBone: 'hand' }],
  });
  const attack: AnimationClip = {
    name: 'attack',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 8 },
      ],
    },
    ikTracks: {
      armIK: [
        { time: 0, x: 70, y: 70 },
        { time: 1000, x: 40, y: 90 },
      ],
    },
  };
  const samples = sampleIKBake(attack, rig, ['armIK'], { fps: 12 });
  const plan = generateBakedBoneKeys(samples, rig, { animation: attack });
  const baked = commitIKBake(attack, plan, rig);
  assert.isTrue(baked.success, JSON.stringify(baked.issues));
  if (!baked.success) throw new Error('Bake failed');
  const symmetry = createBoneSymmetryMapping(rig, {
    manualPairs: [
      { leftBoneId: 'upper', rightBoneId: 'otherUpper' },
      { leftBoneId: 'forearm', rightBoneId: 'otherForearm' },
      { leftBoneId: 'hand', rightBoneId: 'otherHand' },
    ],
  });
  if (!symmetry.success) throw new Error('Symmetry failed');
  const mirrored = mirrorSelectedKeyframes(
    baked.animation,
    rig,
    symmetry.mapping,
    ['upper', 'forearm'].flatMap((boneId) =>
      baked.animation.tracks[boneId]!.map((key) => ({ boneId, property: 'rotation' as const, timeMs: key.time })),
    ),
    'left-to-right',
  );
  const animations = [
    { name: 'idle', duration: 1000, loop: true, tracks: {} },
    {
      name: 'walk',
      duration: 1000,
      loop: true,
      tracks: {
        forearm: [
          { time: 0, rotation: -0.4 },
          { time: 1000, rotation: 0.4 },
        ],
      },
    },
    attack,
    { ...baked.animation, name: 'baked' },
    { ...mirrored.animation, name: 'mirrored' },
  ];
  const f = fixture(undefined, rig);
  const state = new AnimationEditorState(rig, animations);
  const preview = new AnimationEditorPreview(state, f.puppet);
  const ghosts = new AnimationEditorGhostLayer(f.scene, state, f.puppet);
  const mirrorOverlay = new AnimationPoseOverlay(f.scene, f.puppet, 'mirror', 0);
  const bakeOverlay = new AnimationPoseOverlay(f.scene, f.puppet, 'bake', 0);
  f.controller.bind(f.scene, f.puppet, f.definition, () => {
    ghosts.refreshArtwork();
    mirrorOverlay.syncAppearance(f.puppet, DEFAULT_ONION_SKIN_SETTINGS, f.puppet.getAppearanceRevision());
    bakeOverlay.syncAppearance(f.puppet, DEFAULT_ONION_SKIN_SETTINGS, f.puppet.getAppearanceRevision());
  });
  const before = JSON.stringify(animations);
  const pose = () => rig.bones.map((bone) => ({ ...f.puppet.getBone(bone.id).pose }));
  const expected = new Map<string, ReturnType<typeof pose>>();
  for (const animation of animations)
    for (const time of [0, 0.25, 0.5, 0.999]) {
      state.selectAnimation(animation.name);
      state.setCurrentTime(time);
      expected.set(`${animation.name}:${time}`, pose());
    }
  await replace(f, 'redrawn-forearm.png', 32, 96, 'pixels');
  const textureKey = f.puppet.getBone('forearm').sprite!.texture.key;
  const registrations = f.add.mock.calls.length;
  ghosts.setSettings({ enabled: true });
  f.puppet.setFacing('left');
  for (let repeat = 0; repeat < 3; repeat++)
    for (const animation of animations) {
      state.selectAnimation(animation.name);
      for (const time of [0, 0.25, 0.5, 0.999]) {
        state.setCurrentTime(time);
        assert.deepEqual(pose(), expected.get(`${animation.name}:${time}`), `${animation.name} at ${time}`);
        assert.equal(f.puppet.getBone('forearm').sprite!.texture.key, textureKey);
        assert.equal(f.puppet.getSlotImage('arm')!.texture.key, textureKey);
      }
      state.setCurrentTime(0);
      state.play();
      state.advancePlayback(0.25);
      state.pause();
      assert.deepEqual(pose(), expected.get(`${animation.name}:0.25`));
    }
  assert.equal(f.add.mock.calls.length, registrations, 'playback never re-registers textures');
  assert.equal(JSON.stringify(animations), before);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  ghosts.setSettings({ enabled: false });
  mirrorOverlay.hide();
  bakeOverlay.hide();
  f.controller.revert();
  assert.equal(f.textures.size, 1);
  assert.deepEqual(pose(), expected.get('mirrored:0.25'));
  f.controller.dispose();
  ghosts.dispose();
  mirrorOverlay.destroy();
  bakeOverlay.destroy();
  preview.dispose();
  f.puppet.destroy();
});

test('normalized convenience API preserves the current fractional pivot after pixel migration', async () => {
  const f = fixture();
  await replace(f, 'larger.png', 32, 96, 'pixels');
  const image = f.puppet.getBone('root').sprite!;
  const origin = [image.originX, image.originY];
  f.textures.set('host-art', { ...f.original, key: 'host-art' });
  f.puppet.setArtworkTexture('shared', 'host-art');
  assert.deepEqual([image.originX, image.originY], origin);
  f.puppet.setArtworkTexture('shared');
  assert.deepEqual([image.originX, image.originY], [0.1, 0.8]);
  f.controller.dispose();
  f.puppet.destroy();
});

test('failed undo preserves history and applied revision and collects any failed target texture', async () => {
  const f = fixture();
  await replace(f, 'v2.png', 32, 96, 'pixels');
  await replace(f, 'v3.png', 64, 192, 'pixels');
  const image = f.puppet.getBone('root').sprite!;
  const currentKey = image.texture.key;
  const add = f.add.getMockImplementation()!;
  f.add.mockImplementationOnce((key, imported) => {
    add(key, imported);
    throw new Error('Undo registration failed');
  });
  f.controller.undo();
  assert.equal(image.texture.key, currentKey);
  assert.equal(image.originX, 0.025);
  assert.equal(f.controller.getSnapshot().applied!.filename, 'v3.png');
  assert.isTrue(f.controller.getSnapshot().canUndo);
  assert.isFalse(f.controller.getSnapshot().canRedo);
  assert.equal(f.textures.size, 2);
  f.controller.undo();
  assert.equal(f.controller.getSnapshot().applied!.filename, 'v2.png');
  assert.equal(image.originX, 0.05);
  f.controller.dispose();
  f.puppet.destroy();
});

test('failed refresh and rollback retain textures until successful recovery moves every consumer away', async () => {
  const f = fixture();
  const refresh = vi.fn(() => {});
  f.controller.bind(f.scene, f.puppet, f.definition, refresh);
  await f.controller.import(file());
  refresh.mockImplementation(() => {
    throw new Error('consumer failed');
  });
  f.controller.preview();
  assert.include(f.controller.getSnapshot().message, 'rollback failed');
  assert.equal(f.textures.size, 2, 'uncertain retained preview references prohibit texture destruction');
  assert.isFalse(f.controller.hasUnsavedChanges);
  refresh.mockImplementation(() => {});
  f.controller.cancel();
  assert.equal(f.textures.size, 1);
  assert.equal(f.puppet.getBone('root').sprite!.texture.key, 'shared');
  assert.isNull(f.controller.getSnapshot().proposed);
  f.controller.dispose();
  f.puppet.destroy();
});

test('package snapshots expose applied binaries without runtime keys and block unfinished proposals', async () => {
  const { controller, puppet, next } = fixture();
  const authored = JSON.stringify(puppet.rig);
  await controller.import({} as File);
  assert.isTrue(controller.hasPendingChanges);
  assert.throws(() => controller.exportReplacements(), /Apply or cancel/);
  controller.preview();
  controller.apply();
  const replacements = controller.exportReplacements();
  assert.lengthOf(replacements, 1);
  assert.strictEqual(replacements[0]!.blob, next.blob);
  assert.equal(replacements[0]!.assetKey, 'shared');
  assert.notInclude(JSON.stringify(replacements), '__paper_artwork_');
  assert.notInclude(JSON.stringify(replacements), 'blob:');
  replacements[0]!.originScaleX = 99;
  assert.equal(controller.exportReplacements()[0]!.originScaleX, 1);
  controller.revert();
  assert.deepEqual(controller.exportReplacements(), []);
  controller.undo();
  assert.strictEqual(controller.exportReplacements()[0]!.blob, next.blob);
  assert.equal(JSON.stringify(puppet.rig), authored);
  controller.dispose();
  assert.isFalse(controller.hasPendingChanges);
});
