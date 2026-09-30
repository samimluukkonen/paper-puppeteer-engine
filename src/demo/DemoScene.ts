import Phaser from 'phaser';
import { Puppet } from '../engine/index.js';
import type { Facing } from '../engine/index.js';
import { demoRig } from './demoRig.js';
import { demoAnimations } from './demoAnimations.js';
import { demoArmRotations, demoHipPositions, demoRenderOrder, demoShoulderPositions } from './demoPresentation.js';
import { createTextures } from './createTextures.js';
import { demoIK } from './demoIK.js';
import { demoWalkFootIK } from './demoFootTargets.js';
import type { WalkFootIK } from './demoFootTargets.js';
import { Katana, katanaGrips } from './Katana.js';
import type { IKTarget } from '../engine/index.js';
import { gripReachCorrection, horizontalEdgesAtY, stepPalmAroundHead } from './katanaArmTarget.js';

// The hand joint is at the wrist; +Y runs along this rig's hand toward its palm.
const palmGripOffset: IKTarget = { x: 0, y: 15 };
const palmVisibilityMargin = 8;
const maximumPalmStep = 8;

export interface DemoState {
  animation: string;
  facing: Facing;
  debug: boolean;
  playing: boolean;
  attached: boolean;
  handIK: boolean;
  footIK: boolean;
  ikDebug: boolean;
}

export class DemoScene extends Phaser.Scene {
  puppet: Puppet | undefined;
  private katana: Katana | undefined;
  private attached = true;
  private handIK = false;
  private footIK = false;
  private handTarget: IKTarget = { x: 440, y: 320 };
  private readonly groundTargets: Record<'left' | 'right', IKTarget> = {
    left: { x: 0, y: 0 }, right: { x: 0, y: 0 },
  };
  private markers: Phaser.GameObjects.Graphics | undefined;
  private swordAngle = -0.65;
  private rearPalmSide: 'left' | 'right' = 'right';
  private rearPalmOverHead = false;
  private previousRearPalm: IKTarget | undefined;
  private elapsed = 0;
  private rotateLeft: Phaser.Input.Keyboard.Key | undefined;
  private rotateRight: Phaser.Input.Keyboard.Key | undefined;

  constructor(private readonly onChange: (state: DemoState) => void) {
    super('DemoScene');
  }

