import Phaser from 'phaser';
import { localToWorld, worldToLocal } from './affineMath.js';
import { type AnimationClip, type AnimationPlaybackMode, type CompiledClip, compileClip } from './AnimationClip.js';
import {
  type AnimationCompletion,
  AnimationPlayer,
  type FiredAnimationEvent,
  type PlayAnimationOptions,
  type SampleAnimationOptions,
} from './AnimationPlayer.js';
import type { ArtworkReference, ArtworkReplacement, ArtworkUsage } from './artworkReplacement.js';
import { Bone } from './Bone.js';
import type { CharacterDefinition } from './CharacterDefinition.js';
import { RIG_FORMAT_VERSION, type RigJsonDefinition } from './externalData.js';
import { IKDebug } from './ik/IKDebug.js';
import { parseTwoBoneIKDefinition, TwoBoneIKConstraint } from './ik/TwoBoneIKConstraint.js';
import type { IKTarget, IKTransformContext, TwoBoneIKDefinition } from './ik/types.js';
import { throwNotificationErrors } from './notifications.js';
import { type PoseDefinition, parsePoseDefinition } from './Pose.js';
import { PuppetAttachments } from './PuppetAttachments.js';
import { PuppetDebug } from './PuppetDebug.js';
import { PuppetPoseController, type SyncPoseOptions } from './PuppetPoseController.js';
import { PuppetRenderer } from './PuppetRenderer.js';
import { Rig } from './Rig.js';
import { SlotDebug } from './SlotDebug.js';
import { SlotState } from './SlotState.js';
import type { AttachmentOptions, Facing, RigDefinition, SkinDefinition, SpriteAttachmentDefinition } from './types.js';
import { assertFinite } from './types.js';

export type { SyncPoseOptions } from './PuppetPoseController.js';

interface PuppetSettings {
  x?: number;
  y?: number;
  scale?: number;
  depth?: number;
  facing?: Facing;
  animations?: readonly AnimationClip[];
  poses?: readonly PoseDefinition[];
  debug?: boolean;
  ik?: readonly TwoBoneIKDefinition[];
  ikDebug?: boolean;
  slotDebug?: boolean;
  skin?: string;
  /** Disable if the host calls update(deltaMilliseconds) itself. */
  autoUpdate?: boolean;
}

export type PuppetOptions = PuppetSettings &
  ({ rig: RigDefinition | Rig; definition?: never } | { definition: CharacterDefinition; rig?: never });

