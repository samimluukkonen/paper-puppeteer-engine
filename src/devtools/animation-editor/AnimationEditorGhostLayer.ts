import type Phaser from 'phaser';
import { Bone } from '../../engine/Bone.js';
import type { Puppet } from '../../engine/Puppet.js';
import { PuppetRenderer } from '../../engine/PuppetRenderer.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import type { GhostPoseSample } from './ghostPoseSampling.js';
import { DEFAULT_ONION_SKIN_SETTINGS, type OnionSkinSettings, updateOnionSkinSettings } from './onionSkinSettings.js';

/** Only bones, images and affine projection: no player, events, IK, input or gameplay. */
class GhostInstance {
  readonly container: Phaser.GameObjects.Container;
  private readonly bones = new Map<string, Bone>();
  private readonly renderer: PuppetRenderer;
  private sample: GhostPoseSample | undefined;

  constructor(
    scene: Phaser.Scene,
    puppet: Puppet,
    readonly direction: GhostPoseSample['direction'],
    readonly distance: number,
  ) {
    this.container = scene.add.container(0, 0).setName(`animation-ghost-${direction}-${distance}`).setVisible(false);
    for (const definition of puppet.rig.bones) {
      const bone = new Bone(scene, definition);
      this.bones.set(bone.id, bone);
      (definition.parent ? this.bones.get(definition.parent)!.container : this.container).add(bone.container);
    }
    this.renderer = new PuppetRenderer(scene, this.container, puppet.rig, this.bones);
  }

  apply(sample: GhostPoseSample): void {
    if (sample === this.sample) return;
    this.sample = sample;
    for (const [id, bone] of this.bones) {
      Object.assign(bone.pose, sample.pose.get(id));
      bone.syncTransform();
    }
  }

  hide(): void {
    this.container.setVisible(false);
    this.sample = undefined;
  }

  syncAppearance(puppet: Puppet, settings: OnionSkinSettings): void {
    const source = puppet.container;
    const parentChanged = this.container.parentContainer !== source.parentContainer;
    if (parentChanged) {
      this.container.parentContainer?.remove(this.container);
      source.parentContainer?.add(this.container);
    }
    const previous = this.direction === 'previous';
    const opacity = previous ? settings.previousOpacity : settings.nextOpacity;
    const tint = previous ? settings.previousTint : settings.nextTint;
    // Farther poses behind nearer ones; every ghost remains behind the authoritative preview.
    const depth = source.depth - this.distance * 2 + (previous ? 0 : 1);
    const depthChanged = this.container.depth !== depth;
    this.container
      .setPosition(source.x, source.y)
      .setRotation(source.rotation)
      .setScale(source.scaleX, source.scaleY)
      .setAlpha(source.alpha * opacity)
      .setDepth(depth);
    if (parentChanged || depthChanged) source.parentContainer?.sort('depth');
    puppet.copyAppearanceTo(this.renderer, tint);
    this.renderer.sync();
  }

  destroy(): void {
    this.sample = undefined;
    this.renderer.destroy();
    this.container.destroy();
    this.bones.clear();
  }
}

/** Transient editor visualization. Samples only when the working snapshot or playhead changes. */
export class AnimationEditorGhostLayer {
  private readonly instances = new Map<string, GhostInstance>();
  private readonly unsubscribe: () => void;
  private settings = DEFAULT_ONION_SKIN_SETTINGS;
  private disposed = false;
  private frameDepth = 0;
  private animation: ReadonlyAnimation | null | undefined;
  private time: number | undefined;
  private samples: GhostPoseSample[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly state: AnimationEditorState,
    private readonly puppet: Puppet,
  ) {
    this.unsubscribe = state.subscribe(() => this.sync());
  }

  setEnabled(enabled: boolean): void {
    this.setSettings({ enabled });
  }

  setSettings(patch: Partial<OnionSkinSettings>): void {
    if (this.disposed) return;
    const next = updateOnionSkinSettings(this.settings, patch);
    if (
      next.previousCount !== this.settings.previousCount ||
      next.nextCount !== this.settings.nextCount ||
      next.frameSpacing !== this.settings.frameSpacing
    )
      this.animation = undefined;
    this.settings = next;
    if (!next.enabled) {
      for (const ghost of this.instances.values()) ghost.hide();
      this.samples = [];
      this.animation = undefined;
      this.time = undefined;
    } else this.sync();
  }

  /** Coalesce playback notifications and appearance changes into one projection per scene frame. */
  updateFrame(update: () => void): void {
    ++this.frameDepth;
    try {
      update();
    } finally {
      --this.frameDepth;
      if (this.frameDepth === 0) this.sync();
    }
  }

  /** Also called each scene frame to follow skin, frame, visibility, facing and preview layout changes. */
  sync(): void {
    if (this.disposed || !this.settings.enabled || this.frameDepth > 0) return;
    const changed = this.animation !== this.state.workingAnimation || this.time !== this.state.currentTime;
    if (changed) {
      this.samples = this.state.sampleGhostPoses(this.settings);
      this.animation = this.state.workingAnimation;
      this.time = this.state.currentTime;
    }
    for (const ghost of this.instances.values()) ghost.container.setVisible(false);
    if (!this.puppet.container.visible) {
      for (const ghost of this.instances.values()) ghost.hide();
      return;
    }
    for (const direction of ['previous', 'next'] as const) {
      let distance = 0;
      for (const sample of this.samples) {
        if (sample.direction !== direction) continue;
        const key = `${direction}-${++distance}`;
        let ghost = this.instances.get(key);
        if (!ghost) {
          ghost = new GhostInstance(this.scene, this.puppet, direction, distance);
          this.instances.set(key, ghost);
        }
        // Hidden instances may have skipped earlier frames; always apply the cached current sample.
        ghost.apply(sample);
        ghost.syncAppearance(this.puppet, this.settings);
        ghost.container.setVisible(true);
      }
    }
    // Retain render objects for reuse, but release obsolete pose references in unused slots.
    for (const ghost of this.instances.values()) if (!ghost.container.visible) ghost.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const ghost of this.instances.values()) ghost.destroy();
    this.instances.clear();
    this.samples = [];
    this.animation = undefined;
    this.time = undefined;
  }
}
