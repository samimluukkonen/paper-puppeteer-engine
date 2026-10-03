import type Phaser from 'phaser';
import type { IKTarget, Puppet } from '../engine/index.js';
import { demoWalkFootIK, type WalkFootIK } from './demoFootTargets.js';

type Feet = Readonly<Record<'left' | 'right', IKTarget>>;

export interface DemoFootPlantingFrame {
  targets: Feet;
  walkFeet: Readonly<Record<'left' | 'right', WalkFootIK>> | undefined;
}

/** Samples ankles before IK and plants only the contact portion of the walk. */
export class DemoFootPlanting {
  private elapsed = 0;
  private readonly groundTargets: Feet;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
  ) {
    const { width, height } = scene.scale;
    this.groundTargets = {
      left: { x: width / 2 + 24, y: height - 130 },
      right: { x: width / 2 - 24, y: height - 130 },
    };
  }

  advance(delta: number): void {
    const player = this.puppet.animationPlayer;
    if (this.puppet.isPlaying && !player.isPaused)
      this.elapsed += delta * player.playbackSpeed * player.currentAnimationSpeed;
  }

  update(enabled: boolean): DemoFootPlantingFrame {
    const plantWalkFeet = enabled && this.puppet.currentAnimation === 'walk';
    this.puppet.container.setPosition(
      this.scene.scale.width / 2 + (plantWalkFeet ? 7 * Math.sin(this.elapsed / 1000) : 0),
      this.scene.scale.height - 278 + (plantWalkFeet ? 3 * Math.sin(this.elapsed / 700) : 0),
    );
    const walkFeet = plantWalkFeet
      ? demoWalkFootIK(
          this.puppet.animationPlayer.elapsedTime,
          this.puppet.animationPlayer.duration,
          {
            left: { ...this.groundTargets.left, y: this.groundTargets.left.y + 7 },
            right: { ...this.groundTargets.right, y: this.groundTargets.right.y + 7 },
          },
          { left: this.animatedAnkle('left'), right: this.animatedAnkle('right') },
        )
      : undefined;
    const footTargets = walkFeet ? { left: walkFeet.left.target, right: walkFeet.right.target } : this.groundTargets;
    for (const side of ['left', 'right'] as const) {
      const leg = this.puppet.getIK(`${side}LegIK`);
      leg.enabled = plantWalkFeet;
      leg.mix = walkFeet?.[side].mix ?? 1;
      leg.setTarget(footTargets[side]);
    }
    return { targets: footTargets, walkFeet };
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
