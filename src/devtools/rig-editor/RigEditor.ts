import Phaser from 'phaser';
import { localToWorld } from '../../engine/affineMath.js';
import type { CompiledClip } from '../../engine/AnimationClip.js';
import { evaluateClip } from '../../engine/AnimationPose.js';
import type { RigJsonDefinition } from '../../engine/externalData.js';
import type { CreateIKConstraintOptions, IKConstraintPatch } from '../../engine/ik/ikAuthoring.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { IKTarget, TwoBoneIKDefinition } from '../../engine/ik/types.js';
import { Puppet } from '../../engine/Puppet.js';
import { computeBonePosition, computeRenderOrder, Rig } from '../../engine/Rig.js';
import { createTransform, type RigDefinition } from '../../engine/types.js';
import { sameRigTopology } from '../shared/boneHierarchy.js';
import { equalEditorData } from '../shared/editorData.js';
import { ikPreviewTarget } from '../shared/ikPreviewTarget.js';
import { RigEditorInputController } from './RigEditorInputController.js';
import { RigEditorOverlay } from './RigEditorOverlay.js';
import { type BoneField, RigEditorState, type SlotField, type SpriteField } from './RigEditorState.js';

export class RigEditor {
  readonly state: RigEditorState;
  private overlay: RigEditorOverlay | undefined;
  private readonly registeredIK = new Map<string, TwoBoneIKConstraint>();
  private appliedRig: RigDefinition | undefined;
  private renderOrder: readonly string[] = [];
  private inputController: RigEditorInputController | undefined;
  private readonly hostIKChains: readonly TwoBoneIKDefinition[];
  private get ikChains(): readonly TwoBoneIKDefinition[] {
    const authored = this.state.workingCopy.ik ?? [];
    return [...authored, ...this.hostIKChains.filter((chain) => !authored.some((entry) => entry.name === chain.name))];
  }
  private artworkDraft: { id: string; attachment: boolean; values: Partial<Record<SpriteField, number>> } | undefined;
  private previewClip: CompiledClip | undefined;
  private appliedCatalog: RigDefinition | undefined;
  private appliedSkins: readonly import('../../engine/types.js').SkinDefinition[] | undefined;
  previewTime = 0;
  actionError = '';
  private resumeAfterRebuild = false;
  private dragTargetOverride:
    | {
        constraint: TwoBoneIKConstraint;
        previous: Readonly<IKTarget> | undefined;
        current: Readonly<IKTarget> | undefined;
      }
    | undefined;
  private readonly previewTargets = new Map<string, Readonly<IKTarget>>();

  private ownsPreviewTarget(id: string): boolean {
    const constraint = this.puppet.getIK(id);
    const target = this.previewTargets.get(id);
    return (
      (!!target && constraint.target === target) ||
      (this.dragTargetOverride?.constraint === constraint && constraint.target === this.dragTargetOverride.current)
    );
  }

  private hasExternalTarget(constraint: TwoBoneIKConstraint): boolean {
    return (
      constraint.targetOwnership === 'provider' ||
      (constraint.targetOwnership === 'runtime' && !this.ownsPreviewTarget(constraint.name))
    );
  }

