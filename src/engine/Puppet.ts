import Phaser from 'phaser';
import { type AnimationClip, type AnimationPlaybackMode, type CompiledClip, compileClip } from './AnimationClip.js';
import {
  type AnimationCompletion,
  AnimationPlayer,
  type FiredAnimationEvent,
  type PlayAnimationOptions,
} from './AnimationPlayer.js';
import { Bone } from './Bone.js';
import type { CharacterDefinition } from './CharacterDefinition.js';
import { RIG_FORMAT_VERSION, type RigJsonDefinition } from './externalData.js';
import { IKDebug } from './ik/IKDebug.js';
import { parseTwoBoneIKDefinition, TwoBoneIKConstraint } from './ik/TwoBoneIKConstraint.js';
import type { IKTarget, IKTransformContext, TwoBoneIKDefinition } from './ik/types.js';
import { type PoseDefinition, parsePoseDefinition } from './Pose.js';
import { PuppetDebug } from './PuppetDebug.js';
import { PuppetPoseController, type SyncPoseOptions } from './PuppetPoseController.js';

import { PuppetRenderer } from './PuppetRenderer.js';
import { Rig } from './Rig.js';
import { SlotDebug } from './SlotDebug.js';
import { SlotState } from './SlotState.js';
import type { AttachmentOptions, Facing, RigDefinition } from './types.js';
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
  private readonly bones = new Map<string, Bone>();
  private readonly attachments = new Map<Phaser.GameObjects.GameObject, Phaser.GameObjects.Container>();
  private readonly debugView: PuppetDebug;
  private readonly renderer: PuppetRenderer;
  private readonly slotState: SlotState;
  private readonly slotDebugView: SlotDebug;
  private readonly renderedSlotAttachments = new Map<string, string>();
  private readonly ikConstraints = new Map<string, TwoBoneIKConstraint>();
  private readonly poseController: PuppetPoseController;
  private readonly prepareAnimationPose = (): void => this.preparePose();
  private readonly ikContext: IKTransformContext = {
    worldToParent: (id, target) => {
      const parent = this.getBone(id).container.parentContainer!;
      const matrix = parent.getWorldTransformMatrix();
      const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
      if (!Number.isFinite(determinant) || determinant === 0) return undefined;
      const point = matrix.applyInverse(target.x, target.y);
      return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
    },
  };
  private readonly poses = new Map<string, PoseDefinition>();
  private readonly ikDebugView: IKDebug;
  private facing: Facing;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    options: PuppetOptions,
  ) {
    const rig = options.rig ?? options.definition?.rig;
    if (!rig) throw new Error('Puppet requires a rig or character definition.');
    this.rig = rig instanceof Rig ? rig : new Rig(rig);
    const validateSpriteAsset = (sprite: { texture: string; frame?: string | number }, owner: string): void => {
      if (!scene.textures.exists(sprite.texture)) throw new Error(`Missing texture "${sprite.texture}" for ${owner}.`);
      if (sprite.frame !== undefined && !scene.textures.get(sprite.texture).has(String(sprite.frame)))
        throw new Error(`Missing frame "${sprite.frame}" for ${owner}.`);
    };
    for (const bone of this.rig.bones) {
      if (bone.sprite) validateSpriteAsset(bone.sprite, `bone "${bone.id}"`);
    }
    for (const attachment of this.rig.attachments) validateSpriteAsset(attachment, `attachment "${attachment.id}"`);
    for (const [label, value] of Object.entries({
      x: options.x ?? 0,
      y: options.y ?? 0,
      scale: options.scale ?? 1,
      depth: options.depth ?? 0,
    }))
      assertFinite(value, `Puppet ${label}`);
    if ((options.scale ?? 1) <= 0) throw new Error('Puppet scale must be greater than zero.');

    // Reject authored data before any Phaser objects or scene listeners are created.
    const animations = options.animations ?? options.definition?.animations ?? [];
    const compiledAnimations: CompiledClip[] = [];
    const animationNames = new Set<string>();
    for (const clip of animations) {
      if (animationNames.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
      compiledAnimations.push(compileClip(clip, this.rig));
      animationNames.add(clip.name);
    }
    for (const pose of options.poses ?? options.definition?.poses ?? []) this.addPose(pose);
    this.slotState = new SlotState(this.rig);
    const skin = options.skin ?? options.definition?.defaultSkin;
    if (skin) this.slotState.setSkin(skin);
    const ikDefinitions = (options.ik ?? []).map((definition) => parseTwoBoneIKDefinition(definition, this.rig));
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
    for (const definition of this.rig.bones) {
      const bone = new Bone(scene, definition);
      this.bones.set(bone.id, bone);
      const parent = definition.parent ? this.getBone(definition.parent).container : this.container;
      parent.add(bone.container);
    }
    for (const bone of this.bones.values()) bone.container.sort('depth');
    this.renderer = new PuppetRenderer(scene, this.container, this.rig, this.bones);
    this.slotDebugView = new SlotDebug(scene, this.rig, this.renderer, this.slotState);
    this.animationPlayer = new AnimationPlayer(this.rig, this.bones, compiledAnimations);
    this.debugView = new PuppetDebug(scene, this.bones);
    this.renderSlots();
    this.ikDebugView = new IKDebug(scene, this.bones);
    this.poseController = new PuppetPoseController(
      this.bones,
      this.ikConstraints,
      this.ikContext,
      this.renderer,
      (constraints) => this.updateDebugViews(constraints),
    );
    for (const definition of ikDefinitions) this.addIK(definition);
    this.setFacing(this.facing);
    this.setDebug(options.debug ?? false);
    this.setIKDebug(options.ikDebug ?? false);
    this.setSlotDebug(options.slotDebug ?? false);
    if (options.autoUpdate !== false) scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.container.once(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
  }

  get currentAnimation(): string | undefined {
    return this.animationPlayer.currentAnimation;
  }
  get isPlaying(): boolean {
    return this.animationPlayer.isPlaying;
  }
  get isDebug(): boolean {
    return this.debugView.container.visible;
  }
  get isIKDebug(): boolean {
    return this.ikDebugView.container.visible;
  }
  get isSlotDebug(): boolean {
    return this.slotDebugView.container.visible;
  }
  get facingDirection(): Facing {
    return this.facing;
  }

  getBone(id: string): Bone {
    const bone = this.bones.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  setBoneRotation(id: string, rotation: number): this {
    assertFinite(rotation, `${id}.rotation`);
    this.preparePose();
    const bone = this.getBone(id);
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

  /** Excludes IK by restoring its temporary changes before taking a snapshot. */
  exportPose(name: string, options?: { epsilon?: number; onlyChanged?: boolean }): PoseDefinition {
    const pose = this.poseController.exportPose(name, options);
    this.syncPose();
    return pose;
  }

  /** Data only: normalized rig values, including pivots, slots and sprite offsets. */
  exportRig(): RigJsonDefinition {
    return JSON.parse(
      JSON.stringify({
        version: RIG_FORMAT_VERSION,
        root: this.rig.root,
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
    this.preparePose();
    this.animationPlayer.play(name, options);
    this.syncPose();
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
    this.preparePose();
    this.animationPlayer.setPlaybackMode(mode);
    this.syncPose();
    return this;
  }
  setAnimationFPS(fps: number): this {
    return this.setAnimationPlaybackMode({ mode: 'stepped', fps });
  }
  setLayerMask(name: string, bones: readonly string[]): this {
    this.preparePose();
    this.animationPlayer.setLayerMask(name, bones);
    this.syncPose();
    return this;
  }
  setLayerWeight(name: string, weight: number): this {
    this.preparePose();
    this.animationPlayer.setLayerWeight(name, weight);
    this.syncPose();
    return this;
  }
  clearLayer(name: string): this {
    this.preparePose();
    this.animationPlayer.clearLayer(name);
    this.syncPose();
    return this;
  }

  stop(): this {
    this.animationPlayer.stop();
    return this;
  }

  restart(): this {
    this.preparePose();
    this.animationPlayer.restart();
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

  /** Bone ids in back-to-front order, independent of joint parenting. */
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
    this.slotState.setAttachment(slot, attachment);
    this.renderSlots();
    return this;
  }

  clearAttachment(slot: string): this {
    this.slotState.clearAttachment(slot);
    this.renderSlots();
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
    this.slotDebugView.setVisible(enabled);
    return this;
  }

  private renderSlots(): void {
    for (const slot of this.rig.slots) {
      const id = this.slotState.getAttachment(slot.id);
      if (this.renderedSlotAttachments.get(slot.id) === id) continue;
      this.renderer.setSlotAttachment(slot.id, id ? this.rig.getAttachment(id) : undefined);
      if (id) this.renderedSlotAttachments.set(slot.id, id);
      else this.renderedSlotAttachments.delete(slot.id);
    }
    this.slotDebugView.update();
  }

  attach(boneId: string, object: Phaser.GameObjects.GameObject, options: AttachmentOptions = {}): this {
    const bone = this.getBone(boneId);
    const renderMount = this.renderer.getMount(boneId);
    if (object.scene !== this.scene) throw new Error('Attachments must belong to the puppet scene.');
    for (
      let ancestor: Phaser.GameObjects.Container | null = bone.container;
      ancestor;
      ancestor = ancestor.parentContainer
    ) {
      if (ancestor === object) throw new Error('Cannot attach an ancestor of the target bone.');
    }
    for (
      let ancestor: Phaser.GameObjects.Container | null = renderMount;
      ancestor;
      ancestor = ancestor.parentContainer
    ) {
      if (ancestor === object) throw new Error('Cannot attach an ancestor of the render mount.');
    }
    for (const [label, value] of Object.entries(options)) assertFinite(value, `Attachment ${label}`);
    this.detach(object);
    // A wrapper permits any Phaser GameObject without changing its own transform.
    const mount = this.scene.add
      .container(options.x ?? 0, options.y ?? 0)
      .setRotation(options.rotation ?? 0)
      .setDepth(options.depth ?? 1);
    mount.add(object);
    renderMount.add(mount).sort('depth');
    this.attachments.set(object, mount);
    return this;
  }

  /** Release to the scene display list; the object's local transform is retained. */
  detach(object: Phaser.GameObjects.GameObject): boolean {
    const mount = this.attachments.get(object);
    if (!mount) return false;
    mount.remove(object);
    mount.destroy();
    this.attachments.delete(object);
    return true;
  }

  setDebug(enabled: boolean): this {
    this.debugView.setVisible(enabled);
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
    this.ikDebugView.container.setVisible(enabled);
    this.ikDebugView.update(this.poseController.getOrderedConstraints());
    return this;
  }

  /** Choose a screen side for a pivot label; omit side to restore automatic placement. */
  setDebugLabelSide(boneId: string, side?: Facing): this {
    this.debugView.setLabelSide(boneId, side);
    return this;
  }

  update(delta: number): void {
    if (this.destroyed) return;
    this.animationPlayer.update(delta, this.prepareAnimationPose);
    this.syncPose();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.container.off(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    this.debugView.destroy();
    this.ikDebugView.destroy();
    this.slotDebugView.destroy();
    this.renderer.destroy();
    if (!this.container.isDestroyed) this.container.destroy();
    this.attachments.clear();
    this.bones.clear();
    this.ikConstraints.clear();
    this.poseController.destroy();
  }

  private onUpdate(_time: number, delta: number): void {
    this.update(delta);
  }

  /** Restore the pre-IK pose before externally sampling animation or editing it. */
  preparePose(): void {
    this.poseController.preparePose();
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
    this.debugView.container.setDepth(this.container.depth + 1);
    this.debugView.update();
    this.ikDebugView.container.setDepth(this.container.depth + 2);
    this.ikDebugView.update(constraints);
    this.slotDebugView.container.setDepth(this.container.depth + 3);
    this.slotDebugView.update();
  }
}
