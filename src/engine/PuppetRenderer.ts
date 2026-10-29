import type Phaser from 'phaser';
import type { Affine } from './affineMath.js';
import { composeAffine, transformToAffine, worldToLocal } from './affineMath.js';
import { type AffineFactors, factorAffine } from './affineProjection.js';
import type { ArtworkReference, ArtworkReplacement, ArtworkUsage } from './artworkReplacement.js';
import type { Bone } from './Bone.js';
import type { MeshDeformationPose } from './meshDeformation.js';
import { assertMeshImageSize } from './meshGeometry.js';
import { createTexturedMesh, syncMeshTextureOrientation } from './meshRendering.js';
import { createMeshSkinBinding, deformMesh, type MeshSkinBinding } from './meshSkinning.js';
import type { Rig } from './Rig.js';
import type { SkinDefinition, AttachmentDefinition, MeshAttachmentDefinition } from './types.js';
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
  private readonly slotMeshes = new Map<string, Phaser.GameObjects.Mesh2D>();
  private readonly meshBindings = new Map<
    string,
    {
      definition: MeshAttachmentDefinition;
      binding: MeshSkinBinding;
      transforms: number[];
    }
  >();
  private readonly posedMesh = identity();
  private readonly slotMatrix = identity();
  private readonly meshMatrix = identity();
  private readonly readMeshBone = (id: string): Affine | undefined => this.nodes.get(id)?.world;
  private readonly slotImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly slotDepthOverrides = new Map<string, number>();
  private readonly nodes = new Map<string, ProjectionNode>();
  private readonly pending: ProjectionNode[] = [];
  private readonly factors: AffineFactors = { rotation: 0, scaleX: 1, scaleY: 1, innerRotation: 0, innerScale: 1 };
  private order: readonly string[] = Object.freeze([]);
  private readonly appearanceValues: unknown[] = [];
  private appearanceRevision = 0;
  private readonly artworkTextures = new Map<string, ArtworkReplacement>();
  private readonly individualArtwork = new Map<string, ArtworkReplacement>();
  private artworkDefinitions: readonly AttachmentDefinition[];
  private artworkSkins: readonly SkinDefinition[];
  private readonly slotArtwork = new Map<string, AttachmentDefinition>();

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly rig: Rig,
    private readonly bones: ReadonlyMap<string, Bone>,
    private readonly getDeformation?: () => MeshDeformationPose,
  ) {
    this.artworkDefinitions = rig.attachments;
    this.artworkSkins = rig.skins;
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
    const transform = (
      object: Phaser.GameObjects.Container | Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D,
    ): void => {
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
      const mesh = this.slotMeshes.get(id);
      remember(mesh);
      if (mesh) {
        transform(mesh);
        remember(mesh.texture);
        remember(mesh.vertices);
        remember(mesh.indices);
      }
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

  getSlotMesh(id: string): Phaser.GameObjects.Mesh2D | undefined {
    return this.slotMeshes.get(id);
  }

  getSlotImage(id: string): Phaser.GameObjects.Image | undefined {
    return this.slotImages.get(id);
  }

  getArtworkUsages(): readonly ArtworkUsage[] {
    // Index each mapping once; scanning every skin for every attachment multiplies
    // work across otherwise bounded catalogs. Sets retain the authored lookup order.
    const assignments = new Map(
      this.artworkDefinitions.map((entry) => [entry.id, { slots: new Set<string>(), skins: new Set<string>() }]),
    );
    for (const skin of this.artworkSkins) {
      for (const [slot, attachment] of Object.entries(skin.slots)) {
        if (attachment === null) continue;
        const usage = assignments.get(attachment);
        usage?.slots.add(slot);
        usage?.skins.add(skin.name);
      }
    }
    for (const [slot, definition] of this.slotArtwork) assignments.get(definition.id)?.slots.add(slot);
    return [
      ...this.rig.bones.flatMap((bone): ArtworkUsage[] =>
        bone.sprite
          ? [
              {
                reference: `bone:${bone.id}`,
                texture: bone.sprite.texture,
                frame: bone.sprite.frame,
                slots: [],
                skins: [],
              },
            ]
          : [],
      ),
      ...this.artworkDefinitions.map((entry): ArtworkUsage => ({
        reference: `attachment:${entry.id}`,
        texture: entry.texture,
        frame: entry.frame,
        slots: [...assignments.get(entry.id)!.slots],
        skins: [...assignments.get(entry.id)!.skins],
      })),
    ];
  }

  updateArtworkDefinitions(definitions: readonly AttachmentDefinition[], skins: readonly SkinDefinition[]): void {
    this.artworkDefinitions = definitions;
    this.artworkSkins = skins;
  }

  getArtworkReplacement(assetKey: string, reference?: ArtworkReference): ArtworkReplacement | undefined {
    return (
      (reference ? this.individualArtwork.get(JSON.stringify([assetKey, reference])) : undefined) ??
      this.artworkTextures.get(assetKey)
    );
  }

  /** Validate inactive references too; Phaser frame fallback must never hide an invalid replacement. */
  validateArtworkReplacement(assetKey: string, replacement?: ArtworkReplacement, reference?: ArtworkReference): void {
    const usages = this.getArtworkUsages().filter(
      (entry) => entry.texture === assetKey && (reference === undefined || entry.reference === reference),
    );
    if (reference && !usages.length && replacement)
      throw new Error(`Artwork reference "${reference}" no longer uses "${assetKey}".`);
    if (
      replacement &&
      this.artworkDefinitions.some(
        (entry) =>
          entry.type === 'mesh' && entry.texture === assetKey && (!reference || reference === `attachment:${entry.id}`),
      ) &&
      (replacement.originScaleX !== 1 || replacement.originScaleY !== 1)
    )
      throw new Error('Mesh artwork replacement must preserve image dimensions and pivot.');
    const key = replacement?.textureKey ?? assetKey;
    if (!this.scene.textures.exists(key)) throw new Error(`Missing artwork texture "${key}".`);
    if (replacement) {
      for (const attachment of this.artworkDefinitions) {
        if (
          attachment.type === 'mesh' &&
          attachment.texture === assetKey &&
          (!reference || reference === `attachment:${attachment.id}`)
        )
          assertMeshImageSize(attachment, this.scene.textures.get(key).get('__BASE'));
      }
      for (const value of [replacement.originScaleX, replacement.originScaleY]) {
        assertFinite(value, 'Artwork origin multiplier');
        if (value <= 0) throw new Error('Artwork origin multipliers must be positive.');
      }
      for (const usage of usages) {
        if (usage.frame !== undefined && !this.scene.textures.get(key).has(String(usage.frame)))
          throw new Error(
            `Replacement lacks frame "${usage.frame}" for ${usage.reference}. Supply the same frame catalog or choose a whole-image reference.`,
          );
      }
    }
  }

  /** Preflight every affected frame, then install atomically. Texture ownership belongs to the host. */
  setArtworkReplacement(assetKey: string, replacement?: ArtworkReplacement, reference?: ArtworkReference): void {
    this.validateArtworkReplacement(assetKey, replacement, reference);
    const map = reference ? this.individualArtwork : this.artworkTextures;
    const identity = reference ? JSON.stringify([assetKey, reference]) : assetKey;
    const previous = map.get(identity);
    const images: {
      image: Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D;
      texture: string;
      frame: string | number;
      x: number;
      y: number;
      reference: ArtworkReference;
      old: ArtworkReplacement | undefined;
    }[] = [];
    const remember = (
      image: Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D | undefined,
      ref: ArtworkReference,
    ): void => {
      if (image)
        images.push({
          image,
          texture: image.texture.key,
          frame: image.frame.name,
          x: image.originX,
          y: image.originY,
          reference: ref,
          old: this.getArtworkReplacement(assetKey, ref),
        });
    };
    for (const bone of this.rig.bones)
      if (bone.sprite?.texture === assetKey && (!reference || reference === `bone:${bone.id}`))
        remember(this.bones.get(bone.id)!.sprite, `bone:${bone.id}`);
    for (const [id, definition] of this.slotArtwork)
      if (definition.texture === assetKey && (!reference || reference === `attachment:${definition.id}`))
        remember(this.slotImages.get(id) ?? this.slotMeshes.get(id), `attachment:${definition.id}`);
    const install = (value: ArtworkReplacement | undefined): void => {
      if (value) map.set(identity, Object.freeze({ ...value }));
      else map.delete(identity);
    };
    install(replacement);
    try {
      for (const entry of images) {
        const next = this.getArtworkReplacement(assetKey, entry.reference);
        // Preserve the authored pivot even across a temporary pixel policy and Cancel/Revert.
        entry.image
          .setTexture(next?.textureKey ?? assetKey, entry.frame)
          .setOrigin(
            (entry.x / (entry.old?.originScaleX ?? 1)) * (next?.originScaleX ?? 1),
            (entry.y / (entry.old?.originScaleY ?? 1)) * (next?.originScaleY ?? 1),
          );
        syncMeshTextureOrientation(entry.image);
      }
    } catch (error) {
      install(previous);
      for (const entry of images) {
        entry.image.setTexture(entry.texture, entry.frame).setOrigin(entry.x, entry.y);
        syncMeshTextureOrientation(entry.image);
      }
      throw error;
    }
  }

  /** Compatibility API for shared normalized-origin replacement. Frames are preserved and validated. */
  setArtworkTexture(assetKey: string, replacementKey?: string): void {
    const current = this.getArtworkReplacement(assetKey);
    this.setArtworkReplacement(
      assetKey,
      replacementKey
        ? {
            textureKey: replacementKey,
            originScaleX: current?.originScaleX ?? 1,
            originScaleY: current?.originScaleY ?? 1,
          }
        : undefined,
    );
  }

  /** Editor alignment remains authored; apply the session policy when projecting its normalized origins. */
  setArtworkOrigin(
    reference: ArtworkReference,
    assetKey: string,
    image: Phaser.GameObjects.Image,
    x: number,
    y: number,
  ): void {
    const replacement = this.getArtworkReplacement(assetKey, reference);
    image.setOrigin(x * (replacement?.originScaleX ?? 1), y * (replacement?.originScaleY ?? 1));
  }

  setSlotAttachment(id: string, definition: AttachmentDefinition | undefined): void {
    const mount = this.getSlotMount(id);
    const previous = this.slotImages.get(id) ?? this.slotMeshes.get(id);
    const presentation = previous
      ? { alpha: previous.alpha, visible: previous.visible, depth: previous.depth }
      : undefined;
    if (!definition) {
      previous?.destroy();
      this.slotImages.delete(id);
      this.slotMeshes.delete(id);
      this.meshBindings.delete(id);
      this.slotArtwork.delete(id);
      return;
    }
    const replacement = this.getArtworkReplacement(definition.texture, `attachment:${definition.id}`);
    if (definition.type === 'mesh') {
      const mesh = createTexturedMesh(this.scene, definition, replacement?.textureKey ?? definition.texture);
      let binding: MeshSkinBinding;
      try {
        binding = createMeshSkinBinding(definition, id, mount, mesh);
        this.skinMesh(id, mesh, binding, definition.id);
        if (presentation)
          mesh.setAlpha(presentation.alpha).setVisible(presentation.visible).setDepth(presentation.depth);
        mount.add(mesh).sort('depth');
      } catch (error) {
        mesh.destroy();
        throw error;
      }
      previous?.destroy();
      this.slotImages.delete(id);
      this.slotMeshes.set(id, mesh);
      this.meshBindings.set(id, { definition, binding, transforms: this.meshTransforms(mount, mesh) });
      this.slotArtwork.set(id, definition);
      return;
    }
    const image = mount.scene.add.image(
      definition.x ?? 0,
      definition.y ?? 0,
      replacement?.textureKey ?? definition.texture,
      definition.frame,
    );
    try {
      image
        .setOrigin(
          (definition.originX ?? 0.5) * (replacement?.originScaleX ?? 1),
          (definition.originY ?? 0.5) * (replacement?.originScaleY ?? 1),
        )
        .setRotation(definition.rotation ?? 0)
        .setScale(definition.scaleX ?? 1, definition.scaleY ?? 1);
      if (presentation)
        image.setAlpha(presentation.alpha).setVisible(presentation.visible).setDepth(presentation.depth);
      mount.add(image).sort('depth');
    } catch (error) {
      image.destroy();
      throw error;
    }
    previous?.destroy();
    this.slotArtwork.set(id, definition);
    this.slotImages.set(id, image);
    this.slotMeshes.delete(id);
    this.meshBindings.delete(id);
  }

  /** Copy current sprite artwork and runtime slot layout without reading or applying a pose.
   * Render-only previews share loaded textures and retain images across skin/frame changes.
   * Arbitrary host-attached GameObjects are deliberately not cloned.
   */
  copyAppearanceFrom(source: PuppetRenderer, tint: number): void {
    const copyTransform = (
      target: Phaser.GameObjects.Container | Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D,
      original: Phaser.GameObjects.Container | Phaser.GameObjects.Image | Phaser.GameObjects.Mesh2D,
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
      const sourceMesh = source.slotMeshes.get(slot.id);
      if (sourceMesh) {
        this.slotImages.get(slot.id)?.destroy();
        this.slotImages.delete(slot.id);
        let mesh = this.slotMeshes.get(slot.id);
        if (!mesh) {
          mesh = this.scene.add.mesh2d(0, 0, sourceMesh.texture.key, [...sourceMesh.vertices], [...sourceMesh.indices]);
          mesh.setOrigin(0, 0);
          mesh.renderAsTriangles = true;
          branch.mount.add(mesh);
          this.slotMeshes.set(slot.id, mesh);
        }
        mesh.vertices = [...sourceMesh.vertices];
        mesh.indices = [...sourceMesh.indices];
        mesh.setTexture(sourceMesh.texture.key).setDepth(sourceMesh.depth);
        // Phaser 4.2.1 ships setTint but omits it from Mesh2D declarations.
        (mesh as Phaser.GameObjects.Mesh2D & { setTint(color: number): unknown }).setTint(tint);
        copyTransform(mesh, sourceMesh);
        mesh.flipV = sourceMesh.flipV;
        const sourceBinding = source.meshBindings.get(slot.id);
        if (sourceBinding)
          this.meshBindings.set(slot.id, {
            definition: sourceBinding.definition,
            binding: sourceBinding.binding,
            transforms: [...sourceBinding.transforms],
          });
        else this.meshBindings.delete(slot.id);
        continue;
      }
      this.slotMeshes.get(slot.id)?.destroy();
      this.slotMeshes.delete(slot.id);
      this.meshBindings.delete(slot.id);
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

  sync(deformMeshes = true): void {
    for (const node of this.nodes.values()) {
      this.readNode(node);
      this.updateNode(node);
    }
    if (deformMeshes) this.syncMeshes();
  }

  private meshTransforms(mount: Phaser.GameObjects.Container, mesh: Phaser.GameObjects.Mesh2D): number[] {
    return [
      mount.x,
      mount.y,
      mount.rotation,
      mount.scaleX,
      mount.scaleY,
      mesh.x,
      mesh.y,
      mesh.rotation,
      mesh.scaleX,
      mesh.scaleY,
    ];
  }

  /** Called once after the final IK pass. Rigid artwork never enters this loop. */
  syncMeshes(): void {
    for (const [id, entry] of this.meshBindings) {
      const mesh = this.slotMeshes.get(id)!;
      const mount = this.getSlotMount(id);
      const transforms = this.meshTransforms(mount, mesh);
      if (transforms.some((value, index) => value !== entry.transforms[index])) {
        entry.binding = createMeshSkinBinding(entry.definition, id, mount, mesh);
        entry.transforms = transforms;
      }
      this.skinMesh(id, mesh, entry.binding, entry.definition.id);
    }
  }

  private skinMesh(id: string, mesh: Phaser.GameObjects.Mesh2D, binding: MeshSkinBinding, attachmentId: string): void {
    const offsets = this.getDeformation?.().get(attachmentId);
    if (binding.rigid) {
      for (let index = 0; index < binding.localVertices.length; index++)
        mesh.vertices[index] = binding.localVertices[index]!;
      binding.vertices.forEach((vertex, index) => {
        const offset = offsets?.get(vertex.id);
        if (offset) {
          mesh.vertices[index * 4] = mesh.vertices[index * 4]! + offset.x;
          mesh.vertices[index * 4 + 1] = mesh.vertices[index * 4 + 1]! + offset.y;
        }
      });
      return;
    }
    const slot = this.rig.getSlot(id);
    const mount = this.getSlotMount(id);
    composeAffine(transformToAffine(mount, this.slotMatrix), this.nodes.get(slot.bone)!.world, this.meshMatrix);
    composeAffine(transformToAffine(mesh, this.slotMatrix), this.meshMatrix, this.posedMesh);
    if (!worldToLocal({ x: 0, y: 0 }, this.posedMesh))
      throw new Error(`Mesh slot "${id}" requires nonsingular posed bone, slot and attachment transforms.`);
    // Render through existing affine slot mounts: cancel their posed transform once,
    // leaving Puppet/Actor placement, facing, alpha, depth and borrowed textures untouched.
    deformMesh(binding, this.readMeshBone, mesh.vertices, offsets);
    for (let index = 0; index < mesh.vertices.length; index += 4) {
      const local = worldToLocal({ x: mesh.vertices[index]!, y: mesh.vertices[index + 1]! }, this.posedMesh)!;
      mesh.vertices[index] = local.x;
      mesh.vertices[index + 1] = local.y;
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
    this.slotMeshes.clear();
    this.meshBindings.clear();
    this.slotArtwork.clear();
    this.artworkTextures.clear();
    this.individualArtwork.clear();
    this.slotDepthOverrides.clear();
    this.nodes.clear();
    this.pending.length = 0;
    this.appearanceValues.length = 0;
  }
}