  private pinPreviewTarget(constraint: TwoBoneIKConstraint): void {
    // Hosts retain explicit runtime/provider ownership.
    if (constraint.targetOwnership !== 'animation' && !this.ownsPreviewTarget(constraint.name)) return;
    constraint.setTarget(ikPreviewTarget(this.puppet, constraint));
    this.previewTargets.set(constraint.name, constraint.target!);
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private puppet: Puppet,
    private readonly onChange: () => void,
    state?: RigEditorState,
    ikChains: readonly TwoBoneIKDefinition[] = [],
    private readonly initialPreviewClips: readonly CompiledClip[] = [],
    /** Embedded editors supply the evaluated animation/IK pose after rig projection. */
    private readonly evaluateContext?: () => void,
    private readonly currentPreviewClips?: () => readonly CompiledClip[],
    /** Rebind shared preview consumers after editor-owned topology reconstruction. */
    private readonly onRebuild?: (puppet: Puppet) => void,
    /** Shared host overlays may claim a pointer before rig gizmos begin a gesture. */
    private readonly claimPointer?: (pointer: Phaser.Input.Pointer) => boolean,
  ) {
    this.state =
      state ??
      new RigEditorState(puppet.rig, undefined, {
        ikReferences: (id) => [
          ...this.previewClips.flatMap((clip) => [
            ...(clip.ikTracks?.some((track) => track.constraint === id) ? [`animation "${clip.name}" IK track`] : []),
            ...(clip.disabledIKConstraints?.includes(id) ? [`animation "${clip.name}" baked IK metadata`] : []),
          ]),
          ...this.hostIKChains
            .filter((chain) => chain.name === id)
            .map((chain) => `preview IK constraint "${chain.name}"`),
        ],
      });
    // Authored definitions own same-name preview chains, including their endpoint offsets.
    this.hostIKChains = ikChains.filter((chain) => !puppet.rig.ik?.some((authored) => authored.name === chain.name));
  }

  get previewClips(): readonly CompiledClip[] {
    return this.currentPreviewClips?.() ?? this.initialPreviewClips;
  }

  enable(): void {
    if (this.overlay) return;
    if (!this.evaluateContext) {
      const external = this.ikChains.flatMap((chain) => {
        // Host-only chains may not be registered until this first activation.
        let constraint: TwoBoneIKConstraint;
        try {
          constraint = this.puppet.getIK(chain.name);
        } catch {
          return [];
        }
        return this.hasExternalTarget(constraint) ? [{ constraint, enabled: constraint.enabled }] : [];
      });
      this.puppet.resetToBindPose().setFacing(this.state.facing);
      for (const entry of external) entry.constraint.enabled = entry.enabled;
    }
    this.appliedRig = undefined;
    for (const chain of this.evaluateContext ? [] : this.ikChains) {
      let constraint = this.registeredIK.get(chain.name);
      if (!constraint) {
        constraint = this.puppet.rig.ik?.some((authored) => authored.name === chain.name)
          ? this.puppet.getIK(chain.name)
          : this.puppet.addIK({ ...chain, enabled: false });
        this.registeredIK.set(chain.name, constraint);
      }
      if (!this.hasExternalTarget(constraint)) constraint.enabled = false;
    }
    this.overlay = new RigEditorOverlay(this.scene, this.puppet, this.state, this.ikChains, (id) =>
      this.ownsPreviewTarget(id),
    );
    this.inputController = new RigEditorInputController(
      this.scene,
      this.puppet,
      this,
      this.overlay,
      this.onChange,
      () => this.update(),
      this.claimPointer,
    );
    this.inputController.enable();
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    // Activation must project retained edits before drawing or capturing IK targets.
    this.refresh(false);
    if (this.state.ikPreview && !this.evaluateContext) {
      for (const chain of this.ikChains) {
        const constraint = this.puppet.getIK(chain.name);
        if (this.hasExternalTarget(constraint)) continue;
        if (!chain.target && !constraint.target) this.pinPreviewTarget(constraint);
        constraint.enabled = chain.enabled !== false;
      }
      this.puppet.syncPose();
      this.overlay.invalidate();
      this.update();
    }
  }

  disable(): void {
    if (!this.overlay) return;
    this.inputController?.disable();
    this.inputController = undefined;
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.overlay.destroy();
    this.overlay = undefined;
  }

