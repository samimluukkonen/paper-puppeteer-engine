import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { normalizedOrigin, originPixels, textureOriginAt } from '../src/devtools/rig-editor/artworkAlignment.js';
import { localToWorld, type Affine } from '../src/devtools/rig-editor/coordinates.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import type { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import type { EditMode } from '../src/devtools/rig-editor/RigEditorState.js';
import { composeAffine, transformToAffine } from '../src/engine/affineMath.js';
import { compileClip, type CompiledClip } from '../src/engine/AnimationClip.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());
const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const clipSnapshot = (clip: CompiledClip) =>
  JSON.stringify({
    ...clip,
    tracks: clip.tracks.map((track) => ({ ...track, properties: [...track.properties] })),
    ikTracks: clip.ikTracks?.map((track) => ({ ...track, properties: [...track.properties] })),
  });

function fixture(mode: EditMode = 'sprite', attachment = false, facing = 1) {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', rotation: 0.3 },
      {
        id: 'arm',
        parent: 'root',
        x: 10,
        y: 20,
        rotation: -0.5,
        sprite: { texture: 'part', x: 2, y: -3, originX: 0.2, originY: 0.7, scaleX: 1.2 },
      },
      { id: 'hand', parent: 'arm', y: 30 },
    ],
    ik: [{ name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand' }],
    slots: [{ id: 'visual', bone: 'arm', x: 4, y: 5, rotation: 0.4, scaleX: 0.7, scaleY: 1.4 }],
    attachments: [{ id: 'art', texture: 'part', x: 2, y: -3, originX: 0.2, originY: 0.7 }],
  });
  const clip = {
    name: 'bend',
    duration: 100,
    loop: false,
    tracks: {
      arm: [
        { time: 0, rotation: 0 },
        { time: 100, rotation: 1 },
      ],
    },
    events: [{ time: 50, name: 'unchanged' }],
    ikTracks: {
      armIK: [
        { time: 0, x: 10, y: 20 },
        { time: 100, x: 30, y: 40 },
      ],
    },
  };
  const compiled = compileClip(clip, rig);
  const clipBefore = clipSnapshot(compiled);
  const root = new Joint('root', rig.getBone('root'));
  const arm = new Joint('arm', rig.getBone('arm'));
  // Nested parent rotation, nonuniform puppet scaling and facing. Render mounts use
  // the composed bone matrix, matching the engine's flattened artwork branches.
  const placement = { a: facing * 2, b: 0, c: 0, d: 1.5, tx: 380, ty: 435 };
  const rootMatrix = composeAffine(transformToAffine(root.pose, identity()), placement, identity());
  const armMatrix = composeAffine(transformToAffine(arm.pose, identity()), rootMatrix, identity());
  const slotMatrix = composeAffine(
    transformToAffine({ x: 4, y: 5, rotation: 0.4, scaleX: 0.7, scaleY: 1.4 }, identity()),
    armMatrix,
    identity(),
  );
  const frame = (matrix: Affine) => ({ getWorldTransformMatrix: () => matrix });
  const mount = frame(attachment ? slotMatrix : armMatrix);
  const image = {
    x: 2,
    y: -3,
    width: 137,
    height: 251,
    originX: 0.2,
    originY: 0.7,
    parentContainer: mount,
    visible: true,
    scaleX: 1.2,
    scaleY: 1,
    getWorldTransformMatrix() {
      return composeAffine(
        { a: this.scaleX, b: 0, c: 0, d: this.scaleY, tx: this.x, ty: this.y },
        mount.getWorldTransformMatrix(),
        identity(),
      );
    },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    },
    setOrigin(x: number, y: number) {
      this.originX = x;
      this.originY = y;
      return this;
    },
    setAlpha() {
      return this;
    },
    getIndexList: () => [0],
  };
  const bones = {
    hand: Object.assign(new Joint('hand', rig.getBone('hand')), {
      container: { ...frame(armMatrix), parentContainer: frame(armMatrix) },
    }),
    root: Object.assign(root, { container: { ...frame(rootMatrix), parentContainer: frame(placement) } }),
    arm: Object.assign(arm, {
      sprite: attachment ? undefined : image,
      container: { ...frame(armMatrix), parentContainer: frame(rootMatrix) },
    }),
  };
  const puppet = {
    getArtworkReplacement: () => undefined,
    setArtworkOrigin: (_reference: string, _asset: string, image: Phaser.GameObjects.Image, x: number, y: number) =>
      image.setOrigin(x, y),
    rig,
    container: { ...frame(placement), x: 380, y: 435, parentContainer: null },
    getBone: (id: string) => bones[id as keyof typeof bones],
    getAttachment: () => (attachment ? 'art' : undefined),
    getSlotImage: () => (attachment ? image : undefined),
    getSlotMesh: () => undefined,
    preparePose: vi.fn(),
    syncPose: vi.fn(),
    setSlotTransform: vi.fn(),
    setRenderOrder: vi.fn(),
    setFacing: vi.fn(),
  };
  const input = new EventEmitter();
  const camera = { getWorldPoint: (x: number, y: number) => ({ x: x / 2 + 30, y: y / 2 - 20 }) };
  const scene = {
    cameras: { main: camera },
    input: { on: (name: string, fn: (p: unknown) => void, ctx: unknown) => input.on(name, fn.bind(ctx)), off: vi.fn() },
  };
  const editor = new RigEditor(
    scene as unknown as Phaser.Scene,
    puppet as unknown as Puppet,
    vi.fn(),
    undefined,
    [],
    [compiled],
  );
  editor.state.editMode = mode;
  const selection = attachment ? { type: 'slot' as const, id: 'visual' } : { type: 'bone' as const, id: 'arm' };
  editor.state.selection = selection;
  editor.refresh();
  const overlay = { pick: () => selection };
  const controller = new RigEditorInputController(
    scene as unknown as Phaser.Scene,
    puppet as unknown as Puppet,
    editor,
    overlay as unknown as RigEditorOverlay,
    vi.fn(),
    vi.fn(),
  );
  controller.enable();
  const emit = (name: string, world: { x: number; y: number }, id = 1) =>
    input.emit(name, {
      id,
      x: (world.x - 30) * 2,
      y: (world.y + 20) * 2,
      isDown: true,
      leftButtonDown: () => true,
      middleButtonDown: () => false,
    });
  const sprite = () => (attachment ? editor.state.getAttachment('art') : editor.state.getBone('arm').sprite!);
  return { editor, controller, emit, image, mount, browser, sprite, compiled, clipBefore, clip, arm, puppet };
}

