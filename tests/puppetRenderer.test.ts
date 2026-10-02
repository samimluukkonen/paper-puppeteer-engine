import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import type { Bone } from '../src/engine/Bone.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';

vi.mock('phaser', () => ({ default: {} }));

function fixture(depth?: number) {
  const containers = new Map<string, Phaser.GameObjects.Container>();
  const makeContainer = (x = 0, y = 0) => {
    const container = {
      depth: 0,
      x,
      y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      setName(name: string) {
        containers.set(name, this as unknown as Phaser.GameObjects.Container);
        return this;
      },
      setDepth(depth: number) {
        this.depth = depth;
        return this;
      },
      add: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      setPosition: vi.fn(function (this: Phaser.GameObjects.Container, x: number, y: number) {
        this.x = x;
        this.y = y;
        return this;
      }),
      setRotation: vi.fn(function (this: Phaser.GameObjects.Container, rotation: number) {
        this.rotation = rotation;
        return this;
      }),
      setScale: vi.fn(function (this: Phaser.GameObjects.Container, x: number, y = x) {
        this.scaleX = x;
        this.scaleY = y;
        return this;
      }),
      setAlpha: vi.fn().mockReturnThis(),
      setVisible: vi.fn().mockReturnThis(),
    };
    return container as unknown as Phaser.GameObjects.Container;
  };
  const scene = { add: { container: makeContainer } } as unknown as Phaser.Scene;
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'hand', parent: 'root' }],
    slots: [
      { id: 'item', bone: 'root', x: 3, y: 4, rotation: 0.5, scaleX: 2, scaleY: 3 },
      { id: 'fixed', bone: 'root', depth: 40 },
      { id: 'automatic', bone: 'hand', ...(depth === undefined ? {} : { depth }) },
    ],
  });
  const bones = new Map(
    rig.bones.map((bone) => [
      bone.id,
      { id: bone.id, parentId: bone.parent, container: makeContainer() } as unknown as Bone,
    ]),
  );
  const renderer = new PuppetRenderer(scene, makeContainer(), rig, bones);
  const slotDepth = (id: string) => containers.get(`render-slot-${id}`)!.depth;
  return { renderer, rig, slotDepth, containers };
}

function slotTransform(renderer: PuppetRenderer, id: string) {
  const { x, y, rotation, scaleX, scaleY } = renderer.getSlotMount(id);
  return { x, y, rotation, scaleX, scaleY };
}

test.each([{ x: 8 }, { y: 0 }, { rotation: 0 }, { scaleX: 0 }, { scaleY: -2 }, {}])(
  'slot transform update %j preserves omitted values',
  (values) => {
    const { renderer } = fixture();
    const initial = { x: 3, y: 4, rotation: 0.5, scaleX: 2, scaleY: 3 };
    assert.deepEqual(slotTransform(renderer, 'item'), initial);
    renderer.setSlotTransform('item', values);
    assert.deepEqual(slotTransform(renderer, 'item'), { ...initial, ...values });
  },
);