  refresh(notify = true): void {
    const rig = this.state.workingCopy;
    // A target gesture retains its puppet/input owner until its single commit or cancellation.
    if (!this.state.ikTargetDragId) {
      if (this.dragTargetOverride) {
        const { constraint, previous, current } = this.dragTargetOverride;
        if (constraint.targetOwnership === 'runtime' && constraint.target === current) {
          constraint.target = previous;
          if (previous && this.previewTargets.get(constraint.name) === previous)
            this.previewTargets.set(constraint.name, constraint.target!);
        }
      }
      this.dragTargetOverride = undefined;
      if (rig !== this.appliedRig || !equalEditorData(this.puppet.rig.ik, rig.ik)) this.syncTopology(rig);
    } else {
      const definition = this.state.getIKConstraint(this.state.ikTargetDragId);
      const constraint = this.puppet.getIK(definition.name);
      if (
        definition.target &&
        constraint.targetOwnership !== 'provider' &&
        (constraint.targetOwnership === 'animation' || this.ownsPreviewTarget(definition.name))
      ) {
        this.dragTargetOverride ??= { constraint, previous: constraint.target, current: constraint.target };
        constraint.setTarget(localToWorld(definition.target, this.puppet.container.getWorldTransformMatrix()));
        this.dragTargetOverride.current = constraint.target;
      }
    }
    if (this.resumeAfterRebuild) {
      this.resumeAfterRebuild = false;
      this.enable();
    }
    this.syncAttachments();
    if (rig !== this.appliedRig) {
      if (
        !this.appliedRig ||
        !equalEditorData(rig.bones, this.appliedRig.bones) ||
        !equalEditorData(rig.slots, this.appliedRig.slots) ||
        !equalEditorData(rig.ik, this.appliedRig.ik)
      )
        this.applyRig(rig);
      this.appliedRig = rig;
    }
    this.evaluateContext?.();
    this.applyArtworkGeometry();
    this.updateArtwork();
    this.overlay?.invalidate();
    this.update();
    if (notify) this.onChange();
  }

  private syncTopology(rig: RigDefinition): void {
    const before = this.puppet.rig;
    if (sameRigTopology(before, rig) && equalEditorData(before.ik, rig.ik)) return;
    const previous = this.puppet;
    const container = previous.container;
    const next = new Puppet(this.scene, {
      rig: new Rig(rig, this.state.skins),
      ...(this.state.defaultSkin ? { skin: this.state.defaultSkin } : {}),
      x: container.x,
      y: container.y,
      autoUpdate: false,
      facing: this.state.facing,
      ik: this.ikChains.map((chain) => ({
        ...chain,
        enabled: this.evaluateContext ? (chain.enabled ?? true) : this.state.ikPreview && chain.enabled !== false,
      })),
    });
    next.container
      .setScale(container.scaleX, container.scaleY)
      .setRotation(container.rotation)
      .setDepth(container.depth)
      .setAlpha(container.alpha)
      .setVisible(container.visible);
    container.parentContainer?.add(next.container);
    // Replacing renderer consumers must retain host target/influence ownership.
    // Editor-pinned endpoints belong to the old preview and are recomputed instead.
    for (const chain of this.ikChains) {
      if (
        !(before.ik ?? []).some((entry) => entry.name === chain.name) &&
        !this.hostIKChains.some((entry) => entry.name === chain.name)
      )
        continue;
      const source = previous.getIK(chain.name);
      const destination = next.getIK(chain.name);
      if (this.hasExternalTarget(source)) {
        if (source.target) destination.setTarget(source.target);
        destination.setTargetProvider(source.targetProvider);
        destination.enabled = source.enabled;
      }
      if (source.hasMixOverride) destination.mix = source.mix;
    }
    const enabled = !!this.overlay;
    this.disable();
    this.puppet = next;
    this.appliedRig = undefined;
    this.appliedCatalog = undefined;
    this.appliedSkins = undefined;
    this.registeredIK.clear();
    this.previewTargets.clear();
    try {
      this.onRebuild?.(next);
    } catch (error) {
      this.puppet = previous;
      next.destroy();
      // The old overlay cannot draw a newly authored skeleton. Retry activation only
      // after a successful rebuild or an undo back to the retained preview topology.
      this.resumeAfterRebuild ||= enabled;
      throw error;
    }
    previous.destroy();
    if (enabled) this.enable();
  }

  /** Appearance selection never seeks the player or restores bone transforms. */
  selectSkin(name: string): void {
    this.cancelGesture();
    this.state.selectSkin(name);
    this.syncAttachments();
    this.applyArtworkGeometry();
    this.updateArtwork();
    this.overlay?.invalidate();
    this.update();
    this.onChange();
  }

