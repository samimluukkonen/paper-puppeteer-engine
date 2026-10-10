import type Phaser from 'phaser';
import { Bone } from '../../engine/Bone.js';
import type { Puppet } from '../../engine/Puppet.js';
import { PuppetRenderer } from '../../engine/PuppetRenderer.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import type { GhostPoseSample } from './ghostPoseSampling.js';

const styles = {
  previous: { tint: 0x65a9ed, depth: -2 },
  next: { tint: 0xf0a15d, depth: -1 },
} as const;

/** Only bones, images and affine projection: no player, events, IK, input or gameplay. */
class GhostInstance {
  readonly container: Phaser.GameObjects.Container;
  private readonly bones = new Map<string, Bone>();
  private readonly renderer: PuppetRenderer;

  constructor(
    scene: Phaser.Scene,
    puppet: Puppet,
    readonly direction: GhostPoseSample['direction'],
  ) {
    this.container = scene.add.container(0, 0).setName(`animation-ghost-${direction}`).setVisible(false);
    for (const definition of puppet.rig.bones) {
      const bone = new Bone(scene, definition);
      this.bones.set(bone.id, bone);
      (definition.parent ? this.bones.get(definition.parent)!.container : this.container).add(bone.container);
    }
    this.renderer = new PuppetRenderer(scene, this.container, puppet.rig, this.bones);
  }

  apply(sample: GhostPoseSample): void {
    for (const [id, bone] of this.bones) {
      Object.assign(bone.pose, sample.pose.get(id));
      bone.syncTransform();
    }
  }

  syncAppearance(puppet: Puppet): void {
    const source = puppet.container;
    if (this.container.parentContainer !== source.parentContainer) {
      this.container.parentContainer?.remove(this.container);
      source.parentContainer?.add(this.container);
    }
    const style = styles[this.direction];
    this.container
      .setPosition(source.x, source.y)
      .setRotation(source.rotation)
      .setScale(source.scaleX, source.scaleY)
      .setAlpha(source.alpha * 0.22)
      .setDepth(source.depth + style.depth);
    source.parentContainer?.sort('depth');
    puppet.copyAppearanceTo(this.renderer, style.tint);
    this.renderer.sync();
  }

  destroy(): void {
    this.renderer.destroy();
    this.container.destroy();
    this.bones.clear();
  }
}

/** Transient editor visualization. Samples only when the working snapshot or playhead changes. */
export class AnimationEditorGhostLayer {
  private readonly instances = new Map<GhostPoseSample['direction'], GhostInstance>();
  private readonly unsubscribe: () => void;
  private enabled = false;
  private disposed = false;
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
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      for (const ghost of this.instances.values()) ghost.container.setVisible(false);
      this.samples = [];
      this.animation = undefined;
      this.time = undefined;
    } else this.sync();
  }

  /** Also called each scene frame to follow skin, frame, visibility, facing and preview layout changes. */
  sync(): void {
    if (this.disposed || !this.enabled) return;
    const changed = this.animation !== this.state.workingAnimation || this.time !== this.state.currentTime;
    if (changed) {
      this.samples = this.state.sampleGhostPoses();
      this.animation = this.state.workingAnimation;
      this.time = this.state.currentTime;
    }
    for (const direction of ['previous', 'next'] as const) {
      const sample = this.samples.find((entry) => entry.direction === direction);
      let ghost = this.instances.get(direction);
      if (!sample) {
        ghost?.container.setVisible(false);
        continue;
      }
      if (!ghost) {
        ghost = new GhostInstance(this.scene, this.puppet, direction);
        this.instances.set(direction, ghost);
        ghost.apply(sample);
      } else if (changed) ghost.apply(sample);
      ghost.syncAppearance(this.puppet);
      ghost.container.setVisible(this.puppet.container.visible);
    }
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
