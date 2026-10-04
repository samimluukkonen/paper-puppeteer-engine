import type Phaser from 'phaser';
import type { Facing, IKTarget, Puppet } from '../engine/index.js';
import { DemoFootPlanting } from './DemoFootPlanting.js';
import { DemoKatanaController } from './DemoKatanaController.js';
import type { WalkFootIK } from './demoFootTargets.js';
import { demoArmRotations, demoHipPositions, demoRenderOrder, demoShoulderPositions } from './demoPresentation.js';
import { Katana } from './Katana.js';

export interface DemoPresenterOptions {
  handIK: boolean;
  footIK: boolean;
  upperBody: boolean;
}

export function createDemoBackdrop(scene: Phaser.Scene): void {
  const { width, height } = scene.scale;
  const floor = scene.add.graphics();
  floor.lineStyle(1, 0x9eaa97, 0.45).lineBetween(70, height - 115, width - 70, height - 115);
  floor.fillStyle(0x515e4e, 0.08).fillEllipse(width / 2, height - 115, 170, 18);
  scene.add.text(30, 28, 'FIG. 03 / ANIMATION PLAYBACK', {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#7e8678',
    letterSpacing: 1,
  });
  scene.add
    .text(width - 30, 28, '16 JOINTS · 4 IK CHAINS', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#7e8678',
    })
    .setOrigin(1, 0);
  scene.add
    .text(width / 2, height - 62, 'MOUSE: HAND TARGET · Q / E: KATANA', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#7e8678',
      letterSpacing: 2,
    })
    .setOrigin(0.5);
}

/** Coordinates presentation in the order required by the animation and IK solvers. */
export class DemoPresenter {
  readonly katana: DemoKatanaController;
  readonly feet: DemoFootPlanting;
  handTarget: IKTarget;
  private readonly markers: Phaser.GameObjects.Graphics;
  private renderOrder: readonly string[] | undefined;
  private orderAnimation: string | undefined;
  private orderFacing: Facing | undefined;
  private armDirection = 1;
  private armFadeSource = 1;

  constructor(
    scene: Phaser.Scene,
    private readonly puppet: Puppet,
  ) {
    this.katana = new DemoKatanaController(puppet, new Katana(scene));
    this.feet = new DemoFootPlanting(scene, puppet);
    this.handTarget = { x: scene.scale.width / 2 + 55, y: scene.scale.height - 320 };
    this.markers = scene.add.graphics().setDepth(100);
  }

  clearTargets(): void {
    this.markers.clear();
  }

  /** Retain the presentation correction before playback snapshots an interrupted fade. */
  captureCrossfadeSource(): void {
    this.armFadeSource = this.armDirection;
  }

  update(options: DemoPresenterOptions, poseEvaluated = false): void {
    this.katana.syncMode(options.upperBody);
    this.katana.resetPosition();
    // Reuse this frame's sample, or restore it for paused frames and control changes.
    this.puppet.preparePose();
    if (!poseEvaluated) this.puppet.animationPlayer.applyCurrentPose();
    this.syncRenderOrder();
    const shoulders = demoShoulderPositions(this.puppet.rig, this.puppet.currentAnimation, this.puppet.facingDirection);
    for (const [id, x] of Object.entries(shoulders)) this.puppet.getBone(id).pose.x = x;
    const arms = demoArmRotations(this.puppet.currentAnimation, this.puppet.facingDirection, {
      leftUpperArm: this.puppet.getBone('leftUpperArm').pose.rotation,
      rightUpperArm: this.puppet.getBone('rightUpperArm').pose.rotation,
    });
    const transition = this.puppet.animationPlayer.transition;
    const fromDirection =
      transition?.from === 'previous pose' ? this.armFadeSource : transition?.from === 'idle' ? -1 : 1;
    const toDirection = this.puppet.currentAnimation === 'idle' ? -1 : 1;
    this.armDirection = transition ? fromDirection + (toDirection - fromDirection) * transition.progress : toDirection;
    const toSign = this.puppet.facingDirection === 'right' ? toDirection : 1;
    const sign = this.puppet.facingDirection === 'right' ? this.armDirection : 1;
    for (const [id, rotation] of Object.entries(arms)) {
      this.puppet.getBone(id).pose.rotation = transition ? (rotation * sign) / toSign : rotation;
    }
    if (
      this.puppet.currentAnimation === 'idle' ||
      this.puppet.currentAnimation === 'walk' ||
      this.puppet.currentAnimation === 'sword'
    ) {
      const hips = demoHipPositions(this.puppet.rig, this.puppet.facingDirection);
      for (const [id, x] of Object.entries(hips)) this.puppet.getBone(id).pose.x = x;
    }
    const idle = this.puppet.currentAnimation === 'idle' || this.puppet.currentAnimation === 'sword';
    this.puppet.setDebugLabelSide(
      'rightLowerLeg',
      idle && this.puppet.facingDirection === 'right' ? 'left' : undefined,
    );
    this.puppet.setDebugLabelSide('leftLowerLeg', idle && this.puppet.facingDirection === 'left' ? 'right' : undefined);
    this.puppet.setDebugLabelSide('rightFoot', idle && this.puppet.facingDirection === 'left' ? 'left' : undefined);
    this.puppet.setDebugLabelSide('leftFoot', idle && this.puppet.facingDirection === 'right' ? 'right' : undefined);
    this.katana.configureArms(this.handTarget, options.handIK, options.upperBody);
    const feet = this.feet.update(options.footIK);
    this.katana.setInitialRotation();
    this.puppet.syncPose({ updateDebug: false });
    this.katana.solveGrip(this.handTarget, options.handIK, options.upperBody, { updateDebug: false });
    this.puppet.refreshDebugViews();
    this.drawTargets(options, feet.targets, feet.walkFeet);
  }

  private syncRenderOrder(): void {
    const animation = this.puppet.currentAnimation;
    const facing = this.puppet.facingDirection;
    if (!this.renderOrder || this.orderAnimation !== animation || this.orderFacing !== facing) {
      this.renderOrder = demoRenderOrder(this.puppet.rig, animation, facing);
      this.orderAnimation = animation;
      this.orderFacing = facing;
    }
    // Authoring controls can change the puppet order between presentation frames.
    const current = this.puppet.getRenderOrder();
    if (current.length !== this.renderOrder.length || current.some((id, index) => id !== this.renderOrder![index]))
      this.puppet.setRenderOrder(this.renderOrder);
  }

  private drawTargets(
    options: DemoPresenterOptions,
    footTargets: Readonly<Record<'left' | 'right', IKTarget>>,
    walkFeet?: Readonly<Record<'left' | 'right', WalkFootIK>>,
  ): void {
    this.markers.clear();
    const mark = (point: IKTarget, color: number): void => {
      this.markers.lineStyle(2, color, 0.85).strokeCircle(point.x, point.y, 7);
      this.markers.lineBetween(point.x - 11, point.y, point.x + 11, point.y);
      this.markers.lineBetween(point.x, point.y - 11, point.x, point.y + 11);
    };
    if (options.handIK || options.upperBody) mark(this.handTarget, 0x7652ad);
    if (walkFeet)
      for (const side of ['left', 'right'] as const) {
        if (walkFeet[side].mix > 0) mark(footTargets[side], 0xcb674f);
      }
    const secondaryTarget = this.katana.getSecondaryTarget();
    if (secondaryTarget) mark(secondaryTarget, 0x337db1);
  }
}