  private syncAttachments(): void {
    // Older hosts with no skin/catalog authoring retain their runtime-only assignments.
    if (!this.state.skins.length) return;
    const rig = this.state.workingCopy;
    const skins = this.state.skins;
    if (rig !== this.appliedCatalog || !equalEditorData(skins, this.appliedSkins)) {
      const available = new Set((rig.attachments ?? []).map((entry) => entry.id));
      for (const slot of rig.slots ?? []) {
        const id = this.puppet.getAttachment(slot.id);
        if (id && !available.has(id)) this.puppet.clearAttachment(slot.id);
      }
      this.puppet.updateSlotDefinitions(rig.attachments ?? [], skins);
      this.appliedCatalog = rig;
      this.appliedSkins = skins;
    }
    for (const slot of rig.slots ?? []) {
      const id = this.state.resolvedAttachment(slot.id);
      if (id) this.puppet.setAttachment(slot.id, id);
      else this.puppet.clearAttachment(slot.id);
    }
  }

  private applyRig(rig: RigDefinition): void {
    this.puppet.preparePose();
    // Preview the same logical joint positions that an exported rig loads with.
    const definitions = new Map(rig.bones.map((bone) => [bone.id, bone]));
    for (const edited of rig.bones) {
      const runtime = this.puppet.getBone(edited.id);
      Object.assign(runtime.pose, {
        ...createTransform(edited),
        ...computeBonePosition(edited, edited.parent === undefined ? undefined : definitions.get(edited.parent)),
      });
      if (runtime.sprite && edited.sprite) {
        runtime.sprite.setPosition(edited.sprite.x ?? 0, edited.sprite.y ?? 0);
        this.puppet.setArtworkOrigin(
          `bone:${edited.id}`,
          edited.sprite.texture,
          runtime.sprite,
          edited.sprite.originX ?? 0.5,
          edited.sprite.originY ?? 0.5,
        );
      }
    }
    if (this.previewClip) {
      const pose = evaluateClip(this.previewClip, this.previewTime);
      for (const [id, transform] of pose) {
        if (definitions.has(id)) Object.assign(this.puppet.getBone(id).pose, transform);
      }
    }
    for (const slot of rig.slots ?? []) {
      this.puppet.setSlotTransform(slot.id, createTransform(slot), false);
      const image = this.puppet.getSlotImage(slot.id);
      const attachmentId = this.puppet.getAttachment(slot.id);
      if (image && attachmentId) {
        const attachment = this.state.getAttachment(attachmentId);
        image.setPosition(attachment.x ?? 0, attachment.y ?? 0);
        this.puppet.setArtworkOrigin(
          `attachment:${attachment.id}`,
          attachment.texture,
          image,
          attachment.originX ?? 0.5,
          attachment.originY ?? 0.5,
        );
      }
    }
    this.updateRenderOrder(rig);
    this.puppet.syncPose();
  }

  private updateRenderOrder(rig: RigDefinition): void {
    const previous = this.appliedRig;
    // A rebuilt preview invalidates the cached order; geometry-only edits retain it.
    const boneDepthChanged =
      !previous ||
      rig.bones.some((bone, index) => {
        const before = previous.bones[index]!;
        return bone.depth !== before.depth || bone.sprite?.depth !== before.sprite?.depth;
      });
    const slotDepthChanged =
      !previous || (rig.slots ?? []).some((slot, index) => slot.depth !== previous.slots?.[index]?.depth);
    if (boneDepthChanged) this.renderOrder = computeRenderOrder(rig.root, rig.bones);
    if (boneDepthChanged || slotDepthChanged)
      this.puppet.setRenderOrder(this.renderOrder, new Map((rig.slots ?? []).map((slot) => [slot.id, slot.depth])));
  }

  private updateArtwork(): void {
    const { state } = this;
    const alpha = (type: 'bone' | 'slot', id: string): number => {
      const selected = state.selection?.type === type && state.selection.id === id;
      return state.visibility.artwork ? state.artworkOpacity * (state.dimUnselected && !selected ? 0.18 : 1) : 0;
    };
    for (const bone of state.rig.bones) this.puppet.getBone(bone.id).sprite?.setAlpha(alpha('bone', bone.id));
    for (const slot of state.rig.slots) this.puppet.getSlotImage(slot.id)?.setAlpha(alpha('slot', slot.id));
  }

