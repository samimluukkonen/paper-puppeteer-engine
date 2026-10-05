import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import type { Bone } from '../src/engine/Bone.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import { rendererFixture } from './helpers/rendererFixture.js';

vi.mock('phaser', () => ({ default: {} }));

test('deep slot rigs allocate two affine factors per drawable and reuse lazy prop mounts', () => {
  const count = 128;
  const { renderer, allocations } = rendererFixture({
    root: 'bone0',
    bones: Array.from({ length: count }, (_, index) => ({
      id: `bone${index}`,
      ...(index ? { parent: `bone${index - 1}`, y: 10 } : {}),
    })),
    slots: [{ id: 'item', bone: `bone${count - 1}` }],
  });
  assert.equal(allocations.projections, 2, 'two affine factors for the slot regardless of skeleton depth');
  const mount = renderer.getMount('bone63');
  assert.equal(allocations.projections, 4, 'a prop mount adds two factors');
  const containers = allocations.containers;
  assert.strictEqual(renderer.getMount('bone63'), mount);
  assert.equal(allocations.containers, containers, 'reusing a prop mount creates no containers');
});

test('unrendered joints need no projections and unknown or destroyed mounts cannot allocate', () => {
  const { renderer, allocations } = rendererFixture({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'child', parent: 'root' }],
  });
  assert.equal(allocations.projections, 0);
  assert.doesNotThrow(() => renderer.syncBone('child'));
  assert.throws(() => renderer.syncBone('missing'), /Unknown bone/);
  const containers = allocations.containers;
  assert.throws(() => renderer.getMount('missing'), /Unknown bone/);
  renderer.destroy();
  assert.throws(() => renderer.getMount('root'), /destroyed/);
  assert.equal(allocations.containers, containers);
});

test('lazy prop mounts immediately preserve affine transforms, current depth, and subsequent partial syncs', () => {
  const { renderer, bones, parent } = rendererFixture({
    root: 'root',
    bones: [
      { id: 'root', x: 10, rotation: 0.3, scaleX: 2, scaleY: 0.7 },
      { id: 'upper', parent: 'root', y: 30, rotation: -0.6, scaleX: 0.6, scaleY: 2 },
      { id: 'hand', parent: 'upper', x: 5, y: 10, rotation: 0.2 },
    ],
  });
  parent.setPosition(100, 70).setRotation(0.4).setScale(-1.2, 0.8);
  renderer.setOrder(['hand', 'upper', 'root']);
  const renderContainer = parent.list.at(-1)!;
  const mount = renderer.getMount('hand');
  let branch = mount;
  while (branch.parentContainer !== renderContainer) branch = branch.parentContainer!;
  assert.equal(branch.depth, 0, 'the lazy branch uses the current order');
  const assertTransform = () => {
    const actual = mount.getWorldTransformMatrix();
    const expected = bones.get('hand')!.container.getWorldTransformMatrix();
    for (const field of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const)
      assert.closeTo(actual[field], expected[field], 1e-12, field);
  };
  assertTransform();
  const upper = bones.get('upper')!;
  upper.pose.rotation = 0.7;
  upper.syncTransform();
  renderer.syncBone('upper');
  assertTransform();
  const root = bones.get('root')!.container;
  root.setAlpha(0.2).setVisible(false);
  renderer.syncBone('root');
  assert.equal(branch.alpha, 0.2);
  assert.isFalse(branch.visible);
  renderer.setOrder(['root', 'upper', 'hand']);
  assert.equal(branch.depth, 20, 'later order changes update the existing prop branch');
});

test('bones with authored sprites retain eagerly initialized mounts', () => {
  const { renderer, bones, allocations } = rendererFixture({
    root: 'root',
    bones: [{ id: 'root', x: 12, sprite: { texture: 'part' } }],
  });
  assert.equal(allocations.projections, 2);
  const containers = allocations.containers;
  const mount = renderer.getMount('root');
  assert.strictEqual(bones.get('root')!.sprite!.parentContainer, mount);
  assert.equal(mount.getWorldTransformMatrix().tx, 12);
  assert.equal(allocations.containers, containers);
});

test('lazy mounts retain current unsynchronized ancestor edits through later partial updates', () => {
  const { renderer, bones } = rendererFixture({
    root: 'root',
    bones: [
      { id: 'root', x: 10, scaleX: 2, scaleY: 0.5 },
      { id: 'hand', parent: 'root', y: 20 },
    ],
  });
  bones.get('root')!.container.setRotation(0.8).setAlpha(0.4);
  const hand = bones.get('hand')!.container;
  const mount = renderer.getMount('hand');
  assertSameMatrix(mount, hand);
  hand.setRotation(-0.7);
  renderer.syncBone('hand');
  assertSameMatrix(mount, hand);
  assert.equal(mount.parentContainer!.alpha, 0.4);
});

function assertSameMatrix(actual: Phaser.GameObjects.Container, expected: Phaser.GameObjects.Container): void {
  const result = actual.getWorldTransformMatrix();
  const source = expected.getWorldTransformMatrix();
  for (const field of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const)
    assert.closeTo(result[field], source[field], Math.max(1, Math.abs(source[field])) * 1e-11, field);
}

