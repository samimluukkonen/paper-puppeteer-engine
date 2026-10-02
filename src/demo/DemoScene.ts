import Phaser from 'phaser';
import type { CharacterDefinition, Facing } from '../engine/index.js';
import { Puppet } from '../engine/index.js';
import { loadSceneCharacter } from '../shared/loadSceneCharacter.js';
import { DemoInput } from './DemoInput.js';
import { DemoPoseAuthoring } from './DemoPoseAuthoring.js';
import { createDemoBackdrop, DemoPresenter } from './DemoPresenter.js';
import { demoIK } from './demoIK.js';

export interface DemoState {
  animation: string;
  facing: Facing;
  debug: boolean;
  playing: boolean;
  katanaVisible: boolean;
  handIK: boolean;
  footIK: boolean;
  ikDebug: boolean;
  playback: string;
  fps: number;
  speed: number;
  paused: boolean;
  upperBody: boolean;
  layerWeight: number;
  transition: string;
  lastEvent: string;
  skin: string;
  gripHand: boolean;
  helmet: boolean;
  slotDebug: boolean;
  poseMode: boolean;
}

export class DemoScene extends Phaser.Scene {
  puppet: Puppet | undefined;
  private presentation: DemoPresenter | undefined;
  private authoring: DemoPoseAuthoring | undefined;
  private controls: DemoInput | undefined;
  private handIK = false;
  private footIK = false;
  private steppedFPS = 10;
  private upperBody = false;
  private lastEvent = 'none';
  private skin = 'default';
  private gripHand = false;
  private helmet = false;

  private get poseMode(): boolean {
    return this.authoring?.active ?? false;
  }

  constructor(private readonly onChange: (state: DemoState) => void) {
    super('DemoScene');
  }