  getAttachment(id: string): string | undefined {
    return this.puppet.getAttachment(id);
  }

  getSelectedImage(): Phaser.GameObjects.Image | undefined {
    const selected = this.state.selection;
    return selected?.type === 'bone'
      ? this.puppet.getBone(selected.id).sprite
      : selected
        ? this.puppet.getSlotImage(selected.id)
        : undefined;
  }

  getArtworkOriginScale(): { x: number; y: number } {
    const selection = this.state.selection;
    const id = selection?.type === 'slot' ? this.getAttachment(selection.id) : selection?.id;
    const sprite = id
      ? selection?.type === 'slot'
        ? this.state.getAttachment(id)
        : this.state.getBone(id).sprite
      : undefined;
    const override =
      sprite && id
        ? this.puppet.getArtworkReplacement(
            sprite.texture,
            selection?.type === 'slot' ? `attachment:${id}` : `bone:${id}`,
          )
        : undefined;
    return { x: override?.originScaleX ?? 1, y: override?.originScaleY ?? 1 };
  }

  getJointReference(): { x: number; y: number } | undefined {
    const selected = this.state.selection;
    if (!selected) return undefined;
    const id = selected.type === 'bone' ? selected.id : this.state.getSlot(selected.id).bone;
    const matrix = this.puppet.getBone(id).container.getWorldTransformMatrix();
    return { x: matrix.tx, y: matrix.ty };
  }

  private applyArtworkGeometry(): void {
    const apply = (image: Phaser.GameObjects.Image | undefined, id: string, attachment: boolean): void => {
      const authored = attachment ? this.state.getAttachment(id) : this.state.getBone(id).sprite;
      if (!image || !authored) return;
      const draft = this.artworkDraft;
      const sprite = draft?.id === id && draft.attachment === attachment ? { ...authored, ...draft.values } : authored;
      image.setPosition(sprite.x ?? 0, sprite.y ?? 0);
      this.puppet.setArtworkOrigin(
        attachment ? `attachment:${id}` : `bone:${id}`,
        sprite.texture,
        image,
        sprite.originX ?? 0.5,
        sprite.originY ?? 0.5,
      );
    };
    for (const bone of this.state.rig.bones) apply(this.puppet.getBone(bone.id).sprite, bone.id, false);
    for (const slot of this.state.rig.slots) {
      const id = this.getAttachment(slot.id);
      if (id) apply(this.puppet.getSlotImage(slot.id), id, true);
    }
  }