  create(): void {
    this.attached = true;
    this.handIK = false;
    this.footIK = false;
    this.elapsed = 0;
    this.swordAngle = -0.65;
    this.rearPalmSide = 'right';
    this.rearPalmOverHead = false;
    this.previousRearPalm = undefined;
    createTextures(this);
    const { width, height } = this.scale;
    const floor = this.add.graphics();
    floor.lineStyle(1, 0x9eaa97, 0.45).lineBetween(70, height - 115, width - 70, height - 115);
    floor.fillStyle(0x515e4e, 0.08).fillEllipse(width / 2, height - 115, 170, 18);
    this.add.text(30, 28, 'FIG. 02 / TWO-BONE IK', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678', letterSpacing: 1,
    });
    this.add.text(width - 30, 28, '16 JOINTS · 4 IK CHAINS', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678',
    }).setOrigin(1, 0);
    this.puppet = new Puppet(this, {
      rig: demoRig, x: width / 2, y: height - 278,
      animations: demoAnimations, ik: demoIK, scale: 1.08, autoUpdate: false,
    });
    this.katana = new Katana(this);
    this.attachKatana();
    this.puppet.play('idle');
    this.handTarget = { x: width / 2 + 55, y: height - 320 };
    this.groundTargets.left = { x: width / 2 + 24, y: height - 130 };
    this.groundTargets.right = { x: width / 2 - 24, y: height - 130 };
    this.markers = this.add.graphics().setDepth(100);
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handTarget = { x: pointer.worldX, y: pointer.worldY };
    });
    this.updatePresentation();
    this.add.text(width / 2, height - 62, 'MOUSE: HAND TARGET · Q / E: KATANA', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678', letterSpacing: 2,
    }).setOrigin(0.5);
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-ONE', () => this.play('idle'));
      keyboard.on('keydown-TWO', () => this.play('walk'));
      keyboard.on('keydown-THREE', () => this.play('sword'));
      keyboard.on('keydown-A', () => this.face('left'));
      keyboard.on('keydown-D', () => this.face('right'));
      keyboard.on('keydown-B', () => this.toggleDebug());
      keyboard.on('keydown-I', () => this.toggleIKDebug());
      keyboard.on('keydown-F', () => this.toggleFootIK());
      keyboard.on('keydown-H', () => this.toggleHandIK());
      keyboard.on('keydown-P', () => this.toggleProp());
      keyboard.on('keydown-SPACE', () => this.togglePlayback());
      keyboard.on('keydown-R', () => this.restart());
      keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.SPACE]);
      this.rotateLeft = keyboard.addKey('Q');
      this.rotateRight = keyboard.addKey('E');
    }
    this.notify();
  }

  update(_time: number, delta: number): void {
    if (!this.puppet) return;
    if (this.puppet.isPlaying) this.elapsed += delta;
    const turn = Number(this.rotateRight?.isDown ?? false) - Number(this.rotateLeft?.isDown ?? false);
    this.rotateKatana(turn * delta / 1000);
    this.puppet.preparePose();
    const playing = this.puppet.isPlaying;
    this.puppet.animationPlayer.update(delta);
    this.updatePresentation();
    if (playing !== this.puppet.isPlaying) this.notify();
  }

  play(name: string): void {
    this.puppet?.play(name);
    this.handIK = name === 'sword';
    if (name === 'sword') {
      this.rearPalmSide = this.puppet?.facingDirection ?? 'right';
      this.rearPalmOverHead = false;
      this.previousRearPalm = undefined;
    }
    this.updatePresentation();
    this.notify();
  }

  face(direction: Facing): void {
    // setFacing synchronizes the rig; wait until the weapon mount has changed
    // before asking the rear hand to evaluate its grip in the new direction.
    if (this.puppet) {
      this.puppet.getIK('leftArmIK').enabled = false;
      this.puppet.getIK('rightArmIK').enabled = false;
    }
    this.puppet?.setFacing(direction);
    this.rearPalmSide = direction;
    this.rearPalmOverHead = false;
    this.previousRearPalm = undefined;
    if (this.attached) this.attachKatana();
    this.updatePresentation();
    this.notify();
  }
  toggleDebug(): void { if (this.puppet) this.puppet.setDebug(!this.puppet.isDebug); this.notify(); }
  toggleIKDebug(): void { if (this.puppet) this.puppet.setIKDebug(!this.puppet.isIKDebug); this.notify(); }
  toggleHandIK(): void { this.handIK = !this.handIK; this.updatePresentation(); this.notify(); }
  toggleFootIK(): void { this.footIK = !this.footIK; this.updatePresentation(); this.notify(); }
  rotateKatana(delta: number): void { this.swordAngle += delta; }
  restart(): void {
    this.puppet?.restart();
    this.updatePresentation();
    this.notify();
  }

  togglePlayback(): void {
    if (this.puppet?.isPlaying) this.puppet.stop();
    else this.puppet?.restart();
    this.updatePresentation();
    this.notify();
  }

  toggleProp(): void {
    if (!this.puppet || !this.katana) return;
    if (this.attached) {
      this.puppet.detach(this.katana.container);
      this.katana.container.setVisible(false);
    } else {
      this.katana.container.setVisible(true);
      this.attachKatana();
    }
    this.attached = !this.attached;
    this.updatePresentation();
    this.notify();
  }

  private attachKatana(): void {
    if (!this.puppet || !this.katana) return;
    const facing = this.puppet.facingDirection;
    const grip = facing === 'right' ? katanaGrips.primary : katanaGrips.secondary;
    this.puppet.attach(facing === 'right' ? 'rightHand' : 'leftHand', this.katana.container, {
      x: palmGripOffset.x - grip.x,
      y: palmGripOffset.y - grip.y,
    });
  }

  private notify(): void {
    if (!this.puppet) return;
    this.onChange({
      animation: this.puppet.currentAnimation ?? 'none', facing: this.puppet.facingDirection,
      debug: this.puppet.isDebug, playing: this.puppet.isPlaying, attached: this.attached,
      handIK: this.handIK, footIK: this.footIK, ikDebug: this.puppet.isIKDebug,
    });
  }

  private updatePresentation(): void {
    if (!this.puppet) return;
    this.katana?.container.setPosition(0, 0);
    // Always start from the sampled pose so facing changes cannot accumulate rotations.
    this.puppet.preparePose();
    this.puppet.animationPlayer.sample(this.puppet.animationPlayer.elapsedTime);
    this.puppet.setRenderOrder(demoRenderOrder(this.puppet.rig,
      this.puppet.currentAnimation, this.puppet.facingDirection));
    const shoulders = demoShoulderPositions(this.puppet.rig, this.puppet.currentAnimation, this.puppet.facingDirection);
    for (const [id, x] of Object.entries(shoulders)) this.puppet.getBone(id).pose.x = x;
    const arms = demoArmRotations(this.puppet.currentAnimation, this.puppet.facingDirection, {
      leftUpperArm: this.puppet.getBone('leftUpperArm').pose.rotation,
      rightUpperArm: this.puppet.getBone('rightUpperArm').pose.rotation,
    });
    for (const [id, rotation] of Object.entries(arms)) this.puppet.getBone(id).pose.rotation = rotation;
    if (this.puppet.currentAnimation === 'idle'
      || this.puppet.currentAnimation === 'walk'
      || this.puppet.currentAnimation === 'sword') {
      const hips = demoHipPositions(this.puppet.rig, this.puppet.facingDirection);
      for (const [id, x] of Object.entries(hips)) this.puppet.getBone(id).pose.x = x;
    }
    const idle = this.puppet.currentAnimation === 'idle' || this.puppet.currentAnimation === 'sword';
    this.puppet.setDebugLabelSide('rightLowerLeg', idle && this.puppet.facingDirection === 'right' ? 'left' : undefined);
    this.puppet.setDebugLabelSide('leftLowerLeg', idle && this.puppet.facingDirection === 'left' ? 'right' : undefined);
    this.puppet.setDebugLabelSide('rightFoot', idle && this.puppet.facingDirection === 'left' ? 'left' : undefined);
    this.puppet.setDebugLabelSide('leftFoot', idle && this.puppet.facingDirection === 'right' ? 'right' : undefined);
    const rightArm = this.puppet.getIK('rightArmIK');
    const leftArm = this.puppet.getIK('leftArmIK');
    const facing = this.puppet.facingDirection;
    leftArm.bendDirection = -1;
    const primaryArm = facing === 'right' ? rightArm : leftArm;
    const secondaryArm = facing === 'right' ? leftArm : rightArm;
    primaryArm.priority = 0;
    secondaryArm.priority = 1;
    primaryArm.setEndOffset({ x: 0, y: 0 });
    secondaryArm.setEndOffset(palmGripOffset);
    primaryArm.enabled = this.handIK;
    primaryArm.setTarget(this.handTarget);
    secondaryArm.enabled = this.handIK && this.attached && this.puppet.currentAnimation === 'sword';
    secondaryArm.setTargetProvider(() => {
      this.aimKatana(this.swordAngle);
      return this.katana?.getGripWorldPosition(facing === 'right' ? katanaGrips.secondary : katanaGrips.primary);
    });
    this.puppet.container.setPosition(this.scale.width / 2 + (this.footIK ? 7 * Math.sin(this.elapsed / 1000) : 0),
      this.scale.height - 278 + (this.footIK ? 3 * Math.sin(this.elapsed / 700) : 0));
    const walkFeet = this.puppet.currentAnimation === 'walk'
      ? demoWalkFootIK(this.puppet.animationPlayer.elapsedTime, {
        left: { ...this.groundTargets.left, y: this.groundTargets.left.y + 7 },
        right: { ...this.groundTargets.right, y: this.groundTargets.right.y + 7 },
      }, { left: this.animatedAnkle('left'), right: this.animatedAnkle('right') }) : undefined;
    const footTargets = walkFeet
      ? { left: walkFeet.left.target, right: walkFeet.right.target } : this.groundTargets;
    for (const side of ['left', 'right'] as const) {
      const leg = this.puppet.getIK(`${side}LegIK`);
      leg.enabled = this.footIK;
      leg.mix = walkFeet?.[side].mix ?? 1;
      leg.setTarget(footTargets[side]);
    }
    this.katana?.container.setRotation(this.swordAngle);
    this.puppet.syncPose();
    if (this.attached) this.aimKatana(this.swordAngle);
    this.keepBothHandsOnKatana();
    this.drawTargets(footTargets, walkFeet);
  }

  private animatedAnkle(side: 'left' | 'right'): IKTarget {
    const puppet = this.puppet!;
    const pelvis = puppet.getBone('pelvis').pose;
    const thigh = puppet.getBone(`${side}Thigh`).pose;
    const shin = puppet.getBone(`${side}LowerLeg`).pose;
    const foot = puppet.getBone(`${side}Foot`).pose;
    // This demo rig has an unrotated pelvis and vertical, unscaled leg links.
    const x = pelvis.x + thigh.x - shin.y * Math.sin(thigh.rotation)
      - foot.y * Math.sin(thigh.rotation + shin.rotation);
    const y = pelvis.y + thigh.y + shin.y * Math.cos(thigh.rotation)
      + foot.y * Math.cos(thigh.rotation + shin.rotation);
    return { x: puppet.container.x + puppet.container.scaleX * x,
      y: puppet.container.y + puppet.container.scaleY * y };
  }

  private drawTargets(footTargets: Readonly<Record<'left' | 'right', IKTarget>>,
    walkFeet?: Readonly<Record<'left' | 'right', WalkFootIK>>): void {
    if (!this.markers) return;
    this.markers.clear();
    const mark = (point: IKTarget, color: number): void => {
      this.markers!.lineStyle(2, color, 0.85).strokeCircle(point.x, point.y, 7);
      this.markers!.lineBetween(point.x - 11, point.y, point.x + 11, point.y);
      this.markers!.lineBetween(point.x, point.y - 11, point.x, point.y + 11);
    };
    if (this.handIK) mark(this.handTarget, 0x7652ad);
    if (this.footIK) for (const side of ['left', 'right'] as const) {
      if (!walkFeet || walkFeet[side].mix > 0) mark(footTargets[side], 0xcb674f);
    }
    if (this.puppet && this.katana) {
      const facing = this.puppet.facingDirection;
      const secondaryArm = this.puppet.getIK(facing === 'right' ? 'leftArmIK' : 'rightArmIK');
      if (secondaryArm.enabled) mark(this.katana.getGripWorldPosition(
        facing === 'right' ? katanaGrips.secondary : katanaGrips.primary), 0x337db1);
    }
  }

  private keepBothHandsOnKatana(): void {
    if (!this.puppet || !this.katana || !this.attached || !this.handIK
      || this.puppet.currentAnimation !== 'sword') {
      this.previousRearPalm = undefined;
      return;
    }
    const leftArm = this.puppet.getIK('leftArmIK');
    const rightArm = this.puppet.getIK('rightArmIK');
    const facing = this.puppet.facingDirection;
    const primaryArm = facing === 'right' ? rightArm : leftArm;
    const secondaryArm = facing === 'right' ? leftArm : rightArm;
    const secondaryGrip = facing === 'right' ? katanaGrips.secondary : katanaGrips.primary;
    const rearPalmBone = this.puppet.getBone(secondaryArm.endBone);
    const rearPalmOffset = secondaryArm.endOffset;
    const rearPalm = (): IKTarget => rearPalmBone.container.getWorldTransformMatrix()
      .transformPoint(rearPalmOffset.x, rearPalmOffset.y);
    const target = { ...this.handTarget };
    // Follow the head's top while crossing between sides. A vertical path
    // avoids the discontinuous left/right projection at the head's corners.
    const head = this.puppet.getBone('head').sprite;
    let headBounds: { left: number; right: number; top: number } | undefined;
    if (head) {
      const corners = this.cutoutCorners(head);
      headBounds = {
        left: Math.min(...corners.map(point => point.x)),
        right: Math.max(...corners.map(point => point.x)),
        top: Math.min(...corners.map(point => point.y)),
      };
      const palm = rearPalm();
      if (palm.y <= headBounds.top + palmVisibilityMargin
        && (facing === 'right' || secondaryArm.status === 'solved')) this.rearPalmOverHead = true;
      if (this.rearPalmOverHead) {
        this.rearPalmSide = palm.x < (headBounds.left + headBounds.right) / 2 ? 'left' : 'right';
        const allowedY = this.headOverpassY(headBounds, palm.x);
        const outside = this.rearPalmSide === 'left'
          ? palm.x < headBounds.left - palmVisibilityMargin
          : palm.x > headBounds.right + palmVisibilityMargin;
        if (outside && palm.y <= allowedY && palm.y > headBounds.top + palmVisibilityMargin) {
          this.rearPalmOverHead = false;
        }
      }
    }
    for (let pass = 0; pass < 24; pass += 1) {
      const shoulder = this.puppet.getBone(secondaryArm.rootBone).getWorldPosition();
      const elbow = this.puppet.getBone(secondaryArm.middleBone).getWorldPosition();
      const secondaryPalm = this.puppet.getBone(secondaryArm.endBone).container.getWorldTransformMatrix()
        .transformPoint(secondaryArm.endOffset.x, secondaryArm.endOffset.y);
      const lengthA = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
      const lengthB = Math.hypot(secondaryPalm.x - elbow.x, secondaryPalm.y - elbow.y);
      const grip = this.katana.getGripWorldPosition(secondaryGrip);
      const reachCorrection = secondaryArm.status === 'clamped'
        ? gripReachCorrection(shoulder, grip, lengthA, lengthB) : { x: 0, y: 0 };
      const palm = rearPalm();
      // The rear palm draws behind the body, so keep it outside whichever
      // cutout intersects its height, on the side reached over the head.
      const edges = !this.rearPalmOverHead ? this.bodyEdgesAt(palm.y) : undefined;
      const visibilityPush = edges === undefined ? 0 : this.rearPalmSide === 'right'
        ? Math.max(0, edges.right + palmVisibilityMargin - palm.x)
        : Math.min(0, edges.left - palmVisibilityMargin - palm.x);
      const overpassPush = this.rearPalmOverHead && headBounds
        ? Math.min(0, this.headOverpassY(headBounds, palm.x) - palm.y) : 0;
      const correction = {
        x: visibilityPush > 0 ? Math.max(reachCorrection.x, visibilityPush)
          : visibilityPush < 0 ? Math.min(reachCorrection.x, visibilityPush) : reachCorrection.x,
        y: Math.min(reachCorrection.y, overpassPush),
      };
      if (Math.hypot(correction.x, correction.y) < 0.01) break;
      target.x += correction.x;
      target.y += correction.y;
      primaryArm.setTarget(target);
      this.puppet.syncPose();
    }
    if (this.previousRearPalm && headBounds) {
      let palm = rearPalm();
      const next = stepPalmAroundHead(this.previousRearPalm, palm, headBounds,
        palmVisibilityMargin, maximumPalmStep);
      for (let pass = 0; pass < 6 && Math.hypot(next.x - palm.x, next.y - palm.y) > 0.01; pass += 1) {
        target.x += next.x - palm.x;
        target.y += next.y - palm.y;
        primaryArm.setTarget(target);
        this.puppet.syncPose();
        palm = rearPalm();
      }
      // The bounded path may pass just outside the second arm's reach even
      // when its endpoints are reachable. Pull that frame back into reach.
      for (let pass = 0; pass < 12 && secondaryArm.status === 'clamped'; pass += 1) {
        const shoulder = this.puppet.getBone(secondaryArm.rootBone).getWorldPosition();
        const elbow = this.puppet.getBone(secondaryArm.middleBone).getWorldPosition();
        const secondaryPalm = this.puppet.getBone(secondaryArm.endBone).container.getWorldTransformMatrix()
          .transformPoint(secondaryArm.endOffset.x, secondaryArm.endOffset.y);
        const grip = this.katana.getGripWorldPosition(secondaryGrip);
        const correction = gripReachCorrection(shoulder, grip,
          Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y),
          Math.hypot(secondaryPalm.x - elbow.x, secondaryPalm.y - elbow.y));
        if (Math.hypot(correction.x, correction.y) < 0.0001) break;
        target.x += correction.x;
        target.y += correction.y;
        primaryArm.setTarget(target);
        this.puppet.syncPose();
        palm = rearPalm();
      }
    }
    this.previousRearPalm = rearPalm();
  }

  private headOverpassY(head: { left: number; right: number; top: number }, x: number): number {
    return x >= head.left - palmVisibilityMargin && x <= head.right + palmVisibilityMargin
      ? head.top - palmVisibilityMargin : Infinity;
  }

  private cutoutCorners(sprite: Phaser.GameObjects.Image): IKTarget[] {
    const matrix = sprite.getWorldTransformMatrix();
    const left = -sprite.originX * sprite.width;
    const top = -sprite.originY * sprite.height;
    return [
      matrix.transformPoint(left, top),
      matrix.transformPoint(left + sprite.width, top),
      matrix.transformPoint(left + sprite.width, top + sprite.height),
      matrix.transformPoint(left, top + sprite.height),
    ];
  }

  private bodyEdgesAt(y: number): { left: number; right: number } | undefined {
    if (!this.puppet) return undefined;
    let left: number | undefined;
    let right: number | undefined;
    for (const id of ['head', 'torso', 'pelvis']) {
      const sprite = this.puppet.getBone(id).sprite;
      if (!sprite) continue;
      const edges = horizontalEdgesAtY(this.cutoutCorners(sprite), y);
      if (edges) {
        left = Math.min(left ?? Infinity, edges.left);
        right = Math.max(right ?? -Infinity, edges.right);
      }
    }
    return left === undefined || right === undefined ? undefined : { left, right };
  }

  private aimKatana(angle: number): void {
    if (!this.puppet || !this.katana?.container.parentContainer) return;
    const world = this.puppet.container.getWorldTransformMatrix();
    const parent = this.katana.container.parentContainer.getWorldTransformMatrix();
    const dx = world.a * Math.cos(angle) + world.c * Math.sin(angle);
    const dy = world.b * Math.cos(angle) + world.d * Math.sin(angle);
    const determinant = parent.a * parent.d - parent.b * parent.c;
    if (determinant === 0) return;
    // Transform a direction (no translation), so the blade aims relative to
    // facing while the grip mounted to the front palm stays fixed.
    const rotation = Math.atan2(
      (parent.a * dy - parent.b * dx) / determinant,
      (parent.d * dx - parent.c * dy) / determinant,
    );
    this.katana.container.setRotation(rotation);
    const grip = this.puppet.facingDirection === 'right' ? katanaGrips.primary : katanaGrips.secondary;
    this.katana.container.setPosition(
      grip.x - (Math.cos(rotation) * grip.x - Math.sin(rotation) * grip.y),
      grip.y - (Math.sin(rotation) * grip.x + Math.cos(rotation) * grip.y),
    );
  }
}