test('dense deep rigs allocate linearly and preserve affine transforms through full and partial synchronization', () => {
  const count = 128;
  const { renderer, bones, allocations, parent } = rendererFixture({
    root: 'bone0',
    bones: Array.from({ length: count }, (_, index) => ({
      id: `bone${index}`,
      ...(index ? { parent: `bone${index - 1}` } : {}),
      x: (index % 3) - 1,
      y: index % 4,
      rotation: Math.sin(index) * 0.2,
      scaleX: index % 2 ? -1.03 : 0.97,
      scaleY: index % 2 ? 0.98 : 1.02,
      sprite: { texture: 'part' },
    })),
  });
  assert.equal(allocations.projections, count * 2);
  assert.equal(allocations.containers, count * 3 + 2);
  parent.setScale(0, -2).setRotation(0.3).setPosition(20, 10);
  for (const [id, bone] of bones) assertSameMatrix(renderer.getMount(id), bone.container);
  parent.setScale(-2, 0.7);
  const changed = bones.get('bone63')!;
  changed.container.setRotation(0.8).setScale(0, -1.5);
  renderer.syncBone(changed.id);
  for (const [id, bone] of bones) assertSameMatrix(renderer.getMount(id), bone.container);
  changed.container.setScale(-0.7, 1.5);
  bones.get('bone0')!.container.setAlpha(0.5);
  bones.get('bone64')!.container.setAlpha(0.4).setVisible(false);
  renderer.sync();
  for (const [id, bone] of bones) assertSameMatrix(renderer.getMount(id), bone.container);
  const leafBranch = renderer.getMount('bone127').parentContainer!;
  assert.closeTo(leafBranch.alpha, 0.2, 1e-15);
  assert.isFalse(leafBranch.visible);
  const containers = allocations.containers;
  renderer.sync();
  assert.equal(allocations.containers, containers);
});

test('partial synchronization leaves unrelated unpublished local edits unchanged', () => {
  const { renderer, bones } = rendererFixture({
    root: 'root',
    bones: [
      { id: 'root', rotation: 0.3, scaleX: 2, scaleY: 0.5 },
      { id: 'left', parent: 'root', x: 10, sprite: { texture: 'part' } },
      { id: 'right', parent: 'root', x: -10, sprite: { texture: 'part' } },
    ],
  });
  const left = renderer.getMount('left');
  const before = left.getWorldTransformMatrix();
  bones.get('left')!.container.setPosition(200, 0);
  bones.get('right')!.container.setRotation(0.7);
  renderer.syncBone('right');
  const after = left.getWorldTransformMatrix();
  for (const field of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) assert.equal(after[field], before[field]);
  assertSameMatrix(renderer.getMount('right'), bones.get('right')!.container);
  bones.get('root')!.container.setRotation(0.8);
  renderer.syncBone('root');
  assertSameMatrix(renderer.getMount('right'), bones.get('right')!.container);
  assert.notEqual(left.getWorldTransformMatrix().tx, bones.get('left')!.container.getWorldTransformMatrix().tx);
  renderer.sync();
  assertSameMatrix(left, bones.get('left')!.container);
});

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
      alpha: 1,
      visible: true,
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

test('render order reads reuse an immutable snapshot while previous orders remain stable', () => {
  const { renderer, rig, slotDepth } = fixture();
  const initial = renderer.getOrder();
  assert.strictEqual(renderer.getOrder(), initial);
  assert.isTrue(Object.isFrozen(initial));
  assert.isFalse(Reflect.set(initial, '0', 'hand'));
  const next = ['hand', 'root'];
  renderer.setOrder(next);
  const current = renderer.getOrder();
  next.reverse();
  assert.notStrictEqual(current, initial);
  assert.deepEqual(initial, rig.renderOrder);
  assert.deepEqual(current, ['hand', 'root']);
  assert.isTrue(Object.isFrozen(current));
  assert.strictEqual(renderer.getOrder(), current);

  // An unchanged bone order must still apply and clear supplied slot overrides.
  renderer.setOrder(current, new Map([['item', 25]]));
  assert.equal(slotDepth('item'), 25);
  assert.strictEqual(renderer.getOrder(), current);
  renderer.setOrder([...current], new Map([['item', undefined]]));
  assert.equal(slotDepth('item'), 11);
  assert.strictEqual(renderer.getOrder(), current);
});

test('invalid slot patches leave every transform unchanged and do not synchronize', () => {
  const { renderer } = fixture();
  const syncPose = vi.fn();
  const puppet = { renderer, syncPose, setSlotTransform: Puppet.prototype.setSlotTransform } as unknown as Puppet;
  const initial = slotTransform(renderer, 'item');
  for (const property of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(() => puppet.setSlotTransform('item', { x: 99, y: 99, [property]: value }), /finite/);
      assert.deepEqual(slotTransform(renderer, 'item'), initial);
    }
  }
  assert.equal(syncPose.mock.calls.length, 0);
});

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