export class Puppet {
  readonly rig: Rig;
  readonly container: Phaser.GameObjects.Container;
  readonly animationPlayer: AnimationPlayer;
  private readonly destroyContainer: Phaser.GameObjects.Container['destroy'];
  private readonly bones = new Map<string, Bone>();
  private readonly attachments: PuppetAttachments;
  private debugView: PuppetDebug | undefined;
  private readonly debugLabelSides = new Map<string, Facing>();
  private readonly renderer: PuppetRenderer;
  private slotState: SlotState;
  private slotDebugView: SlotDebug | undefined;
  private readonly renderedSlotAttachments = new Map<string, string>();
  private readonly renderedSlotDefinitions = new Map<string, Readonly<SpriteAttachmentDefinition>>();
  private readonly ikConstraints = new Map<string, TwoBoneIKConstraint>();
  private readonly poseController: PuppetPoseController;
  private ikAnimationSource: Pick<AnimationPlayer, 'ikAnimation'> | undefined;
  private readonly prepareAnimationPose = (): void => this.preparePose();
  private readonly synchronizeAnimationPose = (): void => this.syncPose();
  private readonly ikContext: IKTransformContext = {
    puppetToWorld: (target) => localToWorld(target, this.container.getWorldTransformMatrix()),
    worldToPuppet: (target) => worldToLocal(target, this.container.getWorldTransformMatrix(), 0),
    endToWorld: (id, offset) => localToWorld(offset, this.getBone(id).container.getWorldTransformMatrix()),
    worldToParent: (id, target) => {
      const parent = this.getBone(id).container.parentContainer;
      // IK accepts nonsingular ancestors; editor gestures use the helper's default tolerance.
      return worldToLocal(target, parent.getWorldTransformMatrix(), 0);
    },
  };
  private readonly poses = new Map<string, PoseDefinition>();
  private ikDebugView: IKDebug | undefined;
  private facing: Facing;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    options: PuppetOptions,
  ) {
    const rig = options.rig ?? options.definition?.rig;
    if (!rig) throw new Error('Puppet requires a rig or character definition.');
    this.rig = rig instanceof Rig ? rig : new Rig(rig);
    for (const bone of this.rig.bones) {
      if (bone.sprite) this.validateSpriteAsset(bone.sprite, `bone "${bone.id}"`);
    }
    for (const attachment of this.rig.attachments)
      this.validateSpriteAsset(attachment, `attachment "${attachment.id}"`);
    for (const [label, value] of Object.entries({
      x: options.x ?? 0,
      y: options.y ?? 0,
      scale: options.scale ?? 1,
      depth: options.depth ?? 0,
    }))
      assertFinite(value, `Puppet ${label}`);
    if ((options.scale ?? 1) <= 0) throw new Error('Puppet scale must be greater than zero.');

    // Reject authored data before any Phaser objects or scene listeners are created.
    let compiledAnimations: readonly CompiledClip[];
    if (options.definition && options.animations === undefined) {
      compiledAnimations = options.definition.compiledAnimations;
    } else {
      const clips: CompiledClip[] = [];
      const animationNames = new Set<string>();
      for (const clip of options.animations ?? []) {
        if (animationNames.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
        clips.push(compileClip(clip, this.rig));
        animationNames.add(clip.name);
      }
      compiledAnimations = clips;
    }
    for (const pose of options.poses ?? options.definition?.poses ?? []) this.addPose(pose);
    this.slotState = new SlotState(this.rig);
    const skin = options.skin ?? options.definition?.defaultSkin;
    if (skin) this.slotState.setSkin(skin);
    const ikDefinitions = (options.ik ?? this.rig.ik ?? []).map((definition) =>
      parseTwoBoneIKDefinition(definition, this.rig),
    );
    const ikNames = new Set<string>();
    for (const definition of ikDefinitions) {
      if (ikNames.has(definition.name)) throw new Error(`IK "${definition.name}" is already registered.`);
      ikNames.add(definition.name);
    }
    this.facing = options.facing ?? 'right';
    if (this.facing !== 'left' && this.facing !== 'right') throw new Error(`Invalid facing: ${String(this.facing)}.`);

    this.container = scene.add
      .container(options.x ?? 0, options.y ?? 0)
      .setName('puppet')
      .setScale(options.scale ?? 1)
      .setDepth(options.depth ?? 0);
    this.destroyContainer = this.container.destroy.bind(this.container);
    for (const definition of this.rig.bones) {
      const bone = new Bone(scene, definition);
      this.bones.set(bone.id, bone);
      const parent = definition.parent ? this.getBone(definition.parent).container : this.container;
      parent.add(bone.container);
    }
    for (const bone of this.bones.values()) bone.container.sort('depth');
    this.renderer = new PuppetRenderer(scene, this.container, this.rig, this.bones);
    this.attachments = new PuppetAttachments(
      scene,
      (id) => this.getBone(id).container,
      (id, slotId) => (slotId === undefined ? this.renderer.getMount(id) : this.renderer.getSlotMount(slotId)),
    );
    this.animationPlayer = new AnimationPlayer(this.rig, this.bones, compiledAnimations);
    this.renderSlots();
    this.poseController = new PuppetPoseController(
      this.bones,
      this.ikConstraints,
      this.ikContext,
      this.renderer,
      (constraints) => this.updateDebugViews(constraints),
      () => (this.ikAnimationSource ?? this.animationPlayer).ikAnimation,
    );
    for (const definition of ikDefinitions) this.addIK(definition);
    this.setFacing(this.facing);
    this.setDebug(options.debug ?? false);
    this.setIKDebug(options.ikDebug ?? false);
    this.setSlotDebug(options.slotDebug ?? false);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    if (options.autoUpdate !== false) scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.container.once(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    // Phaser's preDestroy recursively removes children before emitting DESTROY.
    // Route host/display-list destruction through our leaf-first cleanup first.
    this.container.destroy = (fromScene?: boolean): void => {
      if (this.destroyed) {
        // A host may release an ignored root after disposing its puppet.
        if (!this.container.isDestroyed) this.destroyContainer(fromScene);
      } else if (!this.container.ignoreDestroy) this.destroyInternal(fromScene);
    };
  }

  private validateSpriteAsset(sprite: { texture: string; frame?: string | number }, owner: string): void {
    if (!this.scene.textures.exists(sprite.texture))
      throw new Error(`Missing texture "${sprite.texture}" for ${owner}.`);
    if (sprite.frame !== undefined && !this.scene.textures.get(sprite.texture).has(String(sprite.frame)))
      throw new Error(`Missing frame "${sprite.frame}" for ${owner}.`);
  }

  get currentAnimation(): string | undefined {
    return this.animationPlayer.currentAnimation;
  }
  get isPlaying(): boolean {
    return this.animationPlayer.isPlaying;
  }
  get isDebug(): boolean {
    return this.debugView?.container.visible ?? false;
  }
  get isIKDebug(): boolean {
    return this.ikDebugView?.container.visible ?? false;
  }
  get isSlotDebug(): boolean {
    return this.slotDebugView?.container.visible ?? false;
  }
  get facingDirection(): Facing {
    return this.facing;
  }

  /** Share current artwork/layout with a compatible render-only preview; leaves both poses untouched. */
  copyAppearanceTo(renderer: PuppetRenderer, tint: number): void {
    renderer.copyAppearanceFrom(this.renderer, tint);
  }

  /** @internal Detect current artwork changes shared by all render-only previews. */
  getAppearanceRevision(): number {
    return this.renderer.getAppearanceRevision();
  }

  /** Preview a loaded image for an asset without editing the rig, slots, poses or animations.
   * The host owns replacement textures and must restore artwork before releasing them.
   */
  setArtworkTexture(assetKey: string, replacementKey?: string): this {
    this.renderer.setArtworkTexture(assetKey, replacementKey);
    return this;
  }

  getArtworkUsages(): readonly ArtworkUsage[] {
    return this.renderer.getArtworkUsages();
  }

  getArtworkReplacement(assetKey: string, reference?: ArtworkReference): ArtworkReplacement | undefined {
    return this.renderer.getArtworkReplacement(assetKey, reference);
  }

  /** Preflight a transaction spanning several shared and individual replacements. */
  validateArtworkReplacement(assetKey: string, replacement?: ArtworkReplacement, reference?: ArtworkReference): void {
    this.renderer.validateArtworkReplacement(assetKey, replacement, reference);
  }

  setArtworkReplacement(assetKey: string, replacement?: ArtworkReplacement, reference?: ArtworkReference): this {
    this.renderer.setArtworkReplacement(assetKey, replacement, reference);
    return this;
  }

  setArtworkOrigin(
    reference: ArtworkReference,
    assetKey: string,
    image: Phaser.GameObjects.Image,
    x: number,
    y: number,
  ): void {
    this.renderer.setArtworkOrigin(reference, assetKey, image, x, y);
  }

  getBone(id: string): Bone {
    const bone = this.bones.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  setBoneRotation(id: string, rotation: number): this {
    assertFinite(rotation, `${id}.rotation`);
    const bone = this.getBone(id);
    this.preparePose();
    bone.pose.rotation = rotation;
    this.syncPose();
    return this;
  }

  addPose(input: PoseDefinition): this {
    const pose = parsePoseDefinition(input, this.rig);
    if (this.poses.has(pose.name)) throw new Error(`Pose "${pose.name}" is already registered.`);
    this.poses.set(pose.name, pose);
    return this;
  }

  /** Persistent sparse override, evaluated after animation layers and before IK. */
  applyPose(name: string, options: { mix?: number } = {}): this {
    const pose = this.poses.get(name);
    if (!pose) throw new Error(`Unknown pose "${name}".`);
    const mix = options.mix ?? 1;
    if (!Number.isFinite(mix) || mix < 0 || mix > 1) throw new Error('Pose mix must be between 0 and 1.');
    this.preparePose();
    this.poseController.setActivePose(pose, mix);
    this.syncPose();
    return this;
  }

  clearPose(): this {
    this.preparePose();
    this.poseController.clearActivePose();
    this.syncPose();
    return this;
  }

  /** Keep the visible authored preset values and enter direct manual editing. */
  commitPoseForEditing(): this {
    this.poseController.commitPoseForEditing();
    this.syncPose();
    return this;
  }

  /** Snapshot authored transforms without changing the held pose, rendering, or IK state. */
  exportPose(name: string, options?: { epsilon?: number; onlyChanged?: boolean }): PoseDefinition {
    return this.poseController.exportPose(name, options);
  }

  /** Data only: normalized rig values, including pivots, slots and sprite offsets. */
  exportRig(): RigJsonDefinition {
    return JSON.parse(
      JSON.stringify({
        version: RIG_FORMAT_VERSION,
        root: this.rig.root,
        ...(this.rig.ik === undefined ? {} : { ik: this.rig.ik }),
        bones: this.rig.bones,
        slots: this.rig.slots,
        attachments: this.rig.attachments,
        skins: this.rig.skins,
      }),
    ) as RigJsonDefinition;
  }

  addAnimation(clip: AnimationClip): this {
    this.animationPlayer.addAnimation(clip);
    return this;
  }

  play(name: string, options?: PlayAnimationOptions): this {
    this.animationPlayer.play(name, options, this.prepareAnimationPose, this.synchronizeAnimationPose);
    return this;
  }

  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    return this.animationPlayer.onAnimationEvent(listener);
  }

  onAnimationComplete(listener: (event: AnimationCompletion) => void): () => void {
    return this.animationPlayer.onAnimationComplete(listener);
  }

  pauseAnimation(): this {
    this.animationPlayer.pause();
    return this;
  }
  resumeAnimation(): this {
    this.animationPlayer.resume();
    return this;
  }
  setAnimationSpeed(speed: number): this {
    this.animationPlayer.setSpeed(speed);
    return this;
  }
  setAnimationPlaybackMode(mode: AnimationPlaybackMode): this {
    this.animationPlayer.setPlaybackMode(mode, this.prepareAnimationPose);
    this.syncPose();
    return this;
  }
  setAnimationFPS(fps: number): this {
    return this.setAnimationPlaybackMode({ mode: 'stepped', fps });
  }
  setLayerMask(name: string, bones: readonly string[]): this {
    this.animationPlayer.setLayerMask(name, bones, this.prepareAnimationPose);
    this.syncPose();
    return this;
  }
  setLayerWeight(name: string, weight: number): this {
    this.animationPlayer.setLayerWeight(name, weight, this.prepareAnimationPose);
    this.syncPose();
    return this;
  }
  clearLayer(name: string): this {
    this.animationPlayer.clearLayer(name, this.prepareAnimationPose);
    this.syncPose();
    return this;
  }

  stop(): this {
    this.animationPlayer.stop();
    return this;
  }

  restart(): this {
    this.animationPlayer.restart(this.prepareAnimationPose, this.synchronizeAnimationPose);
    return this;
  }

  /** Preview the base clip at milliseconds without moving clocks or firing events.
   * Restore temporary pose/IK changes before sampling, then synchronize presets, IK, and rendering.
   */
  sampleAnimation(time: number, options: SampleAnimationOptions = {}): this {
    this.animationPlayer.sample(time, options, this.prepareAnimationPose);
    this.syncPose();
    return this;
  }

  resetPose(): this {
    this.preparePose();
    this.poseController.clearActivePose();
    this.stop();
    this.animationPlayer.resetPose();
    this.syncPose();
    return this;
  }

  resetToBindPose(): this {
    this.preparePose();
    this.poseController.clearActivePose();
    this.animationPlayer.stop();
    this.animationPlayer.clearAllLayers();
    this.animationPlayer.resetPose();
    for (const constraint of this.ikConstraints.values()) constraint.enabled = false;
    this.syncPose();
    return this;
  }

  setFacing(facing: Facing): this {
    if (facing !== 'left' && facing !== 'right') throw new Error(`Invalid facing: ${String(facing)}.`);
    this.facing = facing;
    // Mirror outside the animated skeleton, preserving every local joint angle.
    this.container.scaleX = Math.abs(this.container.scaleX) * (facing === 'left' ? -1 : 1);
    this.syncPose();
    return this;
  }

  /** Immutable snapshot of bone ids in back-to-front order, stable until the order changes. */
  getRenderOrder(): readonly string[] {
    return this.renderer.getOrder();
  }

  /** Batch slot depths with the bone order; undefined clears an override and omitted slots keep theirs. */
  setRenderOrder(order: readonly string[], slotDepths?: ReadonlyMap<string, number | undefined>): this {
    if (slotDepths) {
      for (const [id, depth] of slotDepths) if (depth !== undefined) assertFinite(depth, `Slot ${id}.depth`);
    }
    this.renderer.setOrder(order, slotDepths);
    return this;
  }

  resetRenderOrder(): this {
    return this.setRenderOrder(this.rig.renderOrder);
  }

  getAttachment(slot: string): string | undefined {
    return this.slotState.getAttachment(slot);
  }

  getSlotImage(slot: string): Phaser.GameObjects.Image | undefined {
    this.slotState.getAttachment(slot);
    return this.renderer.getSlotImage(slot);
  }

  /** Update supplied slot transform properties, preserving omitted values and its attachment.
   * Pass sync = false to batch changes, then call syncPose() after the final edit.
   */
  setSlotTransform(
    id: string,
    values: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number },
    sync = true,
  ): this {
    this.renderer.setSlotTransform(id, values);
    if (sync) this.syncPose();
    return this;
  }

  setSlotDepth(id: string, depth: number): this {
    assertFinite(depth, `Slot ${id}.depth`);
    this.renderer.setSlotDepth(id, depth);
    return this;
  }

  /** Clear a runtime depth override and restore the rig's slot placement. */
  clearSlotDepth(id: string): this {
    this.renderer.clearSlotDepth(id);
    return this;
  }

  setAttachment(slot: string, attachment: string): this {
    if (this.slotState.setAttachment(slot, attachment) && this.renderSlot(slot)) this.slotDebugView?.update();
    return this;
  }

  /** Update the artwork catalog and skins in place; skeleton, player, IK and slot mounts retain identity. */
  updateSlotDefinitions(attachments: readonly SpriteAttachmentDefinition[], skins: readonly SkinDefinition[]): this {
    const previous = this.slotState;
    const next = new SlotState(previous);
    next.updateDefinitions(attachments, skins);
    // Validate inactive artwork too, including the effective shared/individual replacement frame.
    for (const attachment of next.getDefinitions()) {
      const owner = `attachment "${attachment.id}"`;
      this.validateSpriteAsset(attachment, owner);
      const replacement = this.renderer.getArtworkReplacement(attachment.texture, `attachment:${attachment.id}`);
      if (replacement) this.validateSpriteAsset({ ...attachment, texture: replacement.textureKey }, owner);
    }
    this.slotState = next;
    try {
      this.renderer.updateArtworkDefinitions(next.getDefinitions(), next.getSkins());
      this.renderSlots();
    } catch (error) {
      this.slotState = previous;
      try {
        this.renderer.updateArtworkDefinitions(previous.getDefinitions(), previous.getSkins());
        this.renderSlots();
      } catch (rollbackError) {
        // oxlint-disable-next-line eslint/preserve-caught-error -- Both failures are retained in AggregateError.errors.
        throw new AggregateError([error, rollbackError], 'Attachment update and rollback failed.', { cause: error });
      }
      throw error;
    }
    return this;
  }

  clearAttachment(slot: string): this {
    if (this.slotState.clearAttachment(slot) && this.renderSlot(slot)) this.slotDebugView?.update();
    return this;
  }

  setSkin(name: string): this {
    this.slotState.setSkin(name);
    this.renderSlots();
    return this;
  }

  applySkin(name: string): this {
    this.slotState.applySkin(name);
    this.renderSlots();
    return this;
  }

  setSlotDebug(enabled: boolean): this {
    if (this.destroyed) return this;
    if (enabled) this.slotDebugView ??= new SlotDebug(this.scene, this.rig, this.renderer, this.slotState);
    this.slotDebugView?.container.setDepth(this.container.depth + 3);
    this.slotDebugView?.setVisible(enabled);
    return this;
  }

  private renderSlots(): void {
    let changed = false;
    for (const slot of this.rig.slots) {
      if (this.renderSlot(slot.id)) changed = true;
    }
    if (changed) this.slotDebugView?.update();
  }

  private renderSlot(slot: string): boolean {
    const id = this.slotState.getAttachment(slot);
    const definition = id ? this.slotState.getDefinition(id) : undefined;
    if (this.renderedSlotAttachments.get(slot) === id && this.renderedSlotDefinitions.get(slot) === definition)
      return false;
    this.renderer.setSlotAttachment(slot, definition);
    if (definition) this.renderedSlotDefinitions.set(slot, definition);
    else this.renderedSlotDefinitions.delete(slot);
    if (id) this.renderedSlotAttachments.set(slot, id);
    else this.renderedSlotAttachments.delete(slot);
    return true;
  }

  attach(boneId: string, object: Phaser.GameObjects.GameObject, options: AttachmentOptions = {}): this {
    this.attachments.attach(boneId, object, options);
    return this;
  }

  /** Attach a prop at a slot's transform and global layer, independently of its sprite. */
  attachToSlot(slotId: string, object: Phaser.GameObjects.GameObject, options: AttachmentOptions = {}): this {
    this.attachments.attach(this.rig.getSlot(slotId).bone, object, options, slotId);
    return this;
  }

  /** Release to the scene display list; the object's local transform is retained. */
  detach(object: Phaser.GameObjects.GameObject): boolean {
    return this.attachments.detach(object);
  }

  setDebug(enabled: boolean): this {
    if (this.destroyed) return this;
    if (enabled && !this.debugView) {
      this.debugView = new PuppetDebug(this.scene, this.bones);
      for (const [id, side] of this.debugLabelSides) this.debugView.setLabelSide(id, side);
    }
    this.debugView?.container.setDepth(this.container.depth + 1);
    this.debugView?.setVisible(enabled);
    return this;
  }

  addIK(definition: TwoBoneIKDefinition): TwoBoneIKConstraint {
    if (this.ikConstraints.has(definition.name)) {
      throw new Error(`IK "${definition.name}" is already registered.`);
    }
    const constraint = new TwoBoneIKConstraint(definition, this.rig, this.bones);
    this.ikConstraints.set(constraint.name, constraint);
    return constraint;
  }

  getIK(name: string): TwoBoneIKConstraint {
    const constraint = this.ikConstraints.get(name);
    if (!constraint) throw new Error(`Unknown IK "${name}".`);
    return constraint;
  }

  setIKTarget(name: string, target: IKTarget): this;
  setIKTarget(name: string, x: number, y: number): this;
  setIKTarget(name: string, targetOrX: IKTarget | number, y?: number): this {
    const constraint = this.getIK(name);
    if (typeof targetOrX === 'number') {
      if (y === undefined) throw new Error('IK target needs x and y.');
      constraint.setTarget(targetOrX, y);
    } else constraint.setTarget(targetOrX);
    return this;
  }

  setIKDebug(enabled: boolean): this {
    if (this.destroyed) return this;
    if (enabled) this.ikDebugView ??= new IKDebug(this.scene, this.bones);
    if (this.ikDebugView) {
      this.ikDebugView.container.setDepth(this.container.depth + 2).setVisible(enabled);
      this.ikDebugView.update(this.poseController.getOrderedConstraints());
    }
    return this;
  }

  /** Choose a screen side for a pivot label; omit side to restore automatic placement. */
  setDebugLabelSide(boneId: string, side?: Facing): this {
    this.getBone(boneId);
    if (side !== undefined && side !== 'left' && side !== 'right')
      throw new Error(`Invalid label side: ${String(side)}.`);
    if (side === undefined) this.debugLabelSides.delete(boneId);
    else this.debugLabelSides.set(boneId, side);
    this.debugView?.setLabelSide(boneId, side);
    return this;
  }

  update(delta: number): void {
    if (this.destroyed) return;
    const evaluated = this.animationPlayer.update(delta, this.prepareAnimationPose, this.synchronizeAnimationPose);
    if (!evaluated) this.syncPose();
  }

  destroy(): void {
    this.destroyInternal();
  }

  private destroyInternal(fromScene?: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ikAnimationSource = undefined;
    this.animationPlayer.dispose();
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.container.off(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    const errors: unknown[] = [];
    const release = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => this.debugView?.destroy());
    release(() => this.ikDebugView?.destroy());
    release(() => this.slotDebugView?.destroy());
    this.debugView = undefined;
    this.ikDebugView = undefined;
    this.slotDebugView = undefined;
    this.debugLabelSides.clear();
    release(() => this.attachments.dispose());
    release(() => this.renderer.destroy());
    // Rig order is parent-first. Remove leaves first so Phaser never recursively
    // tears down the entire skeleton during puppet or scene cleanup.
    for (let index = this.rig.bones.length - 1; index >= 0; --index) {
      const container = this.bones.get(this.rig.bones[index]!.id)?.container;
      if (container && !container.isDestroyed) release(() => container.destroy());
    }
    if (!this.container.isDestroyed) release(() => this.destroyContainer(fromScene));
    this.renderedSlotAttachments.clear();
    this.renderedSlotDefinitions.clear();
    this.poses.clear();
    this.bones.clear();
    this.ikConstraints.clear();
    release(() => this.poseController.destroy());
    throwNotificationErrors(errors, 'Puppet cleanup failed.');
  }

  private onUpdate(_time: number, delta: number): void {
    this.update(delta);
  }

  /** Restore the pre-IK pose before externally sampling animation or editing it. */
  preparePose(): void {
    this.poseController.preparePose();
  }

  /** Use an external pose player's IK channels (for editor previews); undefined restores the runtime player. */
  setIKAnimationSource(player: Pick<AnimationPlayer, 'ikAnimation'> | undefined): void {
    this.ikAnimationSource = player;
  }

  /** Apply the evaluated pose, solve IK in priority order, then project rendering. */
  syncPose(options: SyncPoseOptions = {}): void {
    if (!this.destroyed) this.poseController.syncPose(options);
  }

  /** Rerun constraints after changing targets, mix, enabled state, offsets, bend direction, or priorities.
   * Use syncPose() first whenever authored poses or skeleton transforms have changed.
   * Retains active pose presets and projects only the restored/solved IK joints.
   */
  syncIK(options: SyncPoseOptions = {}): void {
    if (!this.destroyed) this.poseController.syncIK(options);
  }

  /** Refresh overlays from the final synchronized pose without running animation or IK again. */
  refreshDebugViews(): void {
    if (!this.destroyed) this.updateDebugViews(this.poseController.getOrderedConstraints());
  }

  private updateDebugViews(constraints: readonly TwoBoneIKConstraint[]): void {
    this.debugView?.container.setDepth(this.container.depth + 1);
    this.debugView?.update();
    this.ikDebugView?.container.setDepth(this.container.depth + 2);
    this.ikDebugView?.update(constraints);
    this.slotDebugView?.container.setDepth(this.container.depth + 3);
    this.slotDebugView?.update();
  }
}