test.each([1, -1])('artwork drag uses nested render mounts, zoom/pan and facing %s, then commits once', (facing) => {
  for (const attachment of [false, true]) {
    const f = fixture('sprite', attachment, facing);
    const before = f.editor.state.workingCopy;
    const json = f.editor.exportJson(false);
    const start = localToWorld({ x: 2, y: -3 }, f.mount.getWorldTransformMatrix());
    f.emit('pointerdown', start);
    f.emit('pointermove', localToWorld({ x: 14.123456789, y: 7.456789123 }, f.mount.getWorldTransformMatrix()));
    assert.strictEqual(f.editor.state.workingCopy, before);
    assert.equal(f.editor.exportJson(false), json);
    assert.closeTo(f.image.x, 14.123456789, 1e-12);
    assert.closeTo(f.image.y, 7.456789123, 1e-12);
    f.emit('pointerup', start, 2);
    assert.isFalse(f.editor.state.canUndo);
    f.emit('pointerupoutside', start);
    assert.equal(f.editor.state.historyLength, 1);
    assert.closeTo(f.sprite().x!, 14.123456789, 1e-12);
    assert.deepEqual(
      f.editor.state.getBone('arm'),
      attachment
        ? before.bones[1]
        : { ...before.bones[1], sprite: { ...before.bones[1]!.sprite, x: f.sprite().x, y: f.sprite().y } },
    );
    assert.deepEqual(f.editor.state.workingCopy.slots, before.slots);
    const reloaded = parseRigDefinition(JSON.parse(f.editor.exportJson(false)));
    assert.deepEqual(attachment ? reloaded.getAttachment('art') : reloaded.getBone('arm').sprite, f.sprite());
    f.editor.undo();
    assert.equal(f.image.x, 2);
    f.editor.redo();
    assert.closeTo(f.image.x, 14.123456789, 1e-12);
    f.controller.disable();
  }
});

