import type Phaser from 'phaser';
import type { IKTarget, Puppet } from '../engine/index.js';
import {
  demoWalkFootIK,
  type FootSoles,
  SKETCH_HEEL_STRIKE_ANGLE,
  sketchWalkFootIK,
  type WalkFootIK,
} from './demoFootTargets.js';

type Feet = Readonly<Record<'left' | 'right', IKTarget>>;
const SKETCH_STANCE_OFFSET = 7;

export interface DemoFootPlantingFrame {
  targets: Feet;
  walkFeet: Readonly<Record<'left' | 'right', WalkFootIK>> | undefined;
}

/** Coordinates grounded contact, return steps, and ankle presentation for each demo rig. */
export class DemoFootPlanting {
  private elapsed = 0;
  private readonly groundTargets: Feet;
  private readonly forwardReaches = { left: 42, right: 42 };
  private readonly soles: FootSoles = {
    left: { toe: { x: 0, y: 0 }, heel: { x: 0, y: 0 } },
    right: { toe: { x: 0, y: 0 }, heel: { x: 0, y: 0 } },
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly sampleLayout = true,
  ) {
    const { width, height } = scene.scale;
    this.groundTargets = {
      left: { x: width / 2 + 24, y: height - 130 },
      right: { x: width / 2 - 24, y: height - 130 },
    };
    if (!sampleLayout) {
      for (const side of ['left', 'right'] as const) {
        const ankle = puppet.getBone(`${side}Foot`).getWorldPosition();
        const image = puppet.getSlotImage(`${side}FootVisual`)!;
        const matrix = image.getWorldTransformMatrix();
        const left = -image.originX * image.width;
        const top = -image.originY * image.height;
        const toe = matrix.transformPoint(left, top + image.height);
        const heel = matrix.transformPoint(left + image.width, top + image.height);
        const hip = puppet.getBone(`${side}Thigh`).getWorldPosition();
        const knee = puppet.getBone(`${side}LowerLeg`).getWorldPosition();
        Object.assign(this.soles[side], {
          toe: { x: toe.x - ankle.x, y: toe.y - ankle.y },
          heel: { x: heel.x - ankle.x, y: heel.y - ankle.y },
        });
        const a = Math.hypot(knee.x - hip.x, knee.y - hip.y);
        const b = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
        // Fit the forward reach to each leg so heel strike has about six degrees of knee bend.
        const reachSquared = a * a + b * b + 2 * a * b * Math.cos(0.1);
        const heelOffset = this.soles[side].heel;
        const cos = Math.cos(SKETCH_HEEL_STRIKE_ANGLE);
        const sin = Math.sin(SKETCH_HEEL_STRIKE_ANGLE);
        const contactY = height - 115 - (heelOffset.x * sin + heelOffset.y * cos);
        const vertical = contactY - hip.y - SKETCH_STANCE_OFFSET;
        const heelPivotX = heelOffset.x - (heelOffset.x * cos - heelOffset.y * sin);
        this.forwardReaches[side] = Math.sqrt(Math.max(0, reachSquared - vertical * vertical)) - heelPivotX;
        const bottom = Math.max(
          ...[left, left + image.width].flatMap((x) =>
            [top, top + image.height].map((y) => matrix.transformPoint(x, y).y),
          ),
        );
        // The contact phase adds seven pixels; fit each sole to the actual stage floor.
        Object.assign(this.groundTargets[side], {
          x: hip.x,
          y: height - 115 - (bottom - ankle.y) - 7,
        });
      }
    }
  }

  advance(delta: number): void {
    const player = this.puppet.animationPlayer;
    if (this.puppet.isPlaying && !player.isPaused)
      this.elapsed += delta * player.playbackSpeed * player.currentAnimationSpeed;
  }