test('successive partial slot transforms preserve runtime values and allow complete replacement', () => {
  const { renderer } = fixture();
  renderer.setSlotTransform('item', { x: 8, scaleX: -2 });
  renderer.setSlotTransform('item', { y: 9, rotation: 1 });
  renderer.setSlotTransform('item', { scaleY: 4 });
  assert.deepEqual(slotTransform(renderer, 'item'), { x: 8, y: 9, rotation: 1, scaleX: -2, scaleY: 4 });
  renderer.setSlotTransform('item', {});
  assert.deepEqual(slotTransform(renderer, 'item'), { x: 8, y: 9, rotation: 1, scaleX: -2, scaleY: 4 });
  renderer.setSlotTransform('item', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  assert.deepEqual(slotTransform(renderer, 'item'), { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  assert.throws(() => renderer.setSlotTransform('missing', {}), /Unknown slot/);
});

test('slot transforms synchronize immediately by default and can defer synchronization for a batch', () => {
  const { renderer } = fixture();
  const syncPose = vi.fn();
  const puppet = { renderer, syncPose, setSlotTransform: Puppet.prototype.setSlotTransform } as unknown as Puppet;
  assert.strictEqual(puppet.setSlotTransform('item', { x: 8 }), puppet);
  assert.equal(syncPose.mock.calls.length, 1);
  syncPose.mockClear();
  puppet.setSlotTransform('item', { y: 9 }, false);
  puppet.setSlotTransform('automatic', { x: 10 }, false);
  assert.equal(syncPose.mock.calls.length, 0);
  puppet.syncPose();
  assert.equal(syncPose.mock.calls.length, 1);
  assert.equal(slotTransform(renderer, 'item').y, 9);
  assert.equal(slotTransform(renderer, 'automatic').x, 10);
});

test('editor restores omitted slot transform defaults through undo and reset', () => {
  const { renderer, rig } = fixture();
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const puppet = {
    rig,
    renderer,
    getBone: (id: string) => joints.get(id)!,
    preparePose: vi.fn(),
    syncPose: vi.fn(),
    setRenderOrder: Puppet.prototype.setRenderOrder,
    setSlotTransform: Puppet.prototype.setSlotTransform,
    setSlotDepth: Puppet.prototype.setSlotDepth,
    clearSlotDepth: Puppet.prototype.clearSlotDepth,
    getSlotImage: vi.fn(),
    getAttachment: vi.fn(),
  } as unknown as Puppet;
  const editor = new RigEditor({} as Phaser.Scene, puppet, vi.fn());
  const syncPose = vi.mocked(puppet.syncPose);
  const defaults = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  for (const field of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) {
    syncPose.mockClear();
    editor.editSlot('automatic', field, 8);
    assert.equal(syncPose.mock.calls.length, 1, 'refresh synchronizes once for all three slots');
    assert.deepEqual(slotTransform(renderer, 'automatic'), { ...defaults, [field]: 8 });
    editor.undo();
    assert.deepEqual(slotTransform(renderer, 'automatic'), defaults);
    editor.redo();
    assert.deepEqual(slotTransform(renderer, 'automatic'), { ...defaults, [field]: 8 });
    editor.state.selectSlot('automatic');
    editor.resetSelected();
    assert.deepEqual(slotTransform(renderer, 'automatic'), defaults);
  }
});

test.each([50, 0, -5])('render order changes preserve runtime slot depth %s', (depth) => {
  const { renderer, rig, slotDepth } = fixture();
  assert.equal(slotDepth('item'), 1);
  assert.equal(slotDepth('fixed'), 40);
  assert.equal(slotDepth('automatic'), 11);

  renderer.setSlotDepth('item', depth);
  renderer.setOrder(['hand', 'root']);
  assert.equal(slotDepth('item'), depth);
  assert.equal(slotDepth('fixed'), 40);
  assert.equal(slotDepth('automatic'), 1);

  renderer.setSlotDepth('fixed', 0);
  renderer.setOrder(rig.renderOrder);
  assert.equal(slotDepth('item'), depth);
  assert.equal(slotDepth('fixed'), 0);
  assert.equal(slotDepth('automatic'), 11);
  assert.equal(rig.slots[0]!.depth, undefined);
  assert.equal(rig.slots[1]!.depth, 40);

  renderer.setSlotDepth('item', 25);
  renderer.setOrder(['hand', 'root']);
  assert.equal(slotDepth('item'), 25);
  assert.throws(() => renderer.setSlotDepth('missing', 10), /Unknown slot/);
});

test('render order batches explicit and restored slot depths with one sort', () => {
  const { renderer, rig, slotDepth, containers } = fixture();
  const puppet = { renderer, setRenderOrder: Puppet.prototype.setRenderOrder } as unknown as Puppet;
  renderer.setSlotDepth('item', 50);
  renderer.setSlotDepth('fixed', -5);
  renderer.setSlotDepth('automatic', 25);
  const sort = vi.mocked(containers.get('puppet-render')!.sort);
  sort.mockClear();
  const order = vi.spyOn(renderer, 'setOrder');
  assert.strictEqual(
    puppet.setRenderOrder(
      ['hand', 'root'],
      new Map([
        ['item', undefined],
        ['fixed', 0],
      ]),
    ),
    puppet,
  );
  assert.equal(order.mock.calls.length, 1);
  assert.equal(sort.mock.calls.length, 1);
  assert.equal(slotDepth('item'), 11);
  assert.equal(slotDepth('fixed'), 0);
  assert.equal(slotDepth('automatic'), 25, 'omitted overrides are preserved');
  assert.isUndefined(rig.slots[0]!.depth);
  assert.equal(rig.slots[1]!.depth, 40);

  sort.mockClear();
  assert.throws(() => puppet.setRenderOrder(rig.renderOrder, new Map([['fixed', Number.NaN]])), /finite/);
  assert.throws(
    () =>
      puppet.setRenderOrder(
        rig.renderOrder,
        new Map([
          ['fixed', 99],
          ['missing', 1],
        ]),
      ),
    /Unknown slot/,
  );
  assert.throws(() => puppet.setRenderOrder(['root'], new Map([['fixed', 99]])), /every bone/);
  assert.equal(sort.mock.calls.length, 0);
  assert.deepEqual(renderer.getOrder(), ['hand', 'root']);
  assert.equal(slotDepth('fixed'), 0);
  renderer.setOrder(rig.renderOrder);
  assert.equal(slotDepth('fixed'), 0, 'invalid batches do not change overrides');
});

test.each([50, 0, -5])('clearing depth override %s restores defaults and follows the current render order', (depth) => {
  const { renderer, rig, slotDepth } = fixture();
  renderer.setSlotDepth('item', depth);
  renderer.setSlotDepth('fixed', depth);
  renderer.setSlotDepth('automatic', 25);
  renderer.setOrder(['hand', 'root']);

  renderer.clearSlotDepth('item');
  assert.equal(slotDepth('item'), 11);
  assert.equal(slotDepth('fixed'), depth);
  assert.equal(slotDepth('automatic'), 25);
  renderer.clearSlotDepth('fixed');
  assert.equal(slotDepth('fixed'), 40);
  renderer.clearSlotDepth('item');
  assert.equal(slotDepth('item'), 11);

  renderer.setOrder(rig.renderOrder);
  assert.equal(slotDepth('item'), 1);
  assert.equal(slotDepth('fixed'), 40);
  assert.equal(slotDepth('automatic'), 25);
  assert.equal(rig.slots[0]!.depth, undefined);
  assert.equal(rig.slots[1]!.depth, 40);
  assert.throws(() => renderer.clearSlotDepth('missing'), /Unknown slot/);
});

test.each([undefined, 0, -5, 40])(
  'editor restores slot depth %s in export and preview through history and reset',
  (depth) => {
    const { renderer, rig, slotDepth, containers } = fixture(depth);
    const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const puppet = {
      rig,
      renderer,
      getBone: (id: string) => joints.get(id)!,
      preparePose: vi.fn(),
      syncPose: vi.fn(),
      setRenderOrder: Puppet.prototype.setRenderOrder,
      setSlotTransform: Puppet.prototype.setSlotTransform,
      setSlotDepth: Puppet.prototype.setSlotDepth,
      clearSlotDepth: Puppet.prototype.clearSlotDepth,
      getSlotImage: vi.fn(),
      getAttachment: vi.fn(),
    } as unknown as Puppet;
    const editor = new RigEditor({} as Phaser.Scene, puppet, vi.fn());
    const sort = vi.mocked(containers.get('puppet-render')!.sort);
    sort.mockClear();
    const order = vi.spyOn(renderer, 'setOrder');
    const assertDepth = (expected: number | undefined, automatic = 11) => {
      assert.equal(editor.exportRig(false).slots!.find((slot) => slot.id === 'automatic')!.depth, expected);
      assert.equal(slotDepth('automatic'), expected ?? automatic);
      assert.equal(sort.mock.calls.length, 1, 'each editor refresh sorts once');
      assert.equal(order.mock.calls.length, 1, 'each editor refresh updates the render order once');
      sort.mockClear();
      order.mockClear();
    };

    editor.editSlot('automatic', 'depth', 50);
    assertDepth(50);
    editor.undo();
    assertDepth(depth);
    editor.redo();
    assertDepth(50);

    editor.state.selectSlot('automatic');
    editor.resetSelected();
    assertDepth(depth);
    editor.undo();
    assertDepth(50);
    editor.resetRig();
    assertDepth(depth);

    editor.editBone('hand', 'depth', -1);
    assertDepth(depth, 1);
    editor.undo();
    assertDepth(depth);
    assert.strictEqual(puppet.clearSlotDepth('automatic'), puppet);
  },
);