test.each([1, -1])(
  'origin drag uses captured texture dimensions and leaves offsets/joints fixed with facing %s',
  (facing) => {
    const f = fixture('origin', true, facing);
    const before = f.editor.state.workingCopy;
    const matrix = f.image.getWorldTransformMatrix();
    f.emit('pointerdown', localToWorld({ x: 0, y: 0 }, matrix));
    f.emit('pointermove', localToWorld({ x: 137 * (0.3 - 0.2), y: 251 * (0.4 - 0.7) }, matrix));
    assert.closeTo(f.image.originX, 0.3, 1e-12);
    // Preview changed the image origin; further conversion still uses the start snapshot.
    f.emit('pointermove', localToWorld({ x: 137 * (0.25 - 0.2), y: 251 * (0.5 - 0.7) }, matrix));
    assert.strictEqual(f.editor.state.workingCopy, before);
    f.emit('pointerup', localToWorld({ x: 0, y: 0 }, matrix));
    assert.closeTo(f.sprite().originX!, 0.25, 1e-12);
    assert.closeTo(f.sprite().originY!, 0.5, 1e-12);
    assert.equal(f.sprite().x, 2);
    assert.equal(f.sprite().y, -3);
    assert.deepEqual(f.editor.state.workingCopy.bones, before.bones);
    assert.deepEqual(f.editor.state.workingCopy.slots, before.slots);
    f.editor.undo();
    assert.equal(f.image.originX, 0.2);
    f.editor.redo();
    assert.closeTo(f.image.originX, 0.25, 1e-12);
    f.controller.disable();
  },
);

test.each(['joint', 'slot', 'sprite', 'origin'] as const)('%s cancelled gestures preserve data and redo', (mode) => {
  for (const finish of ['escape', 'blur', 'hidden', 'pagehide', 'disable']) {
    const f = fixture(mode, mode === 'slot' || mode === 'origin');
    f.editor.state.editSpriteFields(
      mode === 'slot' || mode === 'origin' ? 'art' : 'arm',
      { x: 6 },
      mode === 'slot' || mode === 'origin',
    );
    f.editor.undo();
    const json = f.editor.exportJson(false);
    const start = localToWorld({ x: 2, y: -3 }, f.mount.getWorldTransformMatrix());
    f.emit('pointerdown', start);
    f.emit('pointermove', { x: start.x + 20, y: start.y + 10 });
    if (finish === 'disable') f.controller.disable();
    else if (finish === 'escape') {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { key: 'Escape' });
      f.browser.dispatchEvent(event);
    } else {
      if (finish === 'hidden') Object.assign(document, { visibilityState: 'hidden' });
      f.browser.dispatchEvent(new Event(finish === 'hidden' ? 'visibilitychange' : finish));
    }
    f.emit('pointerup', start);
    assert.equal(f.editor.exportJson(false), json, `${mode} / ${finish}`);
    assert.isTrue(f.editor.state.canRedo);
    assert.equal(f.editor.state.historyLength, 0);
    assert.equal(f.image.x, 2);
    assert.equal(f.image.originX, 0.2);
    f.controller.disable();
  }
});

