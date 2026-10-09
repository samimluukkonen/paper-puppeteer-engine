import Phaser from 'phaser';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { Puppet } from '../../engine/Puppet.js';
import type { Facing } from '../../engine/types.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import { AnimationEditorPreview } from './AnimationEditorPreview.js';
import { AnimationEditorState } from './AnimationEditorState.js';
import { toSeconds } from './timeUnits.js';

export interface AnimationEditorSceneOptions {
  /** Resolved relative to the editor document, including when served under a base path. */
  readonly characterUrl?: string;
  readonly ikChains?: readonly TwoBoneIKDefinition[];
}

export class AnimationEditorScene extends Phaser.Scene {
  private puppet: Puppet | undefined;
  private preview: AnimationEditorPreview | undefined;
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
      this.state = undefined;
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
      this.preview?.dispose();
      this.preview = undefined;
      this.puppet?.destroy();
      this.puppet = undefined;
    });
    void this.loadCharacter(session);
  }

  update(_time: number, delta: number): void {
    this.state?.advancePlayback(toSeconds(delta));
    const overlay = this.selectionOverlay;
    overlay?.clear();
    if (overlay && this.puppet && this.state?.selectedBoneId) {
      const point = this.puppet.getBone(this.state.selectedBoneId).getWorldPosition();
      overlay.lineStyle(3, 0xb7543a).strokeCircle(point.x, point.y, 10);
    }
  }

  private selectPreviewBone(pointer: Phaser.Input.Pointer): void {
    if (!this.puppet || !this.state || pointer.button !== 0) return;
    let nearest: string | undefined;
    let distance = 12;
    for (const bone of this.puppet.rig.bones) {
      const point = this.puppet.getBone(bone.id).getWorldPosition();
      const next = Math.hypot(point.x - pointer.worldX, point.y - pointer.worldY);
      if (next < distance) {
        distance = next;
        nearest = bone.id;
      }
    }
    if (nearest) this.state.selectBone(nearest);
  }

  setFacing(facing: Facing): void {
    this.facing = facing;
    this.puppet?.setFacing(facing);
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

  /** Pin current end joints in canonical puppet space; mirroring only changes their world projection. */
  setIKPreview(enabled: boolean): void {
    this.ikPreviewEnabled = enabled;
    const puppet = this.puppet;
    if (!puppet) return;
    puppet.preparePose();
    for (const chain of this.options.ikChains ?? []) {
      const constraint = puppet.getIK(chain.name);
      if (enabled) {
        const point = puppet.getBone(chain.endBone).getWorldPosition();
        const local = puppet.container.getWorldTransformMatrix().applyInverse(point.x, point.y);
        constraint.setTargetProvider(() => puppet.container.getWorldTransformMatrix().transformPoint(local.x, local.y));
      }
      constraint.enabled = enabled;
    }
    puppet.syncPose();
  }

  private async loadCharacter(session: number): Promise<void> {
    let puppet: Puppet | undefined;
    let preview: AnimationEditorPreview | undefined;
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
        ik: (this.options.ikChains ?? []).map((chain) => ({ ...chain, enabled: false })),
      });
      preview = new AnimationEditorPreview(state, puppet);
      this.puppet = puppet;
      this.preview = preview;
      this.state = state;
      if (this.ikPreviewEnabled) this.setIKPreview(true);
      this.selectionOverlay = this.add.graphics();
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input.on('pointerdown', this.selectPreviewBone, this);
      this.onReady(state, definition.id);
    } catch (error) {
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
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
