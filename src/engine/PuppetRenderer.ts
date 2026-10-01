import type Phaser from 'phaser';
import type { Bone } from './Bone.js';
import type { Rig } from './Rig.js';
import type { SpriteAttachmentDefinition } from './types.js';

interface TransformProjection {
  source: Phaser.GameObjects.Container;
  target: Phaser.GameObjects.Container;
}

interface RenderBranch {
  root: Phaser.GameObjects.Container;
  mount: Phaser.GameObjects.Container;
}

/** Independent draw slots retain complete ancestor transforms, including shear. */
export class PuppetRenderer {
  private readonly container: Phaser.GameObjects.Container;
  private readonly branches = new Map<string, RenderBranch>();
  private readonly slotBranches = new Map<string, RenderBranch>();
  private readonly slotImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly slotDepthOverrides = new Map<string, number>();
  private readonly projections: TransformProjection[] = [];
  private order: readonly string[] = [];

  constructor(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly rig: Rig,
    bones: ReadonlyMap<string, Bone>,
  ) {
    this.container = scene.add.container(0, 0).setName('puppet-render');
    parent.add(this.container);
    const makeBranch = (name: string, bone: Bone): RenderBranch => {
      const ancestors: Bone[] = [];
      let ancestor: Bone | undefined = bone;
      while (ancestor) {
        ancestors.unshift(ancestor);
        ancestor = ancestor.parentId === undefined ? undefined : bones.get(ancestor.parentId);
      }
      const root = scene.add.container(0, 0).setName(`render-${name}`);
      this.container.add(root);
      let mount = root;
      // Keeping the chain avoids decomposing a rotated, nonuniformly scaled matrix.
      for (const source of ancestors) {
        const target = scene.add.container(0, 0).setName(`pose-${source.id}`);
        mount.add(target);
        this.projections.push({ source: source.container, target });
        mount = target;
      }
      return { root, mount };
    };
    for (const bone of bones.values()) {
      const branch = makeBranch(bone.id, bone);
      if (bone.sprite) branch.mount.add(bone.sprite);
      this.branches.set(bone.id, branch);
    }
    for (const slot of rig.slots) {
      const branch = makeBranch(`slot-${slot.id}`, bones.get(slot.bone)!);
      const local = scene.add
        .container(slot.x ?? 0, slot.y ?? 0)
        .setRotation(slot.rotation ?? 0)
        .setScale(slot.scaleX ?? 1, slot.scaleY ?? 1);
      branch.mount.add(local);
      this.slotBranches.set(slot.id, { root: branch.root, mount: local });
    }
    this.setOrder(rig.renderOrder);
    this.sync();
  }

  getOrder(): readonly string[] {
    return [...this.order];
  }

  /** Complete back-to-front order, including bones without an image. */
  setOrder(order: readonly string[]): void {
    if (order.length !== this.rig.bones.length || new Set(order).size !== order.length) {
      throw new Error('Render order must contain every bone exactly once.');
    }
    for (const id of order) this.rig.getBone(id);
    for (const [index, id] of order.entries()) this.branches.get(id)!.root.setDepth(index * 10);
    for (const slot of this.rig.slots) {
      const anchor = order.indexOf(slot.bone) * 10;
      this.slotBranches.get(slot.id)!.root.setDepth(this.slotDepthOverrides.get(slot.id) ?? slot.depth ?? anchor + 1);
    }
    this.container.sort('depth');
    this.order = [...order];
  }

  getMount(id: string): Phaser.GameObjects.Container {
    const branch = this.branches.get(id);
    if (!branch) throw new Error(`Unknown bone "${id}".`);
    return branch.mount;
  }

  getSlotMount(id: string): Phaser.GameObjects.Container {
    const branch = this.slotBranches.get(id);
    if (!branch) throw new Error(`Unknown slot "${id}".`);
    return branch.mount;
  }

  setSlotTransform(
    id: string,
    values: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number },
  ): void {
    const mount = this.getSlotMount(id);
    mount
      .setPosition(values.x ?? 0, values.y ?? 0)
      .setRotation(values.rotation ?? 0)
      .setScale(values.scaleX ?? 1, values.scaleY ?? 1);
  }

  setSlotDepth(id: string, depth: number): void {
    const branch = this.slotBranches.get(id);
    if (!branch) throw new Error(`Unknown slot "${id}".`);
    this.slotDepthOverrides.set(id, depth);
    branch.root.setDepth(depth);
    this.container.sort('depth');
  }

  /** Restore the rig depth, or automatic placement in the current render order. */
  clearSlotDepth(id: string): void {
    this.getSlotMount(id);
    this.slotDepthOverrides.delete(id);
    this.setOrder(this.order);
  }

  getSlotImage(id: string): Phaser.GameObjects.Image | undefined {
    return this.slotImages.get(id);
  }

  setSlotAttachment(id: string, definition: SpriteAttachmentDefinition | undefined): void {
    const mount = this.getSlotMount(id);
    this.slotImages.get(id)?.destroy();
    this.slotImages.delete(id);
    if (!definition) return;
    const image = mount.scene.add
      .image(definition.x ?? 0, definition.y ?? 0, definition.texture, definition.frame)
      .setOrigin(definition.originX ?? 0.5, definition.originY ?? 0.5)
      .setRotation(definition.rotation ?? 0)
      .setScale(definition.scaleX ?? 1, definition.scaleY ?? 1);
    mount.add(image);
    this.slotImages.set(id, image);
  }

  sync(): void {
    for (const { source, target } of this.projections) {
      target
        .setPosition(source.x, source.y)
        .setRotation(source.rotation)
        .setScale(source.scaleX, source.scaleY)
        .setAlpha(source.alpha)
        .setVisible(source.visible);
    }
  }

  destroy(): void {
    if (!this.container.isDestroyed) this.container.destroy();
    this.branches.clear();
    this.slotBranches.clear();
    this.slotImages.clear();
    this.slotDepthOverrides.clear();
    this.projections.length = 0;
  }
}
