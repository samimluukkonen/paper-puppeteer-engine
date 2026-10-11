import Phaser from 'phaser';
import type { AnimationPose } from '../../engine/AnimationPose.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { Puppet } from '../../engine/Puppet.js';
import type { Facing } from '../../engine/types.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import { ikPreviewTarget } from '../shared/ikPreviewTarget.js';
import { AnimationEditorGhostLayer, AnimationPoseOverlay } from './AnimationEditorGhostLayer.js';
import { AnimationEditorIKHandles } from './AnimationEditorIKHandles.js';
import { AnimationEditorPreview } from './AnimationEditorPreview.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { DEFAULT_ONION_SKIN_SETTINGS, type OnionSkinSettings, updateOnionSkinSettings } from './onionSkinSettings.js';
import { toSeconds } from './timeUnits.js';

export interface AnimationEditorSceneOptions {
  /** Resolved relative to the editor document, including when served under a base path. */
  readonly characterUrl?: string;
  readonly ikChains?: readonly TwoBoneIKDefinition[];
}

export class AnimationEditorScene extends Phaser.Scene {
  private puppet: Puppet | undefined;
  private ikHandles: AnimationEditorIKHandles | undefined;
  private ikHandlesVisible = true;
  private ikHandlesInteractive = true;
  private preview: AnimationEditorPreview | undefined;
  private ghosts: AnimationEditorGhostLayer | undefined;
  private mirrorOverlay: AnimationPoseOverlay | undefined;
  private mirrorPose: AnimationPose | null = null;
  private mirrorSample: { pose: AnimationPose } | null = null;
  private bakeOverlay: AnimationPoseOverlay | undefined;
  private bakeSample: { pose: AnimationPose } | null = null;
  private onionSkinSettings = DEFAULT_ONION_SKIN_SETTINGS;
  private state: AnimationEditorState | undefined;
  private loadSession = 0;
  private selectionOverlay: Phaser.GameObjects.Graphics | undefined;
  private facing: Facing = 'right';
  private bonesVisible = true;
  private ikPreviewEnabled = false;
  private readonly options: AnimationEditorSceneOptions;

  constructor(
    private readonly onReady: (state: AnimationEditorState, characterId: string) => void,
    private readonly onError: (message: string) => void,
    options: AnimationEditorSceneOptions = {},
  ) {
    super('AnimationEditorScene');
    this.options = structuredClone(options);
  }