test('pixel origins retain full precision and reflect replacement dimensions', () => {
  const pixels = 13.123456789;
  assert.equal(originPixels(normalizedOrigin(pixels, 137), 137), pixels);
  assert.notEqual(normalizedOrigin(pixels, 137), normalizedOrigin(pixels, 333));
  assert.throws(() => normalizedOrigin(1, 0));
  assert.throws(() => normalizedOrigin(-1, 100));
  assert.throws(() => normalizedOrigin(101, 100));
  assert.isUndefined(textureOriginAt({ x: 0, y: 0 }, { ...identity(), a: 0 }, { x: 0.5, y: 0.5 }, { x: 137, y: 251 }));
});

test.each(['joint', 'slot', 'sprite', 'origin'] as const)('keyboard movement respects explicit %s mode', (mode) => {
  const f = fixture(mode, true);
  const before = f.editor.state.workingCopy;
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: 'ArrowRight' });
  f.browser.dispatchEvent(event);
  assert.deepEqual(f.editor.state.workingCopy.bones, before.bones);
  if (mode === 'sprite') {
    assert.equal(f.sprite().x, 3);
    assert.deepEqual(f.editor.state.workingCopy.slots, before.slots);
  } else if (mode === 'slot') {
    assert.equal(f.editor.state.getSlot('visual').x, 5);
    assert.deepEqual(f.editor.state.workingCopy.attachments, before.attachments);
  } else {
    assert.strictEqual(f.editor.state.workingCopy, before);
    assert.isFalse(event.defaultPrevented);
  }
  f.controller.disable();
});

test('artwork mode does not move a joint when its artwork is unavailable', () => {
  const f = fixture();
  Object.assign(f.puppet.getBone('arm'), { sprite: undefined });
  const before = f.editor.exportJson(false);
  const start = localToWorld({ x: 0, y: 0 }, f.mount.getWorldTransformMatrix());
  f.emit('pointerdown', start);
  f.emit('pointermove', { x: start.x + 20, y: start.y + 20 });
  f.emit('pointerup', start);
  assert.equal(f.editor.exportJson(false), before);
  assert.equal(f.editor.state.historyLength, 0);
  f.controller.disable();
});

test('unchanged artwork proposals and click jitter do not add overrides or history', () => {
  const f = fixture();
  const before = f.editor.state.workingCopy;
  f.editor.previewArtwork('arm', { x: 2, y: -3 });
  f.editor.finishArtworkGesture(true);
  assert.strictEqual(f.editor.state.workingCopy, before);
  const start = localToWorld({ x: 2, y: -3 }, f.mount.getWorldTransformMatrix());
  f.emit('pointerdown', start);
  f.emit('pointermove', { x: start.x + 0.1, y: start.y });
  f.emit('pointerup', start);
  assert.strictEqual(f.editor.state.workingCopy, before);
  assert.equal(f.editor.state.historyLength, 0);
  assert.throws(() => f.editor.previewArtwork('arm', { originX: 2 }), /Origin/);
  assert.throws(() => f.editor.previewArtwork('arm', { x: Infinity }), /finite/);
  f.controller.disable();
});

test('pose sampling and facing leave animation keys/events/timing and rig data unchanged', () => {
  const f = fixture();
  const before = f.editor.exportJson(false);
  f.editor.setPreviewPose('bend', 50);
  assert.equal(f.arm.pose.rotation, 0.5);
  f.editor.setFacing('left');
  assert.equal(f.editor.state.facing, 'left');
  assert.equal(f.editor.exportJson(false), before);
  assert.equal(clipSnapshot(f.compiled), f.clipBefore);
  assert.deepEqual(f.clip.tracks.arm, [
    { time: 0, rotation: 0 },
    { time: 100, rotation: 1 },
  ]);
  assert.deepEqual(f.clip.events, [{ time: 50, name: 'unchanged' }]);
  f.editor.editSprite('arm', 'originX', normalizedOrigin(13.123456789, 137));
  assert.equal(f.arm.pose.rotation, 0.5);
  assert.equal(clipSnapshot(f.compiled), f.clipBefore);
  f.editor.setPreviewPose('');
  assert.equal(f.arm.pose.rotation, -0.5);
  f.controller.disable();
});
