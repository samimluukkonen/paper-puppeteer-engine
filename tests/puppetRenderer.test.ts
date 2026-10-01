import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import type { Bone } from '../src/engine/Bone.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';

function fixture() {
  const containers = new Map<string, Phaser.GameObjects.Container>();
  const makeContainer = () => {
    const container = {
      depth: 0,
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
      setPosition: vi.fn().mockReturnThis(),
      setRotation: vi.fn().mockReturnThis(),
      setScale: vi.fn().mockReturnThis(),
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
      { id: 'item', bone: 'root' },
      { id: 'fixed', bone: 'root', depth: 40 },
      { id: 'automatic', bone: 'hand' },
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
  return { renderer, rig, slotDepth };
}

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
