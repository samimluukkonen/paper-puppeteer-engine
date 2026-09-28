import Phaser from 'phaser';
import { Puppet } from '../engine/index.js';
import type { Facing } from '../engine/index.js';
import { demoRig } from './demoRig.js';
import { demoAnimations } from './demoAnimations.js';
import { demoArmRotations, demoHipPositions, demoRenderOrder, demoShoulderPositions } from './demoPresentation.js';
import { createTextures } from './createTextures.js';

export interface DemoState {
  animation: string;
  facing: Facing;
  debug: boolean;
  playing: boolean;
  attached: boolean;
}

export class DemoScene extends Phaser.Scene {
  puppet: Puppet | undefined;
  private prop: Phaser.GameObjects.Image | undefined;
  private attached = true;

  constructor(private readonly onChange: (state: DemoState) => void) {
    super('DemoScene');
  }

  create(): void {
    this.attached = true;
    createTextures(this);
    const { width, height } = this.scale;
    const floor = this.add.graphics();
    floor.lineStyle(1, 0x9eaa97, 0.45).lineBetween(70, height - 115, width - 70, height - 115);
    floor.fillStyle(0x515e4e, 0.08).fillEllipse(width / 2, height - 115, 170, 18);
    this.add.text(30, 28, 'FIG. 01 / HIERARCHICAL CUTOUT', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678', letterSpacing: 1,
    });
    this.add.text(width - 30, 28, '16 JOINTS · 1 PROP', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678',
    }).setOrigin(1, 0);
    this.puppet = new Puppet(this, {
      rig: demoRig, x: width / 2, y: height - 278,
      animations: demoAnimations, scale: 1.08, autoUpdate: false,
    });
    this.prop = this.add.image(0, 0, 'paper-prop').setOrigin(0.08, 0.85).setRotation(-0.16);
    this.puppet.attach('rightHand', this.prop, { x: 4, y: 12 }).play('idle');
    this.updatePresentation();
    this.add.text(width / 2, height - 62, 'RIGID PIECES. SHARED MOTION.', {
      fontFamily: 'monospace', fontSize: '11px', color: '#7e8678', letterSpacing: 2,
    }).setOrigin(0.5);
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-ONE', () => this.play('idle'));
      keyboard.on('keydown-TWO', () => this.play('walk'));
      keyboard.on('keydown-A', () => this.face('left'));
      keyboard.on('keydown-D', () => this.face('right'));
      keyboard.on('keydown-B', () => this.toggleDebug());
      keyboard.on('keydown-P', () => this.toggleProp());
      keyboard.on('keydown-SPACE', () => this.togglePlayback());
      keyboard.on('keydown-R', () => this.restart());
      keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.SPACE]);
    }
    this.notify();
  }

  update(_time: number, delta: number): void {
    if (!this.puppet?.isPlaying) return;
    this.puppet.animationPlayer.update(delta);
    this.updatePresentation();
  }

  play(name: string): void {
    this.puppet?.play(name);
    this.updatePresentation();
    this.notify();
  }

  face(direction: Facing): void {
    this.puppet?.setFacing(direction);
    this.updatePresentation();
    this.notify();
  }
  toggleDebug(): void { if (this.puppet) this.puppet.setDebug(!this.puppet.isDebug); this.notify(); }
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
    if (!this.puppet || !this.prop) return;
    if (this.attached) {
      this.puppet.detach(this.prop);
      this.prop.setVisible(false);
    } else {
      this.prop.setVisible(true);
      this.puppet.attach('rightHand', this.prop, { x: 4, y: 12 });
    }
    this.attached = !this.attached;
    this.notify();
  }

  private notify(): void {
    if (!this.puppet) return;
    this.onChange({
      animation: this.puppet.currentAnimation ?? 'none', facing: this.puppet.facingDirection,
      debug: this.puppet.isDebug, playing: this.puppet.isPlaying, attached: this.attached,
    });
  }

  private updatePresentation(): void {
    if (!this.puppet) return;
    // Always start from the sampled pose so facing changes cannot accumulate rotations.
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
    if (this.puppet.currentAnimation === 'idle' || this.puppet.currentAnimation === 'walk') {
      const hips = demoHipPositions(this.puppet.rig, this.puppet.facingDirection);
      for (const [id, x] of Object.entries(hips)) this.puppet.getBone(id).pose.x = x;
    }
    const idle = this.puppet.currentAnimation === 'idle';
    this.puppet.setDebugLabelSide('rightLowerLeg', idle && this.puppet.facingDirection === 'right' ? 'left' : undefined);
    this.puppet.setDebugLabelSide('leftLowerLeg', idle && this.puppet.facingDirection === 'left' ? 'right' : undefined);
    this.puppet.setDebugLabelSide('rightFoot', idle && this.puppet.facingDirection === 'left' ? 'left' : undefined);
    this.puppet.setDebugLabelSide('leftFoot', idle && this.puppet.facingDirection === 'right' ? 'right' : undefined);
    this.puppet.syncPose();
  }
}
