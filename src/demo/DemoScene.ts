import Phaser from 'phaser';
import type { CharacterDefinition, Facing } from '../engine/index.js';
import { Puppet } from '../engine/index.js';
import { loadSceneCharacter } from '../shared/loadSceneCharacter.js';
import {
  type DemoAnimationRole,
  type DemoCharacterProfile,
  demoPuppetProfile,
  getDemoAnimationRole,
  getDemoCharacterProfile,
  resolveDemoClip,
} from './demoCharacterProfiles.js';
import { DemoInput } from './DemoInput.js';
import { DemoPoseAuthoring } from './DemoPoseAuthoring.js';
import { createDemoBackdrop, DemoPresenter } from './DemoPresenter.js';

export interface DemoState {
  animation: string;
  animationRole: DemoAnimationRole | undefined;
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
  private skin: 'default' | 'alternate' = 'default';
  private defaultSkin = 'default';
  private gripHand = false;
  private helmet = false;
  private profile: DemoCharacterProfile = demoPuppetProfile;
  private commandDepth = 0;
  private loadSession = 0;
  private readonly prepareAnimationPose = (): void => this.presentation?.preparePose();
  private readonly synchronizeAnimationPose = (): void => this.updatePresentation(true);

  private get poseMode(): boolean {
    return this.authoring?.active ?? false;
  }

  constructor(
    private readonly onChange: (state: DemoState) => void,
    private readonly characterUrl = 'characters/demo-puppet/character.json',
  ) {
    super('DemoScene');
  }

