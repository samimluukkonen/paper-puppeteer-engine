import Phaser from 'phaser';
import type { CompiledClip } from '../../engine/AnimationClip.js';
import { evaluateClip } from '../../engine/AnimationPose.js';
import type { RigJsonDefinition } from '../../engine/externalData.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Puppet } from '../../engine/Puppet.js';
import { computeBonePosition, computeRenderOrder } from '../../engine/Rig.js';
import { createTransform, type RigDefinition } from '../../engine/types.js';
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
  private readonly ikChains: readonly TwoBoneIKDefinition[];
  private artworkDraft: { id: string; attachment: boolean; values: Partial<Record<SpriteField, number>> } | undefined;
  private previewClip: CompiledClip | undefined;
  private appliedCatalog: RigDefinition | undefined;
  private appliedSkins: readonly import('../../engine/types.js').SkinDefinition[] | undefined;
  previewTime = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly onChange: () => void,
    state?: RigEditorState,
    ikChains: readonly TwoBoneIKDefinition[] = [],
    private readonly initialPreviewClips: readonly CompiledClip[] = [],
    /** Embedded editors supply the evaluated animation/IK pose after rig projection. */
    private readonly evaluateContext?: () => void,
    private readonly currentPreviewClips?: () => readonly CompiledClip[],
  ) {
    this.state = state ?? new RigEditorState(puppet.rig);
    // Authored definitions own same-name preview chains, including their endpoint offsets.
    this.ikChains = ikChains.map((chain) => puppet.rig.ik?.find((authored) => authored.name === chain.name) ?? chain);
  }

  get previewClips(): readonly CompiledClip[] {
    return this.currentPreviewClips?.() ?? this.initialPreviewClips;
  }

  enable(): void {
    if (this.overlay) return;
    if (!this.evaluateContext) this.puppet.resetToBindPose().setFacing(this.state.facing);
    this.appliedRig = undefined;
    for (const chain of this.evaluateContext ? [] : this.ikChains) {
      let constraint = this.registeredIK.get(chain.name);
      if (!constraint) {
        constraint = this.puppet.rig.ik?.some((authored) => authored.name === chain.name)
          ? this.puppet.getIK(chain.name)
          : this.puppet.addIK({ ...chain, enabled: false });
        this.registeredIK.set(chain.name, constraint);
      }
      constraint.enabled = false;
    }
    this.overlay = new RigEditorOverlay(this.scene, this.puppet, this.state, this.ikChains);
    this.inputController = new RigEditorInputController(
      this.scene,
      this.puppet,
      this,
      this.overlay,
      this.onChange,
      () => this.update(),
    );
    this.inputController.enable();
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    // Activation must project retained edits before drawing or capturing IK targets.
    this.refresh(false);
    if (this.state.ikPreview && !this.evaluateContext) {
      for (const chain of this.ikChains) {
        const constraint = this.puppet.getIK(chain.name);
        if (!constraint.target) constraint.setTarget(ikPreviewTarget(this.puppet, constraint));
        constraint.enabled = true;
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
    this.syncAttachments();
    if (rig !== this.appliedRig) {
      if (
        !this.appliedRig ||
        !equalEditorData(rig.bones, this.appliedRig.bones) ||
        !equalEditorData(rig.slots, this.appliedRig.slots)
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
    // Editor sessions preserve topology; only authored depths affect draw order.
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
      if (target) constraint.setTarget(target.x + after.tx - oldX, target.y + after.ty - oldY);
    }
    this.overlay?.invalidate();
    this.update();
    this.onChange();
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
    this.inputController?.endGesture();
    if (this.state.undo()) this.refresh();
  }
  redo(): void {
    this.inputController?.endGesture();
    if (this.state.redo()) this.refresh();
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
    this.state.ikPreview = enabled;
    this.state.visibility.ik = enabled;
    this.puppet.preparePose();
    for (const chain of this.ikChains) {
      const constraint = this.puppet.getIK(chain.name);
      if (enabled) constraint.setTarget(ikPreviewTarget(this.puppet, constraint));
      constraint.enabled = enabled;
    }
    this.puppet.syncPose();
    this.refresh();
  }

  private update(): void {
    this.overlay?.draw();
  }
}
