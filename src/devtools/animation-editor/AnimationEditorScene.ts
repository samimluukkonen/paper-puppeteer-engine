import Phaser from 'phaser';
import { getFootContactWorldPosition, Rig } from '../../engine/core.js';
import type {
  AnimationPose,
  CharacterDefinition,
  RigJsonDefinition,
  TwoBoneIKConstraint,
  IKTargetProvider,
  TwoBoneIKDefinition,
  Facing,
} from '../../engine/data.js';
import { Puppet } from '../../engine/runtime.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import type { ProjectCharacterDocument } from '../project/ProjectCharacterDocument.js';
import { RigEditor } from '../rig-editor/RigEditor.js';
import type { RigEditorState } from '../rig-editor/RigEditorState.js';
import type { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { artworkIssue } from '../shared/artwork/artworkIssue.js';
import { assetFilename } from '../shared/assetFilename.js';
import { contactGroundDistance } from '../shared/footContactGround.js';
import { GroundGuideOverlay } from '../shared/GroundGuideOverlay.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { ikPreviewTarget } from '../shared/ikPreviewTarget.js';
import { MeshDiagnosticsOverlay } from '../shared/MeshDiagnosticsOverlay.js';
import type { PackageSnapshot } from '../shared/package/characterPackage.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';
import { AnimationEditorGhostLayer, AnimationPoseOverlay } from './AnimationEditorGhostLayer.js';
import { AnimationEditorGroundHandle } from './AnimationEditorGroundHandle.js';
import { AnimationEditorIKHandles } from './AnimationEditorIKHandles.js';
import { AnimationEditorPreview } from './AnimationEditorPreview.js';
import { AnimationEditorRootHandle } from './AnimationEditorRootHandle.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { createCharacterDocuments } from './characterDocuments.js';
import { EnvironmentPreviewCamera } from './EnvironmentPreviewCamera.js';
import type { EnvironmentPreviewController } from './EnvironmentPreviewController.js';
import { EnvironmentPreviewLayer } from './EnvironmentPreviewLayer.js';
import { FootContactGroundController } from './FootContactGroundController.js';
import { alignIKTargetToGuide } from './ikTargetCoordinates.js';
import { MotionPreviewController } from './MotionPreviewController.js';
import { MotionPreviewLayer } from './MotionPreviewLayer.js';
import { DEFAULT_ONION_SKIN_SETTINGS, type OnionSkinSettings, updateOnionSkinSettings } from './onionSkinSettings.js';
import { getCompiledPreviewClip } from './previewClip.js';
import { toSeconds } from './timeUnits.js';

export interface AnimationEditorSceneOptions {
  /** Resolved relative to the editor document, including when served under a base path. */
  readonly characterUrl?: string;
  readonly definition?: CharacterDefinition;
  readonly documents?: ProjectCharacterDocument;
  readonly ikChains?: readonly TwoBoneIKDefinition[];
  readonly groundGuide?: GroundGuideWorkspace;
  readonly footContacts?: FootContactGroundController;
  readonly environment?: EnvironmentPreviewController;
  readonly motionPreview?: MotionPreviewController;
}

export class AnimationEditorScene extends Phaser.Scene {
  readonly groundGuide: GroundGuideWorkspace;
  readonly footContacts: FootContactGroundController;
  readonly motionPreview: MotionPreviewController;
  private motionLayer: MotionPreviewLayer | undefined;
  private environmentLayer: EnvironmentPreviewLayer | undefined;
  private environmentCamera: EnvironmentPreviewCamera | undefined;
  private contactOverlay: AnimationPoseOverlay | undefined;
  private groundOverlay: GroundGuideOverlay | undefined;
  private groundHandle: AnimationEditorGroundHandle | undefined;
  rigEditor: RigEditor | undefined;
  private definition: CharacterDefinition | undefined;
  private appliedWorkingRig: RigEditorState['workingCopy'] | undefined;
  private releaseMode: (() => void) | undefined;
  private rigMode = false;
  rigSessionRevision = 0;
  readonly rigExportCheckpoint: {
    rig?: RigJsonDefinition;
    filename?: string;
    requestSequence?: number;
    committedSequence?: number;
  } = {};
  private loadedRigFilename: string | undefined;

  get hasPendingArtworkProposal(): boolean {
    return this.artwork?.hasPendingProposal ?? false;
  }

  packageSnapshot(): PackageSnapshot {
    const definition = this.definition;
    const editor = this.rigEditor;
    if (!definition || !editor) throw new Error('No character is loaded.');
    return {
      definition,
      rig: editor.state.recoveryDraft,
      skins: editor.state.standaloneSkins,
      animations: this.state?.packageAnimations() ?? definition.animations,
      poses: this.state?.poseLibrary.packagePoses() ?? definition.poses,
      replacements: this.artwork?.appliedReplacements() ?? [],
      pendingArtwork: this.hasPendingArtworkProposal,
    };
  }

  get characterId(): string {
    return this.definition?.id ?? 'unknown';
  }
  get rigFilename(): string {
    return this.loadedRigFilename ?? assetFilename(this.definition?.rigPath, 'rig.json');
  }

  /** Rig-tweak imports retain topology, artwork identities and all animation sessions/history. */
  reloadRig(file: RigJsonDefinition, filename?: string, reason?: 'import' | 'reload-export'): void {
    const editor = this.rigEditor;
    if (!editor) throw new Error('No rig is loaded.');
    editor.state.assertCanRestoreDraft(file);
    editor.cancelGesture();
    this.artwork?.cancel();
    ++this.rigSessionRevision;
    editor.state.restoreDraft(file);
    editor.refresh();
    if (filename) this.loadedRigFilename = filename;
    if (reason === 'reload-export' || this.state?.editorMode === 'rig') editor.state.markSaved();
    this.onRigChange();
  }

  reloadOriginal(): void {
    this.artwork?.cancel();
    ++this.rigSessionRevision;
    this.loadedRigFilename = undefined;
    this.rigEditor?.cancelGesture();
    this.rigEditor?.resetRig();
    this.rigEditor?.state.markSaved();
    this.onRigChange();
  }
  private puppet: Puppet | undefined;
  private rootHandle: AnimationEditorRootHandle | undefined;
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
  private meshDiagnostics: MeshDiagnosticsOverlay | undefined;
  private selectionOverlay: Phaser.GameObjects.Graphics | undefined;
  private rebuildingRig = false;
  private facing: Facing = 'right';
  private bonesVisible = true;
  private ikPreviewEnabled = false;
  private readonly previewTargetProviders = new Map<string, IKTargetProvider>();
  private readonly options: AnimationEditorSceneOptions;
  private releasePreview: (() => void) | undefined;

  /** Release consumers before Phaser's shutdown destroys display-list objects. */
  disposePreview(): void {
    const release = this.releasePreview;
    this.releasePreview = undefined;
    release?.();
  }

  constructor(
    private readonly onReady: (state: AnimationEditorState, characterId: string) => void,
    private readonly onError: (message: string) => void,
    options: AnimationEditorSceneOptions = {},
    private readonly artwork?: ArtworkController,
    private readonly onRigChange: () => void = () => {},
  ) {
    super('AnimationEditorScene');
    this.groundGuide = options.groundGuide ?? new GroundGuideWorkspace('animation-preview-world');
    this.footContacts = options.footContacts ?? new FootContactGroundController();
    this.motionPreview = options.motionPreview ?? new MotionPreviewController();
    this.options = { ...options, ...(options.ikChains ? { ikChains: structuredClone(options.ikChains) } : {}) };
  }

  create(): void {
    const session = ++this.loadSession;
    this.releasePreview = () => {
      ++this.loadSession;
      this.environmentCamera?.dispose();
      this.environmentCamera = undefined;
      this.environmentLayer?.dispose();
      this.environmentLayer = undefined;
      this.motionLayer?.dispose();
      this.motionLayer = undefined;
      this.releaseMode?.();
      this.releaseMode = undefined;
      this.rigEditor?.disable();
      this.rigEditor = undefined;
      this.appliedWorkingRig = undefined;
      this.definition = undefined;
      this.loadedRigFilename = undefined;
      delete this.rigExportCheckpoint.rig;
      delete this.rigExportCheckpoint.filename;
      delete this.rigExportCheckpoint.requestSequence;
      delete this.rigExportCheckpoint.committedSequence;
      this.rigMode = false;
      this.previewTargetProviders.clear();
      this.footContacts.unbind();
      this.contactOverlay?.destroy();
      this.contactOverlay = undefined;
      this.state?.pause();
      this.state?.endScrub();
      this.rootHandle?.dispose();
      this.rootHandle = undefined;
      this.ikHandles?.dispose();
      this.ikHandles = undefined;
      this.groundHandle?.dispose();
      this.groundHandle = undefined;
      this.state = undefined;
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.meshDiagnostics?.destroy();
      this.meshDiagnostics = undefined;
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
      this.groundOverlay?.dispose();
      this.groundOverlay = undefined;
      this.groundGuide.bind(null);
      this.clearMirrorPreview();
      this.clearBakePreview();
      this.ghosts?.dispose();
      this.ghosts = undefined;
      this.preview?.dispose();
      this.preview = undefined;
      this.motionPreview.unbind();
      if (this.options.documents) this.artwork?.suspend();
      else this.artwork?.unbind();
      this.puppet?.destroy();
      this.puppet = undefined;
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disposePreview());
    if (this.options.environment) this.environmentLayer = new EnvironmentPreviewLayer(this, this.options.environment);
    void this.loadCharacter(session);
  }

  update(_time: number, delta: number): void {
    if (!this.state?.rootMotionEditing) this.environmentCamera?.render();
    const advance = (): void => this.state?.advancePlayback(toSeconds(delta));
    if (this.ghosts) this.ghosts.updateFrame(advance);
    else advance();
    this.motionLayer?.render();
    if (!this.rigMode && this.puppet && this.state?.meshDiagnosticsEnabled) {
      this.meshDiagnostics ??= new MeshDiagnosticsOverlay(this);
      const mesh = this.state.rig?.attachments.find(
        (entry) => entry.type === 'mesh' && entry.id === this.state?.selectedMeshId,
      );
      const message = this.meshDiagnostics.render(this.puppet, mesh?.type === 'mesh' ? mesh : undefined);
      const status = document.getElementById('animation-mesh-diagnostics-status');
      if (status && status.textContent !== message) status.textContent = message;
    } else this.meshDiagnostics?.clear();
    this.syncMirrorPreview();
    this.syncBakePreview();
    this.rootHandle?.render();
    this.ikHandles?.render();
    if (this.groundOverlay) {
      const guide = this.groundGuide.getSnapshot().guide;
      this.groundOverlay.render(guide);
    }
    const overlay = this.selectionOverlay;
    overlay?.clear();
    if (overlay && !this.rigMode && this.puppet && this.state?.selectedBoneId) {
      const point = this.puppet.getBone(this.state.selectedBoneId).getWorldPosition();
      overlay.lineStyle(3, 0xb7543a).strokeCircle(point.x, point.y, 10);
    }
    if (!this.rigMode && this.puppet) {
      if (this.footContacts.needsSync) this.footContacts.sync(this.puppet, this.getBakeRuntimeConstraints());
      const { plan, visible, contacts, tolerance, markerId } = this.footContacts;
      if (plan) {
        this.contactOverlay ??= new AnimationPoseOverlay(this, this.puppet, 'contact', 0);
        this.contactOverlay.apply(plan);
        this.contactOverlay.syncAppearance(
          this.puppet,
          { ...DEFAULT_ONION_SKIN_SETTINGS, nextOpacity: 0.6, nextTint: 0xa875e8 },
          this.puppet.getAppearanceRevision(),
        );
        this.contactOverlay.container.setVisible(this.puppet.container.visible);
      } else this.contactOverlay?.hide();
      if (visible && overlay) {
        const zoom = this.cameras.main.zoom;
        for (const contact of contacts) {
          const relation = contactGroundDistance(
            contact.world,
            this.groundGuide.getSnapshot().guide.y,
            tolerance,
          ).relation;
          const color =
            contact.id === markerId
              ? 0xe5b35c
              : relation === 'on ground'
                ? 0x85bf9b
                : relation === 'above ground'
                  ? 0x8fbde8
                  : 0xef8075;
          const { x, y } = contact.world;
          overlay.lineStyle(2 / zoom, color).strokeCircle(x, y, 6 / zoom);
          overlay.lineBetween(x - 9 / zoom, y, x + 9 / zoom, y).lineBetween(x, y - 9 / zoom, x, y + 9 / zoom);
        }
        if (plan) overlay.lineStyle(3 / zoom, 0xa875e8).strokeCircle(plan.contact.x, plan.contact.y, 8 / zoom);
        if (this.mirrorPose)
          for (const marker of this.state?.rig?.footContactMarkers ?? []) {
            const point = getFootContactWorldPosition(
              marker,
              this.state!.rig!,
              this.mirrorPose,
              this.puppet.container.getWorldTransformMatrix(),
            );
            if (point) overlay.lineStyle(2 / zoom, 0xa875e8).strokeCircle(point.x, point.y, 6 / zoom);
          }
      }
    } else this.contactOverlay?.hide();
  }

  private selectPreviewBone(pointer: Phaser.Input.Pointer): void {
    if (this.rigMode) return;
    if (this.ikHandles?.gestureActive) {
      this.ikHandles.pointerDown(pointer);
      return;
    }
    if (this.rootHandle?.pointerDown(pointer)) return;
    if (this.groundHandle?.pointerDown(pointer)) return;
    if (this.footContacts.visible && pointer.button === 0) {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const contact = this.footContacts.contacts.find(
        (entry) => Math.hypot(entry.world.x - world.x, entry.world.y - world.y) <= 10 / this.cameras.main.zoom,
      );
      if (contact) {
        this.footContacts.selectMarker(contact.id);
        return;
      }
    }
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
    else this.ikHandles?.startCharacterDrag(pointer);
  }

  setIKHandlesVisible(visible: boolean): void {
    this.ikHandlesVisible = visible;
    this.ikHandles?.setVisible(visible && !this.rigMode);
  }

  /** Explicit authoring command. Guide edits themselves never call this method. */
  alignSelectedIKTargetToGround(): boolean {
    const state = this.state;
    const puppet = this.puppet;
    const { guide, dragging } = this.groundGuide.getSnapshot();
    this.ikHandles?.refreshAvailability();
    if (
      !state ||
      !puppet ||
      this.rigMode ||
      dragging ||
      !guide.enabled ||
      !state.selectedIKTargetValues ||
      state.ikManipulationDisabledReason ||
      state.ikTargetDrag
    )
      return false;
    const target = alignIKTargetToGuide(
      state.selectedIKTargetValues,
      puppet.container.getWorldTransformMatrix(),
      guide.y,
    );
    return !!target && state.commitIKTarget(target);
  }

  private createIKHandles(state: AnimationEditorState, puppet: Puppet): AnimationEditorIKHandles {
    this.rootHandle = new AnimationEditorRootHandle(this, state, puppet, (pointer) =>
      this.ikHandles?.startCharacterDrag(pointer),
    );
    this.rootHandle.setInteractive(this.ikHandlesInteractive && !this.rigMode);
    return new AnimationEditorIKHandles(this, state, puppet, {
      guide: () => this.groundGuide.getSnapshot().guide,
      dragging: () => !!this.groundHandle?.dragging || state.rootMotionDragActive,
    });
  }
  private refreshArtwork(): void {
    const puppet = this.puppet;
    if (!puppet || this.rebuildingRig) return;
    this.rigEditor?.cancelGesture();
    this.rigEditor?.refresh(false);
    this.ghosts?.refreshArtwork();
    const revision = puppet.getAppearanceRevision();
    this.mirrorOverlay?.syncAppearance(
      puppet,
      { ...DEFAULT_ONION_SKIN_SETTINGS, nextOpacity: 0.35, nextTint: 0xa875e8 },
      revision,
    );
    this.bakeOverlay?.syncAppearance(
      puppet,
      { ...DEFAULT_ONION_SKIN_SETTINGS, nextOpacity: 0.55, nextTint: 0xa875e8 },
      revision,
    );
    this.onRigChange();
  }
  setIKHandlesInteractive(interactive: boolean): void {
    this.ikHandlesInteractive = interactive;
    this.rootHandle?.setInteractive(interactive && !this.rigMode);
    this.ikHandles?.setInteractive(interactive && !this.rigMode);
  }
  setFacing(facing: Facing): void {
    this.facing = facing;
    if (this.rigEditor) this.rigEditor.state.facing = facing;
    this.state?.cancelRootMotionDrag();
    this.puppet?.setFacing(facing);
    this.preview?.refresh(true);
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
    this.puppet?.setDebug(visible && !this.rigMode);
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
    puppet.posePipeline.preparePose();
    for (const chain of this.options.ikChains ?? []) {
      const constraint = puppet.getIK(chain.name);
      // The fixed-preview control may replace only its own callbacks. Specialized
      // providers and explicit runtime targets retain the runtime precedence model.
      if (
        constraint.target ||
        (constraint.targetProvider && constraint.targetProvider !== this.previewTargetProviders.get(chain.name))
      )
        continue;
      if (enabled) {
        const point = ikPreviewTarget(puppet, constraint);
        const local = puppet.container.getWorldTransformMatrix().applyInverse(point.x, point.y);
        const provider = () => this.puppet?.container.getWorldTransformMatrix().transformPoint(local.x, local.y);
        this.previewTargetProviders.set(chain.name, provider);
        constraint.setTargetProvider(provider);
      } else {
        constraint.setTargetProvider(undefined);
        this.previewTargetProviders.delete(chain.name);
      }
      const authored = puppet.rig.ik?.find((definition) => definition.name === chain.name);
      constraint.enabled = enabled || (authored ? (authored.enabled ?? true) : false);
    }
    puppet.posePipeline.syncPose();
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
      const definition = await (this.options.definition
        ? loadSceneCharacter(this, url.href, { definition: this.options.definition, allowWebp: true })
        : loadSceneCharacter(this, url.href, { allowWebp: true }));
      if (!definition || session !== this.loadSession || !this.sys.isActive()) return;
      const documents =
        this.options.documents ??
        createCharacterDocuments(definition, {
          artworkIssue: (key, frame) => artworkIssue(this.textures, key, frame),
          boneReferences: (id) =>
            (this.options.ikChains ?? [])
              .filter((chain) => [chain.rootBone, chain.middleBone, chain.endBone].includes(id))
              .map((chain) => `preview IK constraint "${chain.name}"`),
          ikReferences: (id) =>
            (this.options.ikChains ?? [])
              .filter((chain) => chain.name === id)
              .map((chain) => `preview IK constraint "${chain.name}" (target/provider ownership)`),
        });
      documents.rig.setArtworkValidator((key, frame) => artworkIssue(this.textures, key, frame));
      const state = documents.animation;
      if (!this.options.documents) state.selectAnimation(state.animationIds[0] ?? null);
      this.artwork?.prepareTextures(this);
      let renderRig = definition.rig;
      if (this.options.documents) {
        try {
          renderRig = new Rig(documents.rig.workingCopy, documents.rig.skins);
        } catch {
          // Invalid focused field drafts retain the last valid preview and remain editable.
          renderRig = state.rig ?? definition.rig;
        }
        state.updatePreviewRig(renderRig);
      }
      puppet = new Puppet(this, {
        rig: renderRig,
        skin: documents.rig.activeSkin,
        x: CHARACTER_PREVIEW_ORIGIN.x,
        y: CHARACTER_PREVIEW_ORIGIN.y,
        autoUpdate: false,
        facing: this.facing,
        debug: this.bonesVisible,
        ik: [
          ...(renderRig.ik ?? []),
          ...(this.options.ikChains ?? [])
            .filter((chain) => !renderRig.ik?.some((authored) => authored.name === chain.name))
            .map((chain) => ({ ...chain, enabled: false })),
        ],
      });
      this.motionPreview.bind(state);
      preview = new AnimationEditorPreview(state, puppet, this.motionPreview);
      this.motionLayer = new MotionPreviewLayer(this, state, this.motionPreview);
      ghosts = new AnimationEditorGhostLayer(this, state, puppet);
      ghosts.setSettings(this.onionSkinSettings);
      this.ghosts = ghosts;
      this.puppet = puppet;
      this.preview = preview;
      this.state = state;
      this.definition = definition;
      const rigState = documents.rig;
      const syncRigPlacement = () => {
        if (!state.animationAuthoringEnabled && !this.rebuildingRig)
          state.setPreviewPlacementOffset(
            puppet!.container.x - CHARACTER_PREVIEW_ORIGIN.x,
            puppet!.container.y - CHARACTER_PREVIEW_ORIGIN.y,
          );
      };
      this.rigEditor = new RigEditor(
        this,
        puppet,
        () => {
          syncRigPlacement();
          this.onRigChange();
        },
        rigState,
        [
          ...(definition.rig.ik ?? []),
          ...(this.options.ikChains ?? []).filter(
            (chain) => !definition.rig.ik?.some((authored) => authored.name === chain.name),
          ),
        ],
        definition.compiledAnimations,
        () => {
          if (this.appliedWorkingRig !== rigState.workingCopy) {
            // Temporarily invalid inspector drafts retain the last valid preview and existing validation feedback.
            let nextRig: Rig | undefined;
            try {
              const authored = new Rig(rigState.workingCopy);
              nextRig = new Rig(authored, rigState.skins);
            } catch {
              // Export/validation still reports the invalid authored rig through RigEditorState.
            }
            if (nextRig) {
              this.appliedWorkingRig = rigState.workingCopy;
              state.updatePreviewRig(nextRig);
            }
          }
          syncRigPlacement();
          if (state.editorMode !== 'rig') preview?.refresh(true);
        },
        () => state.packageAnimations().map((clip) => getCompiledPreviewClip(clip, state.rig!)),
        (next) => {
          // Keep documents, histories and camera; replace only consumers of the old runtime skeleton.
          this.rebuildingRig = true;
          try {
            this.artwork?.bind(this, next, definition, () => this.refreshArtwork());
            this.groundGuide.cancelDrag();
            this.rootHandle?.dispose();
            this.rootHandle = undefined;
            this.ikHandles?.dispose();
            this.clearMirrorPreview();
            this.clearBakePreview();
            this.contactOverlay?.destroy();
            this.contactOverlay = undefined;
            this.footContacts.cancel();
            ghosts?.dispose();
            preview?.dispose();
            puppet = next;
            this.puppet = next;
            state.updatePreviewRig(new Rig(rigState.workingCopy, rigState.skins));
            this.appliedWorkingRig = rigState.workingCopy;
            preview = new AnimationEditorPreview(state, next, this.motionPreview);
            ghosts = new AnimationEditorGhostLayer(this, state, next);
            ghosts.setSettings(this.onionSkinSettings);
            this.preview = preview;
            this.ghosts = ghosts;
            next.setDebug(this.bonesVisible && !this.rigMode);
            this.ikHandles = this.createIKHandles(state, next);
            this.ikHandles.setVisible(this.ikHandlesVisible && !this.rigMode);
            this.ikHandles.setInteractive(this.ikHandlesInteractive && !this.rigMode);
            if (state.editorMode === 'rig') {
              for (const chain of [...(next.rig.ik ?? []), ...(this.options.ikChains ?? [])]) {
                const authored = next.rig.ik?.find((entry) => entry.name === chain.name) ?? chain;
                next.getIK(chain.name).enabled = rigState.ikPreview && authored.enabled !== false;
              }
            } else this.setIKPreview(this.ikPreviewEnabled);
          } finally {
            this.rebuildingRig = false;
          }
        },
        (pointer) => this.groundHandle?.pointerDown(pointer) ?? false,
      );
      let previousMode: typeof state.editorMode | undefined = this.options.documents ? undefined : state.editorMode;
      const syncMode = () => {
        if (state.editorMode === previousMode) return;
        const leavingBindPose = previousMode === 'rig';
        previousMode = state.editorMode;
        const tweaking = !state.animationAuthoringEnabled;

        this.rigMode = tweaking;
        this.environmentLayer?.setActive(!tweaking);
        this.clearMirrorPreview();
        this.clearBakePreview();
        this.ikHandles?.setVisible(this.ikHandlesVisible && !tweaking);
        this.ikHandles?.setInteractive(this.ikHandlesInteractive && !tweaking);
        this.puppet?.setDebug(this.bonesVisible && !tweaking);
        this.rigEditor?.cancelGesture();
        if (state.editorMode === 'rig') {
          for (const chain of [...(rigState.workingCopy.ik ?? []), ...(this.options.ikChains ?? [])])
            puppet!.getIK(chain.name).enabled =
              rigState.ikPreview &&
              (rigState.workingCopy.ik?.find((entry) => entry.name === chain.name) ?? chain).enabled !== false;
        } else if (leavingBindPose) this.setIKPreview(this.ikPreviewEnabled);
        this.rigEditor?.setPreviewPose('');
        if (tweaking) {
          if (state.selectedBoneId) rigState.selectBone(state.selectedBoneId);
          this.rigEditor?.enable();
        } else {
          this.rigEditor?.disable();
          if (rigState.selection?.type === 'bone') state.selectBone(rigState.selection.id);
          rigState.endOperation();
          this.rigEditor?.refresh(false);
          preview?.refresh(true);
        }
      };
      this.releaseMode = state.subscribe(syncMode);
      this.artwork?.bind(this, puppet, definition, () => this.refreshArtwork());
      syncMode();
      if (this.ikPreviewEnabled) this.setIKPreview(true);
      this.ikHandles = this.createIKHandles(state, puppet);
      this.ikHandles.setVisible(this.ikHandlesVisible);
      this.ikHandles.setInteractive(this.ikHandlesInteractive);
      this.selectionOverlay = this.add.graphics().setDepth(puppet.container.depth + 5);
      this.groundGuide.bind(url.href);
      this.footContacts.bind(state, this.groundGuide);
      this.footContacts.sync(puppet, this.getBakeRuntimeConstraints());
      this.groundOverlay = new GroundGuideOverlay(this, { draggable: true });
      this.groundHandle = new AnimationEditorGroundHandle(this, this.groundGuide, state);
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input.on('pointerdown', this.selectPreviewBone, this);
      this.environmentLayer?.setActive(true);
      this.onReady(state, definition.id);
      // onReady fits the ordinary viewport before the optional environment borrows its camera.
      if (session === this.loadSession && this.sys.isActive() && this.options.environment)
        this.environmentCamera = new EnvironmentPreviewCamera(
          this.cameras.main,
          state,
          this.options.environment,
          this.motionPreview,
          () => this.puppet!.container.getWorldTransformMatrix(),
        );
    } catch (error) {
      this.environmentCamera?.dispose();
      this.environmentCamera = undefined;
      this.environmentLayer?.setActive(false);
      this.motionLayer?.dispose();
      this.motionLayer = undefined;
      this.footContacts.unbind();
      this.contactOverlay?.destroy();
      this.contactOverlay = undefined;
      this.previewTargetProviders.clear();
      this.releaseMode?.();
      this.releaseMode = undefined;
      this.rigEditor?.disable();
      this.rigEditor = undefined;
      this.definition = undefined;
      this.appliedWorkingRig = undefined;
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      this.input?.off('pointerdown', this.selectPreviewBone, this);
      this.meshDiagnostics?.destroy();
      this.meshDiagnostics = undefined;
      this.selectionOverlay?.destroy();
      this.selectionOverlay = undefined;
      this.groundOverlay?.dispose();
      this.groundOverlay = undefined;
      this.groundHandle?.dispose();
      this.groundHandle = undefined;
      this.groundGuide.bind(null);
      this.clearMirrorPreview();
      this.clearBakePreview();
      this.rootHandle?.dispose();
      this.rootHandle = undefined;
      this.ikHandles?.dispose();
      this.ikHandles = undefined;
      ghosts?.dispose();
      this.ghosts = undefined;
      preview?.dispose();
      this.motionPreview.unbind();
      if (this.options.documents) this.artwork?.suspend();
      else this.artwork?.unbind();
      puppet?.destroy();
      this.preview = undefined;
      this.puppet = undefined;
      this.state?.pause();
      this.state = undefined;
      if (session === this.loadSession && this.sys.isActive()) this.onError(String(error));
    }
  }
}