  create(): void {
    const session = ++this.loadSession;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ++this.loadSession;
      this.state?.pause();
      this.state?.endScrub();
      this.ikHandles?.dispose();
      this.ikHandles = undefined;
      this.state = undefined;
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
      this.clearMirrorPreview();
      this.clearBakePreview();
      this.ghosts?.dispose();
      this.ghosts = undefined;
      this.preview?.dispose();
      this.preview = undefined;
      this.puppet?.destroy();
      this.puppet = undefined;
    });
    void this.loadCharacter(session);
  }

  update(_time: number, delta: number): void {
    const advance = (): void => this.state?.advancePlayback(toSeconds(delta));
    if (this.ghosts) this.ghosts.updateFrame(advance);
    else advance();
    this.syncMirrorPreview();
    this.syncBakePreview();
    this.ikHandles?.render();
    const overlay = this.selectionOverlay;
    overlay?.clear();
    if (overlay && this.puppet && this.state?.selectedBoneId) {
      const point = this.puppet.getBone(this.state.selectedBoneId).getWorldPosition();
      overlay.lineStyle(3, 0xb7543a).strokeCircle(point.x, point.y, 10);
    }
  }

  private selectPreviewBone(pointer: Phaser.Input.Pointer): void {
    if (this.ikHandles?.pointerDown(pointer)) return;
    if (!this.puppet || !this.state || pointer.button !== 0) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    let nearest: string | undefined;
    let distance = 12 / this.cameras.main.zoom;
    for (const bone of this.puppet.rig.bones) {
      const point = this.puppet.getBone(bone.id).getWorldPosition();
      const next = Math.hypot(point.x - world.x, point.y - world.y);
      if (next < distance) {
        distance = next;
        nearest = bone.id;
      }
    }
    if (nearest) this.state.selectBone(nearest);
  }

  setIKHandlesVisible(visible: boolean): void {
    this.ikHandlesVisible = visible;
    this.ikHandles?.setVisible(visible);
  }
  setIKHandlesInteractive(interactive: boolean): void {
    this.ikHandlesInteractive = interactive;
    this.ikHandles?.setInteractive(interactive);
  }
  setFacing(facing: Facing): void {
    this.facing = facing;
    this.puppet?.setFacing(facing);
    this.ghosts?.sync();
    this.syncMirrorPreview();
    this.syncBakePreview();
  }

  /** Exclude inactive editor-only chains; all active runtime ownership must pass bake validation. */
  getBakeRuntimeConstraints(): readonly TwoBoneIKConstraint[] {
    const puppet = this.puppet;
    if (!puppet) return [];
    const names = new Set([...(puppet.rig.ik ?? []), ...(this.options.ikChains ?? [])].map((entry) => entry.name));
    return [...names]
      .map((id) => puppet.getIK(id))
      .filter((entry) => entry.enabled || puppet.rig.ik?.some((definition) => definition.name === entry.name));
  }

  setBakePreview(pose: AnimationPose | null): void {
    if (!pose) {
      this.clearBakePreview();
      return;
    }
    this.bakeSample = { pose };
    this.syncBakePreview();
  }

  private syncBakePreview(): void {
    const puppet = this.puppet;
    if (!puppet || !this.bakeSample) return;
    this.bakeOverlay ??= new AnimationPoseOverlay(this, puppet, 'bake', 0);
    this.bakeOverlay.apply(this.bakeSample);
    this.bakeOverlay.syncAppearance(
      puppet,
      { ...DEFAULT_ONION_SKIN_SETTINGS, nextOpacity: 0.55, nextTint: 0xa875e8 },
      puppet.getAppearanceRevision(),
    );
    this.bakeOverlay.container.setVisible(puppet.container.visible);
  }

  private clearBakePreview(): void {
    this.bakeOverlay?.destroy();
    this.bakeOverlay = undefined;
    this.bakeSample = null;
  }

  /** Independent render-only layer; never applies its pose to the authoritative puppet. */
  setMirrorPreview(pose: AnimationPose | null): void {
    if (this.mirrorPose === pose) return;
    this.mirrorPose = pose;
    this.mirrorSample = pose ? { pose } : null;
    if (!pose) this.mirrorOverlay?.hide();
    else this.syncMirrorPreview();
  }

  private syncMirrorPreview(): void {
    const puppet = this.puppet;
    if (!puppet || !this.mirrorPose) return;
    this.mirrorOverlay ??= new AnimationPoseOverlay(this, puppet, 'mirror', 0);
    this.mirrorOverlay.apply(this.mirrorSample!);
    this.mirrorOverlay.syncAppearance(
      puppet,
      {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        nextOpacity: 0.35,
        nextTint: 0xa875e8,
      },
      puppet.getAppearanceRevision(),
    );
    this.mirrorOverlay.container.setVisible(puppet.container.visible);
  }

  private clearMirrorPreview(): void {
    this.mirrorOverlay?.destroy();
    this.mirrorOverlay = undefined;
    this.mirrorPose = null;
    this.mirrorSample = null;
  }

  setOnionSkinning(enabled: boolean): void {
    this.setOnionSkinSettings({ enabled });
  }

  getOnionSkinSettings(): OnionSkinSettings {
    return this.onionSkinSettings;
  }

  setOnionSkinSettings(patch: Partial<OnionSkinSettings>): void {
    this.onionSkinSettings = updateOnionSkinSettings(this.onionSkinSettings, patch);
    this.ghosts?.setSettings(this.onionSkinSettings);
  }

  setBonesVisible(visible: boolean): void {
    this.bonesVisible = visible;
    this.puppet?.setDebug(visible);
  }

  /** Frame the loaded artwork once; keep the camera stable while authoring and playing. */
  fitPreview(): void {
    const bounds = this.puppet?.container.getBounds();
    if (
      !bounds ||
      !(bounds.width > 0) ||
      !(bounds.height > 0) ||
      ![bounds.width, bounds.height, bounds.centerX, bounds.centerY].every(Number.isFinite)
    )
      return;
    const camera = this.cameras.main;
    camera.setZoom(Math.min(camera.width / (bounds.width + 120), camera.height / (bounds.height + 120)));
    camera.centerOn(bounds.centerX, bounds.centerY);
  }

  /** Pin current solver endpoints in canonical puppet space; mirroring only changes their world projection. */
  setIKPreview(enabled: boolean): void {
    this.state?.cancelIKTargetDrag();
    this.ikPreviewEnabled = enabled;
    const puppet = this.puppet;
    if (!puppet) return;
    puppet.preparePose();
    for (const chain of this.options.ikChains ?? []) {
      const constraint = puppet.getIK(chain.name);
      if (enabled) {
        const point = ikPreviewTarget(puppet, constraint);
        const local = puppet.container.getWorldTransformMatrix().applyInverse(point.x, point.y);
        constraint.setTargetProvider(() => puppet.container.getWorldTransformMatrix().transformPoint(local.x, local.y));
      } else {
        constraint.setTargetProvider(undefined);
      }
      const authored = puppet.rig.ik?.find((definition) => definition.name === chain.name);
      constraint.enabled = enabled || (authored ? (authored.enabled ?? true) : false);
    }
    puppet.syncPose();
    this.ikHandles?.refreshAvailability();
  }

  private async loadCharacter(session: number): Promise<void> {
    let puppet: Puppet | undefined;
    let preview: AnimationEditorPreview | undefined;
    let ghosts: AnimationEditorGhostLayer | undefined;
    try {
      const url = new URL(
        this.options.characterUrl ?? '../characters/demo-puppet/character.json',
        window.location.href,
      );
      const definition = await loadSceneCharacter(this, url.href);
      if (!definition || session !== this.loadSession || !this.sys.isActive()) return;
      const state = new AnimationEditorState(definition.rig, definition.animations, {
        animationPaths: definition.animationPaths,
      });
      state.selectAnimation(state.animationIds[0] ?? null);
      puppet = new Puppet(this, {
        rig: definition.rig,
        skin: definition.defaultSkin,
        x: 380,
        y: 435,
        autoUpdate: false,
        facing: this.facing,
        debug: this.bonesVisible,
        ik: [
          ...(definition.rig.ik ?? []),
          ...(this.options.ikChains ?? [])
            .filter((chain) => !definition.rig.ik?.some((authored) => authored.name === chain.name))
            .map((chain) => ({ ...chain, enabled: false })),
        ],
      });
      preview = new AnimationEditorPreview(state, puppet);
      ghosts = new AnimationEditorGhostLayer(this, state, puppet);
      ghosts.setSettings(this.onionSkinSettings);
      this.ghosts = ghosts;
      this.puppet = puppet;
      this.preview = preview;
      this.state = state;
      if (this.ikPreviewEnabled) this.setIKPreview(true);
      this.ikHandles = new AnimationEditorIKHandles(this, state, puppet);
      this.ikHandles.setVisible(this.ikHandlesVisible);
      this.ikHandles.setInteractive(this.ikHandlesInteractive);
      this.selectionOverlay = this.add.graphics().setDepth(puppet.container.depth + 5);
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input.on('pointerdown', this.selectPreviewBone, this);
      this.onReady(state, definition.id);
    } catch (error) {
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
      this.clearMirrorPreview();
      this.clearBakePreview();
      this.ikHandles?.dispose();
      this.ikHandles = undefined;
      ghosts?.dispose();
      this.ghosts = undefined;
      preview?.dispose();
      puppet?.destroy();
      this.preview = undefined;
      this.puppet = undefined;
      this.state?.pause();
      this.state = undefined;
      if (session === this.loadSession && this.sys.isActive()) this.onError(String(error));
    }
  }
}
