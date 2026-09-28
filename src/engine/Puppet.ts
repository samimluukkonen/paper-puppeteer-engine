import Phaser from 'phaser';
import { AnimationPlayer } from './AnimationPlayer.js';
import type { AnimationClip } from './AnimationClip.js';
import { Bone } from './Bone.js';
import { PuppetDebug } from './PuppetDebug.js';
import { PuppetRenderer } from './PuppetRenderer.js';
import { Rig } from './Rig.js';
import { assertFinite } from './types.js';
import type { AttachmentOptions, Facing, RigDefinition } from './types.js';

export interface PuppetOptions {
  rig: RigDefinition | Rig;
  x?: number;
  y?: number;
  scale?: number;
  depth?: number;
  facing?: Facing;
  animations?: readonly AnimationClip[];
  debug?: boolean;
  /** Disable if the host calls update(deltaMilliseconds) itself. */
  autoUpdate?: boolean;
}

export class Puppet {
  readonly rig: Rig;
  readonly container: Phaser.GameObjects.Container;
  readonly animationPlayer: AnimationPlayer;
  private readonly bones = new Map<string, Bone>();
  private readonly attachments = new Map<Phaser.GameObjects.GameObject, Phaser.GameObjects.Container>();
  private readonly debugView: PuppetDebug;
  private readonly renderer: PuppetRenderer;
  private facing: Facing;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, options: PuppetOptions) {
    this.rig = options.rig instanceof Rig ? options.rig : new Rig(options.rig);
    for (const bone of this.rig.bones) {
      if (bone.sprite && !scene.textures.exists(bone.sprite.texture)) {
        throw new Error(`Missing texture "${bone.sprite.texture}" for bone "${bone.id}".`);
      }
    }
    for (const [label, value] of Object.entries({
      x: options.x ?? 0, y: options.y ?? 0, scale: options.scale ?? 1, depth: options.depth ?? 0,
    })) assertFinite(value, `Puppet ${label}`);
    if ((options.scale ?? 1) <= 0) throw new Error('Puppet scale must be greater than zero.');

    this.container = scene.add.container(options.x ?? 0, options.y ?? 0)
      .setName('puppet').setScale(options.scale ?? 1).setDepth(options.depth ?? 0);
    for (const definition of this.rig.bones) {
      const bone = new Bone(scene, definition);
      this.bones.set(bone.id, bone);
      const parent = definition.parent ? this.getBone(definition.parent).container : this.container;
      parent.add(bone.container);
    }
    for (const bone of this.bones.values()) bone.container.sort('depth');
    this.renderer = new PuppetRenderer(scene, this.container, this.rig, this.bones);
    this.animationPlayer = new AnimationPlayer(this.rig, this.bones);
    for (const clip of options.animations ?? []) this.addAnimation(clip);
    this.debugView = new PuppetDebug(scene, this.bones);
    this.facing = options.facing ?? 'right';
    this.setFacing(this.facing);
    this.setDebug(options.debug ?? false);
    if (options.autoUpdate !== false) scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.container.once(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
  }

  get currentAnimation(): string | undefined { return this.animationPlayer.currentAnimation; }
  get isPlaying(): boolean { return this.animationPlayer.isPlaying; }
  get isDebug(): boolean { return this.debugView.container.visible; }
  get facingDirection(): Facing { return this.facing; }

  getBone(id: string): Bone {
    const bone = this.bones.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  setBoneRotation(id: string, rotation: number): this {
    assertFinite(rotation, `${id}.rotation`);
    const bone = this.getBone(id);
    bone.pose.rotation = rotation;
    this.syncPose();
    return this;
  }

  addAnimation(clip: AnimationClip): this {
    this.animationPlayer.addAnimation(clip);
    return this;
  }

  play(name: string): this {
    this.animationPlayer.play(name);
    this.syncPose();
    return this;
  }

  stop(): this {
    this.animationPlayer.stop();
    return this;
  }

  restart(): this {
    this.animationPlayer.restart();
    this.syncPose();
    return this;
  }

  resetPose(): this {
    this.stop();
    this.animationPlayer.resetPose();
    this.syncPose();
    return this;
  }

  setFacing(facing: Facing): this {
    if (facing !== 'left' && facing !== 'right') throw new Error(`Invalid facing: ${String(facing)}.`);
    this.facing = facing;
    // Mirror outside the animated skeleton, preserving every local joint angle.
    this.container.scaleX = Math.abs(this.container.scaleX) * (facing === 'left' ? -1 : 1);
    this.debugView.update();
    return this;
  }

  /** Bone ids in back-to-front order, independent of joint parenting. */
  getRenderOrder(): readonly string[] { return this.renderer.getOrder(); }

  setRenderOrder(order: readonly string[]): this {
    this.renderer.setOrder(order);
    return this;
  }

  resetRenderOrder(): this {
    return this.setRenderOrder(this.rig.renderOrder);
  }

  attach(boneId: string, object: Phaser.GameObjects.GameObject, options: AttachmentOptions = {}): this {
    const bone = this.getBone(boneId);
    const renderMount = this.renderer.getMount(boneId);
    if (object.scene !== this.scene) throw new Error('Attachments must belong to the puppet scene.');
    for (let ancestor: Phaser.GameObjects.Container | null = bone.container; ancestor; ancestor = ancestor.parentContainer) {
      if (ancestor === object) throw new Error('Cannot attach an ancestor of the target bone.');
    }
    for (let ancestor: Phaser.GameObjects.Container | null = renderMount; ancestor; ancestor = ancestor.parentContainer) {
      if (ancestor === object) throw new Error('Cannot attach an ancestor of the render mount.');
    }
    for (const [label, value] of Object.entries(options)) assertFinite(value, `Attachment ${label}`);
    this.detach(object);
    // A wrapper permits any Phaser GameObject without changing its own transform.
    const mount = this.scene.add.container(options.x ?? 0, options.y ?? 0)
      .setRotation(options.rotation ?? 0).setDepth(options.depth ?? 1);
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

  /** Choose a screen side for a pivot label; omit side to restore automatic placement. */
  setDebugLabelSide(boneId: string, side?: Facing): this {
    this.debugView.setLabelSide(boneId, side);
    return this;
  }

  update(delta: number): void {
    if (this.destroyed) return;
    this.animationPlayer.update(delta);
    this.syncPose();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.container.off(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    this.debugView.destroy();
    this.renderer.destroy();
    if (!this.container.isDestroyed) this.container.destroy();
    this.attachments.clear();
    this.bones.clear();
  }

  private onUpdate(_time: number, delta: number): void { this.update(delta); }

  /** Apply poses after manual edits or an externally scheduled constraint pass. */
  syncPose(): void {
    for (const bone of this.bones.values()) bone.syncTransform();
    this.renderer.sync();
    this.debugView.container.setDepth(this.container.depth + 1);
    this.debugView.update();
  }
}