  /** Render-only drag proposal; authored rig, serialization and history remain unchanged. */
  previewArtwork(id: string, values: Partial<Record<SpriteField, number>>, attachment = false): void {
    for (const [field, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
      if ((field === 'originX' || field === 'originY') && (value < 0 || value > 1))
        throw new Error('Origin must be between 0 and 1.');
    }
    this.artworkDraft = { id, values, attachment };
    this.refresh();
  }

  finishArtworkGesture(commit: boolean): void {
    const draft = this.artworkDraft;
    this.artworkDraft = undefined;
    try {
      if (commit && draft) {
        const sprite = draft.attachment ? this.state.getAttachment(draft.id) : this.state.getBone(draft.id).sprite!;
        const changed = Object.fromEntries(
          Object.entries(draft.values).filter(
            ([field, value]) => value !== (sprite[field as SpriteField] ?? (field.startsWith('origin') ? 0.5 : 0)),
          ),
        );
        if (Object.keys(changed).length) this.state.editSpriteFields(draft.id, changed, draft.attachment);
      }
    } finally {
      if (draft) this.refresh(false);
    }
  }

  cancelGesture(): void {
    this.inputController?.endGesture(false);
  }

  setFacing(facing: 'left' | 'right'): void {
    this.cancelGesture();
    this.state.facing = facing;
    this.puppet.setFacing(facing);
    this.refresh();
  }

  setPreviewPose(name: string, time = 0): void {
    if (!Number.isFinite(time)) throw new Error('Preview time must be finite.');
    const clip = this.previewClips.find((entry) => entry.name === name);
    if (name && !clip) throw new Error(`Unknown preview animation "${name}".`);
    this.cancelGesture();
    this.previewClip = clip;
    this.previewTime = this.previewClip ? Math.max(0, Math.min(this.previewClip.duration, time)) : 0;
    this.appliedRig = undefined;
    this.refresh();
  }

  get previewName(): string {
    return this.previewClip?.name ?? '';
  }

  /** Reposition the preview and its pinned IK targets without authoring rig transforms. */
  moveCharacter(x: number, y: number): void {
    const container = this.puppet.container;
    const before = container.getWorldTransformMatrix();
    const oldX = before.tx;
    const oldY = before.ty;
    container.setPosition(x, y);
    const after = container.getWorldTransformMatrix();
    for (const constraint of this.registeredIK.values()) {
      const target = constraint.target;
      if (target && this.ownsPreviewTarget(constraint.name) && !constraint.targetProvider) {
        constraint.setTarget(target.x + after.tx - oldX, target.y + after.ty - oldY);
        this.previewTargets.set(constraint.name, constraint.target!);
      }
    }
    this.overlay?.invalidate();
    this.update();
    this.onChange();
  }

  getIKTargetEditIssue(id: string): string | undefined {
    return this.overlay?.getIKTargets().find((handle) => handle.id === id)?.disabledReason ?? undefined;
  }

  createIKConstraint(options: CreateIKConstraintOptions): void {
    this.cancelGesture();
    this.state.createIKConstraint(
      options,
      new Map(this.state.workingCopy.bones.map((bone) => [bone.id, this.puppet.getBone(bone.id).pose])),
    );
    this.refresh();
  }

  updateIKConstraint(id: string, patch: IKConstraintPatch): void {
    this.cancelGesture();
    this.state.updateIKConstraint(id, patch);
    this.refresh();
  }

  removeIKConstraint(id: string): void {
    this.cancelGesture();
    this.state.removeIKConstraint(id);
    this.refresh();
  }

  editBone(id: string, field: BoneField, value: number | undefined, notify = true): void {
    this.state.editBone(id, field, value);
    this.refresh(notify);
  }

  editSlot(id: string, field: SlotField, value: number | undefined, notify = true): void {
    this.state.editSlot(id, field, value);
    this.refresh(notify);
  }

  editSprite(id: string, field: SpriteField, value: number | undefined, attachment = false, notify = true): void {
    this.state.editSprite(id, field, value, attachment);
    this.refresh(notify);
  }

  undo(): void {
    this.restoreHistory('undo');
  }
  redo(): void {
    this.restoreHistory('redo');
  }
  private restoreHistory(action: 'undo' | 'redo'): void {
    this.inputController?.endGesture();
    this.actionError = '';
    try {
      if (this.state[action]()) this.refresh();
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error);
      this.onChange();
    }
  }
  resetSelected(): void {
    const selection = this.state.selection;
    if (this.state.resetSelected(selection?.type === 'slot' ? this.getAttachment(selection.id) : undefined))
      this.refresh();
  }
  resetRig(): void {
    this.state.resetRig();
    this.refresh();
  }
  exportRig(saveBaseline = true): RigJsonDefinition {
    return this.state.exportRig(saveBaseline);
  }
  exportJson(saveBaseline = true): string {
    return this.state.exportJson(saveBaseline);
  }

  setIKPreview(enabled: boolean): void {
    this.cancelGesture();
    this.state.ikPreview = enabled;
    this.state.visibility.ik = enabled;
    this.puppet.preparePose();
    for (const chain of this.ikChains) {
      const constraint = this.puppet.getIK(chain.name);
      if (this.hasExternalTarget(constraint)) continue;
      if (enabled && !chain.target) this.pinPreviewTarget(constraint);
      constraint.enabled = enabled && chain.enabled !== false;
    }
    this.puppet.syncPose();
    this.refresh();
  }

  private update(): void {
    this.overlay?.draw();
  }
}