  create(): void {
    const session = ++this.loadSession;
    // Phaser reuses this scene instance across restarts, but destroys its objects.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ++this.loadSession;
      this.puppet = undefined;
      this.presentation = undefined;
      this.authoring = undefined;
      this.controls = undefined;
    });
    void this.loadCharacter(session);
  }

  private async loadCharacter(session: number): Promise<void> {
    try {
      const definition = await loadSceneCharacter(this, this.characterUrl);
      if (definition && session === this.loadSession && this.sys.isActive()) this.createPuppet(definition);
    } catch (error) {
      if (session === this.loadSession && this.sys.isActive()) this.showLoadError(String(error));
    }
  }

  private showLoadError(message: string): void {
    this.add.text(30, 60, `Character load failed: ${message}`, { color: '#a03930', wordWrap: { width: 600 } });
  }

  private createPuppet(definition: CharacterDefinition): void {
    this.profile = getDemoCharacterProfile(definition.id);
    this.handIK = false;
    this.footIK = false;
    this.upperBody = false;
    this.lastEvent = 'none';
    this.defaultSkin = definition.defaultSkin;
    this.skin = 'default';
    this.gripHand = false;
    this.helmet = false;
    createDemoBackdrop(this, definition.rig.bones.length, this.profile);
    const { width, height } = this.scale;
    this.puppet = new Puppet(this, {
      definition,
      x: width / 2,
      y: height - this.profile.placement.yOffset,
      ik: this.profile.ikChains,
      scale: this.profile.placement.scale,
      autoUpdate: false,
    });
    this.presentation = new DemoPresenter(this, this.puppet, this.profile);
    this.puppet.play(this.profile.clips.idle);
    this.puppet.onAnimationEvent((event) => {
      this.lastEvent = `${event.clip}: ${event.name}`;
      this.notify();
    });
    this.authoring = new DemoPoseAuthoring(this, this.puppet, this.profile);
    this.updatePresentation();
    this.controls = new DemoInput(this, this.authoring, this.presentation);
    this.notify();
  }

  update(_time: number, delta: number): void {
    if (!this.puppet) return;
    if (this.poseMode) return;
    this.presentation?.feet.advance(delta);
    this.rotateKatana(this.controls?.katanaTurn(delta) ?? 0);
    const playing = this.puppet.isPlaying;
    const transitioning = this.puppet.animationPlayer.transition !== undefined;
    const poseEvaluated = this.puppet.animationPlayer.update(
      delta,
      this.prepareAnimationPose,
      this.synchronizeAnimationPose,
    );
    if (!poseEvaluated) this.updatePresentation();
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
    this.runPresentationCommand(
      (puppet) => {
        const clip = resolveDemoClip(this.profile, name);
        puppet.clearPose().play(clip);
        this.handIK = clip === this.profile.clips.sword;
        if (this.handIK) this.presentation?.katana.resetRearPalm(puppet.facingDirection);
      },
      { preparePose: true },
    );
  }

  crossfade(name: 'idle' | 'walk'): void {
    if (this.poseMode) {
      this.play(name);
      return;
    }
    this.presentation?.captureCrossfadeSource();
    this.runPresentationCommand(
      (puppet) => {
        puppet.play(this.profile.clips[name], { fadeDuration: 300 });
        this.handIK = false;
      },
      { preparePose: true },
    );
  }

  toggleStepped(): void {
    this.runPresentationCommand((puppet) => {
      const stepped = puppet.animationPlayer.playbackMode.mode === 'stepped';
      puppet.setAnimationPlaybackMode(stepped ? { mode: 'smooth' } : { mode: 'stepped', fps: this.steppedFPS });
    });
  }

  setSteppedFPS(fps: number): void {
    this.runPresentationCommand((puppet) => {
      puppet.setAnimationFPS(fps);
      this.steppedFPS = fps;
    });
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
    if (this.poseMode) this.play('idle');
    this.runPresentationCommand(
      (puppet) => {
        this.upperBody = !this.upperBody;
        if (this.upperBody) {
          puppet.setLayerMask('upperBody', this.profile.upperBody.mask);
          puppet.play(this.profile.upperBody.clip, { layer: 'upperBody', fadeDuration: 250 });
        } else puppet.clearLayer('upperBody');
      },
      { preparePose: true },
    );
  }

  face(direction: Facing): void {
    if (this.poseMode && this.puppet) {
      this.authoring?.face(direction);
      this.presentation?.sketchFacing?.syncVisuals();
      this.presentation?.katana.reattach();
      this.authoring?.refresh();
      this.notify();
      return;
    }
    this.runPresentationCommand(
      (puppet) => {
        // Wait until the weapon mount has changed before evaluating the rear-hand grip.
        puppet.getIK(this.profile.armIK.left).enabled = false;
        puppet.getIK(this.profile.armIK.right).enabled = false;
        puppet.setFacing(direction);
        this.presentation?.katana.resetRearPalm(direction);
        this.presentation?.katana.reattach();
      },
      { preparePose: true },
    );
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
    this.runPresentationCommand(() => {
      this.handIK = !this.handIK;
    });
  }
  toggleFootIK(): void {
    if (this.poseMode) return;
    this.runPresentationCommand(() => {
      this.footIK = !this.footIK;
    });
  }
  rotateKatana(delta: number): void {
    this.presentation?.katana.rotate(delta);
  }
  restart(): void {
    if (this.poseMode) {
      this.resetBind();
      return;
    }
    this.runPresentationCommand((puppet) => puppet.restart(), { preparePose: true });
  }

  togglePlayback(): void {
    if (this.poseMode) {
      this.play('idle');
      return;
    }
    this.runPresentationCommand(
      (puppet) => {
        if (puppet.isPlaying) puppet.stop();
        else puppet.restart();
      },
      { preparePose: true },
    );
  }

  toggleProp(): void {
    if (!this.presentation) return;
    const katana = this.presentation.katana;
    this.runPresentationCommand(() => {
      katana.enabled = !katana.enabled;
    });
  }

  setSkin(name: 'default' | 'alternate'): void {
    if (!this.puppet) return;
    this.puppet.setSkin(name === 'default' ? this.defaultSkin : this.profile.appearance.alternateSkin);
    this.skin = name;
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
    if (this.presentation?.sketchFacing) this.presentation.sketchFacing.setGripHand(this.gripHand);
    else {
      const appearance = this.profile.appearance;
      this.puppet.setAttachment(
        appearance.gripHandSlot,
        this.gripHand ? appearance.gripHandAttachment : appearance.openHandAttachment,
      );
    }
    if (this.helmet) this.puppet.applySkin(this.profile.appearance.headwearSkin);
    else this.puppet.clearAttachment(this.profile.appearance.headwearSlot);
    this.presentation?.katana.syncVisualOverride();
  }

  private notify(): void {
    if (!this.puppet || this.commandDepth > 0) return;
    this.onChange({
      animation: this.puppet.currentAnimation ?? 'none',
      animationRole: getDemoAnimationRole(this.profile, this.puppet.currentAnimation),
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

  /** Commands finish with presentation before UI observers read the new state. */
  private runPresentationCommand(change: (puppet: Puppet) => void, options: { preparePose?: boolean } = {}): void {
    const puppet = this.puppet;
    if (!puppet) return;
    ++this.commandDepth;
    try {
      if (options.preparePose) this.presentation?.preparePose();
      change(puppet);
    } finally {
      --this.commandDepth;
    }
    if (this.commandDepth === 0) {
      this.updatePresentation();
      this.notify();
    }
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
