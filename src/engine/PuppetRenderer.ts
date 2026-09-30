import type Phaser from 'phaser';
import type { Bone } from './Bone.js';
import type { Rig } from './Rig.js';

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
    for (const bone of bones.values()) {
      const ancestors: Bone[] = [];
      let ancestor: Bone | undefined = bone;
      while (ancestor) {
        ancestors.unshift(ancestor);
        ancestor = ancestor.parentId === undefined ? undefined : bones.get(ancestor.parentId);
      }
      const root = scene.add.container(0, 0).setName(`render-${bone.id}`);
      this.container.add(root);
      let mount = root;
      // Keeping the chain avoids decomposing a rotated, nonuniformly scaled matrix.
      for (const source of ancestors) {
        const target = scene.add.container(0, 0).setName(`pose-${source.id}`);
        mount.add(target);
        this.projections.push({ source: source.container, target });
        mount = target;
      }
      if (bone.sprite) mount.add(bone.sprite);
      this.branches.set(bone.id, { root, mount });
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
    for (const [index, id] of order.entries()) this.branches.get(id)!.root.setDepth(index);
    this.container.sort('depth');
    this.order = [...order];
  }

  getMount(id: string): Phaser.GameObjects.Container {
    const branch = this.branches.get(id);
    if (!branch) throw new Error(`Unknown bone "${id}".`);
    return branch.mount;
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
    this.projections.length = 0;
  }
}