  create(): void {
    // Phaser reuses this scene instance across restarts, but destroys its objects.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.puppet = undefined;
      this.presentation = undefined;
      this.authoring = undefined;
      this.controls = undefined;
    });
    void this.loadCharacter();
  }

  private async loadCharacter(): Promise<void> {
    try {
      const url = `${import.meta.env.BASE_URL}characters/demo-puppet/character.json`;
      const definition = await loadSceneCharacter(this, url);
      if (definition && this.sys.isActive()) this.createPuppet(definition);
    } catch (error) {
      if (this.sys.isActive()) this.showLoadError(String(error));
    }
  }

  private showLoadError(message: string): void {
    this.add.text(30, 60, `Character load failed: ${message}`, { color: '#a03930', wordWrap: { width: 600 } });
  }

  private createPuppet(definition: CharacterDefinition): void {
    this.handIK = false;
    this.footIK = false;
    this.upperBody = false;
    this.lastEvent = 'none';
    this.skin = 'default';
    this.gripHand = false;
    this.helmet = false;
    createDemoBackdrop(this);
    const { width, height } = this.scale;
    this.puppet = new Puppet(this, {
      definition,
      x: width / 2,
      y: height - 278,
      ik: demoIK,
      scale: 1.08,
      autoUpdate: false,
    });
    this.presentation = new DemoPresenter(this, this.puppet);
    this.puppet.play('idle');
    this.puppet.onAnimationEvent((event) => {
      this.lastEvent = `${event.clip}: ${event.name}`;
      this.notify();
    });
    this.authoring = new DemoPoseAuthoring(this, this.puppet);
    this.updatePresentation();
    this.controls = new DemoInput(this, this.authoring, this.presentation);
    this.notify();
  }

  update(_time: number, delta: number): void {
    if (!this.puppet) return;
    if (this.poseMode) return;
    this.presentation?.feet.advance(delta);
    this.rotateKatana(this.controls?.katanaTurn(delta) ?? 0);
    this.puppet.preparePose();
    const playing = this.puppet.isPlaying;
    const transitioning = this.puppet.animationPlayer.transition !== undefined;
    const poseEvaluated = this.puppet.animationPlayer.update(delta);
    this.updatePresentation(poseEvaluated);
    if (playing !== this.puppet.isPlaying || transitioning || this.puppet.animationPlayer.transition) this.notify();
  }

  togglePoseMode(): void {
    if (!this.puppet || !this.authoring) return;
    if (this.poseMode) {
      this.play('idle');
      return;
    }
    this.handIK = false;
    this.footIK = false;
    this.upperBody = false;
    this.authoring.enter();
    this.presentation?.clearTargets();
    this.notify();
  }

  selectBone(direction: number): void {
    this.authoring?.selectBone(direction);
  }

  adjustSelected(property: 'x' | 'y' | 'rotation', change: number): void {
    this.authoring?.adjustSelected(property, change);
  }

  resetSelectedBone(): void {
    this.authoring?.resetSelectedBone();
  }

  resetBind(): void {
    this.authoring?.resetBind();
  }

  applyCombatPose(): void {
    this.authoring?.applyCombatPose();
  }

  exportCurrentPose(): void {
    this.authoring?.exportCurrentPose();
  }

  exportRig(): void {
    this.authoring?.exportRig();
  }

  play(name: string): void {
    this.authoring?.exit();
    this.puppet?.clearPose();
    this.puppet?.play(name);
    this.handIK = name === 'sword';
    if (name === 'sword') {
      this.presentation?.katana.resetRearPalm(this.puppet?.facingDirection ?? 'right');
    }
    this.updatePresentation();
    this.notify();
  }

  crossfade(name: 'idle' | 'walk'): void {
    if (this.poseMode) {
      this.play(name);
      return;
    }
    this.puppet?.play(name, { fadeDuration: 300 });
    this.handIK = false;
    this.updatePresentation();
    this.notify();
  }

  toggleStepped(): void {
    if (!this.puppet) return;
    const stepped = this.puppet.animationPlayer.playbackMode.mode === 'stepped';
    this.puppet.setAnimationPlaybackMode(stepped ? { mode: 'smooth' } : { mode: 'stepped', fps: this.steppedFPS });
    this.updatePresentation();
    this.notify();
  }

  setSteppedFPS(fps: number): void {
    this.steppedFPS = fps;
    this.puppet?.setAnimationFPS(fps);
    this.updatePresentation();
    this.notify();
  }

  togglePause(): void {
    if (this.puppet?.animationPlayer.isPaused) this.puppet.resumeAnimation();
    else this.puppet?.pauseAnimation();
    this.notify();
  }

  adjustSpeed(change: number): void {
    if (!this.puppet) return;
    this.puppet.setAnimationSpeed(Math.max(0, Math.min(2, this.puppet.animationPlayer.playbackSpeed + change)));
    this.notify();
  }

  toggleUpperBody(): void {
    if (!this.puppet) return;
    if (this.poseMode) this.play('idle');
    this.upperBody = !this.upperBody;
    if (this.upperBody) {
      this.puppet.setLayerMask('upperBody', [
        'torso',
        'head',
        'leftUpperArm',
        'leftForearm',
        'leftHand',
        'rightUpperArm',
        'rightForearm',
        'rightHand',
      ]);
      this.puppet.play('guardUpperBody', { layer: 'upperBody', fadeDuration: 250 });
    } else this.puppet.clearLayer('upperBody');
    this.updatePresentation();
    this.notify();
  }

  face(direction: Facing): void {
    if (this.poseMode && this.puppet) {
      this.authoring?.face(direction);
      this.presentation?.katana.reattach();
      this.authoring?.refresh();
      this.notify();
      return;
    }
    // setFacing synchronizes the rig; wait until the weapon mount has changed
    // before asking the rear hand to evaluate its grip in the new direction.
    if (this.puppet) {
      this.puppet.getIK('leftArmIK').enabled = false;
      this.puppet.getIK('rightArmIK').enabled = false;
    }
    this.puppet?.setFacing(direction);
    this.presentation?.katana.resetRearPalm(direction);
    this.presentation?.katana.reattach();
    this.updatePresentation();
    this.notify();
  }
  toggleDebug(): void {
    if (this.puppet) this.puppet.setDebug(!this.puppet.isDebug);
    this.notify();
  }
  toggleIKDebug(): void {
    if (this.puppet) this.puppet.setIKDebug(!this.puppet.isIKDebug);
    this.notify();
  }
  toggleHandIK(): void {
    if (this.poseMode) return;
    this.handIK = !this.handIK;
    this.updatePresentation();
    this.notify();
  }
  toggleFootIK(): void {
    if (this.poseMode) return;
    this.footIK = !this.footIK;
    this.updatePresentation();
    this.notify();
  }
  rotateKatana(delta: number): void {
    this.presentation?.katana.rotate(delta);
  }
  restart(): void {
    if (this.poseMode) {
      this.resetBind();
      return;
    }
    this.puppet?.restart();
    this.updatePresentation();
    this.notify();
  }

  togglePlayback(): void {
    if (this.poseMode) {
      this.play('idle');
      return;
    }
    if (this.puppet?.isPlaying) this.puppet.stop();
    else this.puppet?.restart();
    this.updatePresentation();
    this.notify();
  }

  toggleProp(): void {
    if (!this.presentation) return;
    this.presentation.katana.enabled = !this.presentation.katana.enabled;
    this.updatePresentation();
    this.notify();
  }

  setSkin(name: 'default' | 'alternate'): void {
    if (!this.puppet) return;
    this.skin = name;
    this.puppet.setSkin(name);
    this.syncVisualOverrides();
    this.notify();
  }

  toggleGripHand(): void {
    this.gripHand = !this.gripHand;
    this.syncVisualOverrides();
    this.notify();
  }

  toggleHelmet(): void {
    this.helmet = !this.helmet;
    this.syncVisualOverrides();
    this.notify();
  }

  toggleSlotDebug(): void {
    if (this.puppet) this.puppet.setSlotDebug(!this.puppet.isSlotDebug);
    this.notify();
  }

  private syncVisualOverrides(): void {
    if (!this.puppet) return;
    this.puppet.setAttachment('rightHandVisual', this.gripHand ? 'rightHandGrip' : 'rightHandDefault');
    if (this.helmet) this.puppet.applySkin('helmet-only');
    else this.puppet.clearAttachment('headwear');
    this.presentation?.katana.syncVisualOverride();
  }

  private notify(): void {
    if (!this.puppet) return;
    this.onChange({
      animation: this.puppet.currentAnimation ?? 'none',
      facing: this.puppet.facingDirection,
      debug: this.puppet.isDebug,
      playing: this.puppet.isPlaying,
      katanaVisible: this.presentation?.katana.enabled ?? true,
      handIK: this.handIK,
      footIK: this.footIK,
      ikDebug: this.puppet.isIKDebug,
      playback: this.puppet.animationPlayer.playbackMode.mode,
      fps: this.steppedFPS,
      speed: this.puppet.animationPlayer.playbackSpeed,
      paused: this.puppet.animationPlayer.isPaused,
      upperBody: this.upperBody,
      layerWeight: this.puppet.animationPlayer.getLayerWeight('upperBody'),
      transition: this.puppet.animationPlayer.transition
        ? `${this.puppet.animationPlayer.transition.from} → ${this.puppet.animationPlayer.transition.to} ${Math.round(this.puppet.animationPlayer.transition.progress * 100)}%`
        : 'none',
      lastEvent: this.lastEvent,
      skin: this.skin,
      gripHand: this.gripHand,
      helmet: this.helmet,
      slotDebug: this.puppet.isSlotDebug,
      poseMode: this.poseMode,
    });
  }

  private updatePresentation(poseEvaluated = false): void {
    if (!this.puppet) return;
    if (this.poseMode) {
      this.puppet.syncPose();
      this.authoring?.refresh();
      return;
    }
    this.presentation?.update({ handIK: this.handIK, footIK: this.footIK, upperBody: this.upperBody }, poseEvaluated);
  }
}
