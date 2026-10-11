import Phaser from 'phaser';
import type { RigJsonDefinition } from '../../engine/externalData.js';
import type { TwoBoneIKConstraint } from '../../engine/ik/TwoBoneIKConstraint.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Puppet } from '../../engine/Puppet.js';
import { computeBonePosition, computeRenderOrder } from '../../engine/Rig.js';
import { createTransform, type RigDefinition } from '../../engine/types.js';
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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly onChange: () => void,
    state?: RigEditorState,
    ikChains: readonly TwoBoneIKDefinition[] = [],
  ) {
    this.state = state ?? new RigEditorState(puppet.rig);
    // Authored definitions own same-name preview chains, including their endpoint offsets.
    this.ikChains = ikChains.map((chain) => puppet.rig.ik?.find((authored) => authored.name === chain.name) ?? chain);
  }

  enable(): void {
    if (this.overlay) return;
    this.puppet.resetToBindPose().setFacing('right');
    this.appliedRig = undefined;
    for (const chain of this.ikChains) {
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
    if (this.state.ikPreview) {
      for (const chain of this.ikChains) {
        const constraint = this.puppet.getIK(chain.name);
        if (!constraint.target) constraint.setTarget(this.puppet.getBone(chain.endBone).getWorldPosition());
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
    if (rig !== this.appliedRig) {
      this.applyRig(rig);
      this.appliedRig = rig;
    }
    this.updateArtwork();
    this.overlay?.invalidate();
    this.update();
    if (notify) this.onChange();
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
      if (runtime.sprite && edited.sprite)
        runtime.sprite
          .setPosition(edited.sprite.x ?? 0, edited.sprite.y ?? 0)
          .setOrigin(edited.sprite.originX ?? 0.5, edited.sprite.originY ?? 0.5);
    }
    for (const slot of rig.slots ?? []) {
      this.puppet.setSlotTransform(slot.id, createTransform(slot), false);
      const image = this.puppet.getSlotImage(slot.id);
      const attachmentId = this.puppet.getAttachment(slot.id);
      if (image && attachmentId) {
        const attachment = this.state.getAttachment(attachmentId);
        image
          .setPosition(attachment.x ?? 0, attachment.y ?? 0)
          .setOrigin(attachment.originX ?? 0.5, attachment.originY ?? 0.5);
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
      if (enabled) constraint.setTarget(this.puppet.getBone(chain.endBone).getWorldPosition());
      constraint.enabled = enabled;
    }
    this.puppet.syncPose();
    this.refresh();
  }

  private update(): void {
    this.overlay?.draw();
  }
}
