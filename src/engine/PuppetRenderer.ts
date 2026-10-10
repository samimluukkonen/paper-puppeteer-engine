import type Phaser from 'phaser';
import type { Affine } from './affineMath.js';
import { composeAffine, transformToAffine } from './affineMath.js';
import { type AffineFactors, factorAffine } from './affineProjection.js';
import type { Bone } from './Bone.js';
import type { Rig } from './Rig.js';
import type { SpriteAttachmentDefinition } from './types.js';
import { assertFinite } from './types.js';

interface RenderBranch {
  root: Phaser.GameObjects.Container;
  mount: Phaser.GameObjects.Container;
}

interface ProjectionNode {
  source: Phaser.GameObjects.Container;
  parent: ProjectionNode | undefined;
  children: ProjectionNode[];
  branches: RenderBranch[];
  local: Affine;
  world: Affine;
  localAlpha: number;
  localVisible: boolean;
  alpha: number;
  visible: boolean;
}

const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/** Independent draw slots use two transform factors to retain arbitrary affine shear. */
export class PuppetRenderer {
  private readonly container: Phaser.GameObjects.Container;
  private readonly branches = new Map<string, RenderBranch>();
  private readonly slotBranches = new Map<string, RenderBranch>();
  private readonly slotImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly slotDepthOverrides = new Map<string, number>();
  private readonly nodes = new Map<string, ProjectionNode>();
  private readonly pending: ProjectionNode[] = [];
  private readonly factors: AffineFactors = { rotation: 0, scaleX: 1, scaleY: 1, innerRotation: 0, innerScale: 1 };
  private order: readonly string[] = Object.freeze([]);
  private readonly appearanceValues: unknown[] = [];
  private appearanceRevision = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly rig: Rig,
    private readonly bones: ReadonlyMap<string, Bone>,
  ) {
    this.container = scene.add.container(0, 0).setName('puppet-render');
    parent.add(this.container);
    for (const definition of rig.bones) {
      const node: ProjectionNode = {
        source: bones.get(definition.id)!.container,
        parent: definition.parent === undefined ? undefined : this.nodes.get(definition.parent),
        children: [],
        branches: [],
        local: identity(),
        world: identity(),
        localAlpha: 1,
        localVisible: true,
        alpha: 1,
        visible: true,
      };
      this.nodes.set(definition.id, node);
      node.parent?.children.push(node);
      this.readNode(node);
      this.updateNode(node);
    }
    for (const bone of bones.values()) {
      // Empty joints need no independent draw branch until a host attaches a prop.
      if (!bone.sprite) continue;
      const branch = this.makeBranch(bone.id, bone);
      branch.mount.add(bone.sprite);
      this.branches.set(bone.id, branch);
    }
    for (const slot of rig.slots) {
      const branch = this.makeBranch(`slot-${slot.id}`, bones.get(slot.bone)!);
      const local = scene.add
        .container(slot.x ?? 0, slot.y ?? 0)
        .setRotation(slot.rotation ?? 0)
        .setScale(slot.scaleX ?? 1, slot.scaleY ?? 1);
      branch.mount.add(local);
      this.slotBranches.set(slot.id, { root: branch.root, mount: local });
    }
    this.setOrder(rig.renderOrder);
  }

  private makeBranch(name: string, bone: Bone): RenderBranch {
    const root = this.scene.add.container(0, 0).setName(`render-${name}`);
    const mount = this.scene.add.container(0, 0).setName(`pose-${bone.id}`);
    this.container.add(root);
    root.add(mount);
    const branch = { root, mount };
    const node = this.nodes.get(bone.id)!;
    node.branches.push(branch);
    this.project(branch, node.world, node.alpha, node.visible);
    return branch;
  }

  getOrder(): readonly string[] {
    return this.order;
  }

  /** @internal Detect artwork edits, including direct host mutations, once for all render-only previews. */
  getAppearanceRevision(): number {
    let index = 0;
    let changed = false;
    const remember = (value: unknown): void => {
      if (this.appearanceValues[index] !== value) changed = true;
      this.appearanceValues[index++] = value;
    };
    const transform = (object: Phaser.GameObjects.Container | Phaser.GameObjects.Image): void => {
      remember(object.x);
      remember(object.y);
      remember(object.rotation);
      remember(object.scaleX);
      remember(object.scaleY);
      remember(object.alpha);
      remember(object.visible);
    };
    const image = (object: Phaser.GameObjects.Image | undefined): void => {
      remember(object);
      if (!object) return;
      remember(object.texture);
      remember(object.frame);
      remember(object.originX);
      remember(object.originY);
      remember(object.depth);
      transform(object);
    };
    remember(this.order);
    for (const bone of this.bones.values()) {
      remember(bone.container.alpha);
      remember(bone.container.visible);
      image(bone.sprite);
    }
    for (const [id, branch] of this.slotBranches) {
      remember(branch.root.depth);
      transform(branch.mount);
      image(this.slotImages.get(id));
    }
    if (this.appearanceValues.length !== index) changed = true;
    this.appearanceValues.length = index;
    if (changed) ++this.appearanceRevision;
    return this.appearanceRevision;
  }

  /** Apply bone order and supplied slot overrides together, then sort once. Undefined restores the rig depth. */
  setOrder(order: readonly string[], slotDepths?: ReadonlyMap<string, number | undefined>): void {
    if (order.length !== this.rig.bones.length || new Set(order).size !== order.length) {
      throw new Error('Render order must contain every bone exactly once.');
    }
    for (const id of order) this.rig.getBone(id);
    const orderChanged = this.order.length !== order.length || this.order.some((id, index) => id !== order[index]);
    let slotsChanged = false;
    if (slotDepths) {
      for (const [id, depth] of slotDepths) {
        this.getSlotMount(id);
        if (depth !== undefined) assertFinite(depth, `Slot ${id}.depth`);
      }
      for (const [id, depth] of slotDepths) {
        if (this.slotDepthOverrides.get(id) === depth) continue;
        slotsChanged = true;
        if (depth === undefined) this.slotDepthOverrides.delete(id);
        else this.slotDepthOverrides.set(id, depth);
      }
    }
    if (!orderChanged && !slotsChanged) return;
    const boneDepths = new Map(order.map((id, index) => [id, index * 10]));
    for (const [id, depth] of boneDepths) this.branches.get(id)?.root.setDepth(depth);
    for (const slot of this.rig.slots) {
      const anchor = boneDepths.get(slot.bone)!;
      this.slotBranches.get(slot.id)!.root.setDepth(this.slotDepthOverrides.get(slot.id) ?? slot.depth ?? anchor + 1);
    }
    this.container.sort('depth');
    if (orderChanged) this.order = Object.freeze([...order]);
  }

  getMount(id: string): Phaser.GameObjects.Container {
    if (this.container.isDestroyed) throw new Error('Puppet renderer has been destroyed.');
    let branch = this.branches.get(id);
    if (!branch) {
      const bone = this.bones.get(id);
      if (!bone) throw new Error(`Unknown bone "${id}".`);
      // Publish current source transforms before adding a mount so later partial
      // updates cannot restore an older ancestor cached before this attachment.
      this.sync();
      branch = this.makeBranch(id, bone);
      branch.root.setDepth(this.order.indexOf(id) * 10);
      this.branches.set(id, branch);
      this.container.sort('depth');
    }
    return branch.mount;
  }

  getSlotMount(id: string): Phaser.GameObjects.Container {
    const branch = this.slotBranches.get(id);
    if (!branch) throw new Error(`Unknown slot "${id}".`);
    return branch.mount;
  }

  /** Update supplied transform properties, preserving omitted values. */
  setSlotTransform(
    id: string,
    values: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number },
  ): void {
    const mount = this.getSlotMount(id);
    const { x, y, rotation, scaleX, scaleY } = values;
    const patch = { x, y, rotation, scaleX, scaleY };
    for (const [property, value] of Object.entries(patch))
      if (value !== undefined) assertFinite(value, `Slot ${id}.${property}`);
    mount
      .setPosition(x ?? mount.x, y ?? mount.y)
      .setRotation(rotation ?? mount.rotation)
      .setScale(scaleX ?? mount.scaleX, scaleY ?? mount.scaleY);
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
    const branch = this.slotBranches.get(id);
    if (!branch) throw new Error(`Unknown slot "${id}".`);
    this.slotDepthOverrides.delete(id);
    const slot = this.rig.getSlot(id);
    branch.root.setDepth(slot.depth ?? this.order.indexOf(slot.bone) * 10 + 1);
    this.container.sort('depth');
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
    mount.add(image).sort('depth');
    this.slotImages.set(id, image);
  }

  /** Copy current sprite artwork and runtime slot layout without reading or applying a pose.
   * Render-only previews share loaded textures and retain images across skin/frame changes.
   * Arbitrary host-attached GameObjects are deliberately not cloned.
   */
  copyAppearanceFrom(source: PuppetRenderer, tint: number): void {
    const copyTransform = (
      target: Phaser.GameObjects.Container | Phaser.GameObjects.Image,
      original: Phaser.GameObjects.Container | Phaser.GameObjects.Image,
    ): void => {
      target
        .setPosition(original.x, original.y)
        .setRotation(original.rotation)
        .setScale(original.scaleX, original.scaleY)
        .setAlpha(original.alpha)
        .setVisible(original.visible);
    };
    const copyImage = (target: Phaser.GameObjects.Image, original: Phaser.GameObjects.Image): void => {
      if (target.texture !== original.texture || target.frame !== original.frame)
        target.setTexture(original.texture.key, original.frame.name);
      copyTransform(target, original);
      target.setOrigin(original.originX, original.originY).setDepth(original.depth).setTint(tint);
    };
    for (const [id, bone] of this.bones) {
      const original = source.bones.get(id)!;
      bone.container.setAlpha(original.container.alpha).setVisible(original.container.visible);
      if (bone.sprite && original.sprite) copyImage(bone.sprite, original.sprite);
    }
    this.setOrder(source.getOrder());
    let depthsChanged = false;
    for (const slot of this.rig.slots) {
      const branch = this.slotBranches.get(slot.id)!;
      const originalBranch = source.slotBranches.get(slot.id)!;
      copyTransform(branch.mount, originalBranch.mount);
      if (branch.root.depth !== originalBranch.root.depth) {
        branch.root.setDepth(originalBranch.root.depth);
        depthsChanged = true;
      }
      const original = source.slotImages.get(slot.id);
      let image = this.slotImages.get(slot.id);
      if (!original) {
        image?.destroy();
        this.slotImages.delete(slot.id);
        continue;
      }
      if (!image) {
        image = this.scene.add.image(0, 0, original.texture.key, original.frame.name);
        branch.mount.add(image);
        this.slotImages.set(slot.id, image);
      }
      copyImage(image, original);
    }
    if (depthsChanged) this.container.sort('depth');
  }

  sync(): void {
    for (const node of this.nodes.values()) {
      this.readNode(node);
      this.updateNode(node);
    }
  }

  /** Recompose only the changed joint's descendants before later IK providers read mounts. */
  syncBone(id: string): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown bone "${id}".`);
    this.readNode(node);
    this.pending.push(node);
    while (this.pending.length) {
      const descendant = this.pending.pop()!;
      this.updateNode(descendant);
      for (const child of descendant.children) this.pending.push(child);
    }
  }

  private readNode(node: ProjectionNode): void {
    transformToAffine(node.source, node.local);
    node.localAlpha = node.source.alpha;
    node.localVisible = node.source.visible;
  }

  private updateNode(node: ProjectionNode): void {
    composeAffine(node.local, node.parent?.world, node.world);
    node.alpha = node.localAlpha * (node.parent?.alpha ?? 1);
    node.visible = node.localVisible && (node.parent?.visible ?? true);
    for (const branch of node.branches) this.project(branch, node.world, node.alpha, node.visible);
  }

  private project(branch: RenderBranch, matrix: Affine, alpha: number, visible: boolean): void {
    const factors = factorAffine(matrix, this.factors);
    branch.root
      .setPosition(matrix.tx, matrix.ty)
      .setRotation(factors.rotation)
      .setScale(factors.scaleX, factors.scaleY)
      .setAlpha(alpha)
      .setVisible(visible);
    branch.mount.setRotation(factors.innerRotation).setScale(factors.innerScale);
  }

  destroy(): void {
    if (!this.container.isDestroyed) this.container.destroy();
    this.branches.clear();
    this.slotBranches.clear();
    this.slotImages.clear();
    this.slotDepthOverrides.clear();
    this.nodes.clear();
    this.pending.length = 0;
    this.appearanceValues.length = 0;
  }
}