  update(enabled: boolean): DemoFootPlantingFrame {
    this.resetFootRotation();
    const plantWalkFeet = enabled && this.puppet.currentAnimation === 'walk';
    // Give the sketch's extended stance some knee bend so floor contacts stay within IK reach.
    const stanceOffset = plantWalkFeet && !this.sampleLayout ? SKETCH_STANCE_OFFSET : 0;
    const player = this.puppet.animationPlayer;
    const phase = player.duration > 0 ? player.elapsedTime / player.duration : 0;
    // Rise over each supporting leg, then settle for the next contact. Tie the bob to the stride.
    const swayX = this.sampleLayout ? 7 * Math.sin(this.elapsed / 1000) : 0;
    const swayY = this.sampleLayout ? 3 * Math.sin(this.elapsed / 700) : -2 * Math.sin(2 * Math.PI * phase) ** 2;
    this.puppet.container.setPosition(
      this.scene.scale.width / 2 + (plantWalkFeet ? swayX : 0),
      this.scene.scale.height - 278 + (plantWalkFeet ? swayY : 0) + stanceOffset,
    );
    const ground = {
      left: this.facingGround('left'),
      right: this.facingGround('right'),
    };
    const canonicalFeet = !plantWalkFeet
      ? undefined
      : !this.sampleLayout
        ? sketchWalkFootIK(
            this.puppet.animationPlayer.elapsedTime,
            this.puppet.animationPlayer.duration,
            ground,
            this.puppet.facingDirection === 'right' ? 1 : -1,
            this.soles,
            this.forwardReaches,
          )
        : demoWalkFootIK(this.puppet.animationPlayer.elapsedTime, this.puppet.animationPlayer.duration, ground, {
            left: this.animatedAnkle('left'),
            right: this.animatedAnkle('right'),
          });
    const walkFeet =
      canonicalFeet && !this.sampleLayout && this.puppet.facingDirection === 'left'
        ? { left: canonicalFeet.right, right: canonicalFeet.left }
        : canonicalFeet;
    const footTargets = walkFeet ? { left: walkFeet.left.target, right: walkFeet.right.target } : this.groundTargets;
    for (const side of ['left', 'right'] as const) {
      const leg = this.puppet.getIK(`${side}LegIK`);
      leg.enabled = plantWalkFeet;
      leg.mix = walkFeet?.[side].mix ?? 1;
      leg.setTarget(footTargets[side]);
    }
    return { targets: footTargets, walkFeet };
  }

  resetFootRotation(): void {
    if (this.sampleLayout) return;
    for (const side of ['left', 'right'] as const) {
      const slot = `${side}FootVisual`;
      this.puppet.setSlotTransform(slot, { rotation: this.puppet.rig.getSlot(slot).rotation ?? 0 }, false);
    }
  }

  private facingGround(side: 'left' | 'right'): IKTarget {
    const ground = this.groundTargets[side];
    const center = this.scene.scale.width / 2;
    const mirror = !this.sampleLayout && this.puppet.facingDirection === 'left';
    return { x: mirror ? 2 * center - ground.x : ground.x, y: ground.y + 7 };
  }

  /** Compensate for the solved shin angle without changing the authored animation or ankle target. */
  syncFootRotation(walkFeet: DemoFootPlantingFrame['walkFeet']): void {
    if (this.sampleLayout || !walkFeet) return;
    for (const side of ['left', 'right'] as const) {
      let angle = 0;
      let id: string | undefined = `${side}Foot`;
      while (id) {
        angle += this.puppet.getBone(id).pose.rotation;
        id = this.puppet.rig.getBone(id).parent;
      }
      const slot = `${side}FootVisual`;
      this.puppet.setSlotTransform(slot, { rotation: (walkFeet[side].rotation ?? 0) - angle }, false);
    }
  }

  private animatedAnkle(side: 'left' | 'right'): IKTarget {
    const puppet = this.puppet;
    const pelvis = puppet.getBone('pelvis').pose;
    const thigh = puppet.getBone(`${side}Thigh`).pose;
    const shin = puppet.getBone(`${side}LowerLeg`).pose;
    const foot = puppet.getBone(`${side}Foot`).pose;
    // This demo rig has an unrotated pelvis and vertical, unscaled leg links.
    const x =
      pelvis.x + thigh.x - shin.y * Math.sin(thigh.rotation) - foot.y * Math.sin(thigh.rotation + shin.rotation);
    const y =
      pelvis.y + thigh.y + shin.y * Math.cos(thigh.rotation) + foot.y * Math.cos(thigh.rotation + shin.rotation);
    return { x: puppet.container.x + puppet.container.scaleX * x, y: puppet.container.y + puppet.container.scaleY * y };
  }
}
