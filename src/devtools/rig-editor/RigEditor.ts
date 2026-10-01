import Phaser from 'phaser';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { Puppet } from '../../engine/Puppet.js';
import { type Point, worldToLocal } from './coordinates.js';
import { RigEditorOverlay } from './RigEditorOverlay.js';
import { RigEditorState } from './RigEditorState.js';

export class RigEditor {
  readonly state: RigEditorState;
  private overlay: RigEditorOverlay | undefined;
  private panning = false;
  private moved = false;
  private downX = 0;
  private downY = 0;
  private drag: { type: 'bone' | 'slot' | 'sprite' | 'attachment'; id: string; start: Point; value: Point } | undefined;
  private readonly baseOrder: readonly string[];
  private readonly editedDepths = new Map<string, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly onChange: () => void,
    state?: RigEditorState,
    private readonly ikChains: readonly TwoBoneIKDefinition[] = [],
  ) {
    this.state = state ?? new RigEditorState(puppet.rig);
    this.baseOrder = puppet.getRenderOrder();
  }

  enable(): void {
    if (this.overlay) return;
    this.puppet.resetToBindPose().setFacing('right');
    for (const chain of this.ikChains) {
      const constraint = this.puppet.addIK({ ...chain, enabled: false });
      constraint.enabled = false;
    }
    this.overlay = new RigEditorOverlay(this.scene, this.puppet, this.state, this.ikChains);
    this.scene.input.on('pointerdown', this.pointerDown, this);
    this.scene.input.on('pointermove', this.pointerMove, this);
    this.scene.input.on('pointerup', this.pointerUp, this);
    this.scene.input.on('wheel', this.wheel, this);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    window.addEventListener('keydown', this.keyDown);
    this.update();
  }

  disable(): void {
    if (!this.overlay) return;
    this.scene.input.off('pointerdown', this.pointerDown, this);
    this.scene.input.off('pointermove', this.pointerMove, this);
    this.scene.input.off('pointerup', this.pointerUp, this);
    this.scene.input.off('wheel', this.wheel, this);
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    window.removeEventListener('keydown', this.keyDown);
    this.overlay.destroy();
    this.overlay = undefined;
  }

  refresh(notify = true): void {
    this.puppet.preparePose();
    for (const bone of this.state.rig.bones) {
      const edited = this.state.getBone(bone.id);
      const runtime = this.puppet.getBone(bone.id);
      Object.assign(runtime.pose, {
        x: edited.x ?? 0,
        y: edited.y ?? 0,
        rotation: edited.rotation ?? 0,
        scaleX: edited.scaleX ?? 1,
        scaleY: edited.scaleY ?? 1,
      });
      const sprite = runtime.sprite;
      if (sprite && edited.sprite) {
        sprite
          .setPosition(edited.sprite.x ?? 0, edited.sprite.y ?? 0)
          .setOrigin(edited.sprite.originX ?? 0.5, edited.sprite.originY ?? 0.5);
        const dim = this.state.dimUnselected && this.state.selection?.id !== bone.id;
        sprite.setAlpha(this.state.visibility.artwork ? this.state.artworkOpacity * (dim ? 0.18 : 1) : 0);
      }
    }
    for (const slot of this.state.rig.slots) {
      const edited = this.state.getSlot(slot.id);
      this.puppet.setSlotTransform(slot.id, edited);
      if (edited.depth !== undefined) this.puppet.setSlotDepth(slot.id, edited.depth);
      const image = this.puppet.getSlotImage(slot.id);
      const attachmentId = this.puppet.getAttachment(slot.id);
      if (image && attachmentId) {
        const attachment = this.state.getAttachment(attachmentId);
        image
          .setPosition(attachment.x ?? 0, attachment.y ?? 0)
          .setOrigin(attachment.originX ?? 0.5, attachment.originY ?? 0.5);
        const dim = this.state.dimUnselected && this.state.selection?.id !== slot.id;
        image.setAlpha(this.state.visibility.artwork ? this.state.artworkOpacity * (dim ? 0.18 : 1) : 0);
      }
    }
    if (this.editedDepths.size) {
      const order = [...this.baseOrder].sort(
        (a, b) =>
          (this.editedDepths.get(a) ?? this.baseOrder.indexOf(a) * 10) -
          (this.editedDepths.get(b) ?? this.baseOrder.indexOf(b) * 10),
      );
      this.puppet.setRenderOrder(order);
      for (const slot of this.state.rig.slots) {
        const edited = this.state.getSlot(slot.id);
        if (edited.depth !== undefined) this.puppet.setSlotDepth(slot.id, edited.depth);
      }
    }
    this.puppet.syncPose();
    this.update();
    if (notify) this.onChange();
  }

  getAttachment(id: string): string | undefined {
    return this.puppet.getAttachment(id);
  }

  editBone(
    id: string,
    field: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'length' | 'depth',
    value: number,
    notify = true,
  ): void {
    this.state.editBone(id, field, value);
    if (field === 'depth') this.editedDepths.set(id, value);
    this.refresh(notify);
  }

  editSlot(
    id: string,
    field: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'depth',
    value: number,
    notify = true,
  ): void {
    this.state.editSlot(id, field, value);
    this.refresh(notify);
  }

  editSprite(
    id: string,
    field: 'x' | 'y' | 'originX' | 'originY',
    value: number,
    attachment = false,
    notify = true,
  ): void {
    this.state.editSprite(id, field, value, attachment);
    this.refresh(notify);
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

  private world(pointer: Phaser.Input.Pointer): Point {
    return this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  private local(pointer: Phaser.Input.Pointer, parent: Phaser.GameObjects.Container): Point | undefined {
    return worldToLocal(this.world(pointer), parent.getWorldTransformMatrix());
  }

  private imageContains(pointer: Phaser.Input.Pointer, image: Phaser.GameObjects.Image | undefined): boolean {
    if (!image) return false;
    const point = worldToLocal(this.world(pointer), image.getWorldTransformMatrix());
    return (
      !!point &&
      point.x >= -image.width * image.originX &&
      point.x <= image.width * (1 - image.originX) &&
      point.y >= -image.height * image.originY &&
      point.y <= image.height * (1 - image.originY)
    );
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      /^(INPUT|SELECT|TEXTAREA)$/.test((event.target as HTMLElement)?.tagName ?? '')
    )
      return;
    const selection = this.state.selection;
    if (selection?.type !== 'bone') return;
    const amount = event.shiftKey ? 10 : 1;
    const bone = this.state.getBone(selection.id);
    if (event.key === 'ArrowLeft') this.editBone(selection.id, 'x', (bone.x ?? 0) - amount);
    else if (event.key === 'ArrowRight') this.editBone(selection.id, 'x', (bone.x ?? 0) + amount);
    else if (event.key === 'ArrowUp') this.editBone(selection.id, 'y', (bone.y ?? 0) - amount);
    else if (event.key === 'ArrowDown') this.editBone(selection.id, 'y', (bone.y ?? 0) + amount);
    else if (event.key === ',' || event.key === '<')
      this.editBone(selection.id, 'rotation', (bone.rotation ?? 0) - (event.shiftKey ? 0.1 : 0.01));
    else if (event.key === '.' || event.key === '>')
      this.editBone(selection.id, 'rotation', (bone.rotation ?? 0) + (event.shiftKey ? 0.1 : 0.01));
    else return;
    event.preventDefault();
  };

  private update(): void {
    this.overlay?.draw();
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    this.panning = pointer.middleButtonDown();
    this.moved = false;
    this.downX = pointer.x;
    this.downY = pointer.y;
    this.drag = undefined;
    if (this.panning || !pointer.leftButtonDown()) return;
    const selected = this.state.selection;
    const picked = this.overlay?.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false);
    const target = picked ?? selected;
    if (!target) return;
    const image = target.type === 'bone' ? this.puppet.getBone(target.id).sprite : this.puppet.getSlotImage(target.id);
    if (!picked && !(this.state.editMode === 'sprite' && this.imageContains(pointer, image))) return;
    if (picked) this.state.selection = picked;
    const parent =
      target.type === 'slot'
        ? this.puppet.getBone(this.state.getSlot(target.id).bone).container
        : this.puppet.getBone(target.id).container.parentContainer!;
    const local = this.local(pointer, parent);
    if (!local) return;
    if (target.type === 'slot' && this.state.editMode === 'sprite' && !picked && this.imageContains(pointer, image)) {
      const attachmentId = this.puppet.getAttachment(target.id);
      const attachment = attachmentId ? this.state.getAttachment(attachmentId) : undefined;
      const mount = image?.parentContainer;
      const inMount = mount ? this.local(pointer, mount) : undefined;
      if (attachment && inMount)
        this.drag = {
          type: 'attachment',
          id: attachmentId!,
          start: inMount,
          value: { x: attachment.x ?? 0, y: attachment.y ?? 0 },
        };
    } else if (target.type === 'slot') {
      const slot = this.state.getSlot(target.id);
      this.drag = { type: 'slot', id: target.id, start: local, value: { x: slot.x ?? 0, y: slot.y ?? 0 } };
    } else if (this.state.editMode === 'sprite' && this.state.getBone(target.id).sprite) {
      const sprite = this.state.getBone(target.id).sprite!;
      const inBone = this.local(pointer, this.puppet.getBone(target.id).container);
      if (inBone)
        this.drag = { type: 'sprite', id: target.id, start: inBone, value: { x: sprite.x ?? 0, y: sprite.y ?? 0 } };
    } else if (this.state.editMode === 'joint') {
      const bone = this.state.getBone(target.id);
      this.drag = { type: 'bone', id: target.id, start: local, value: { x: bone.x ?? 0, y: bone.y ?? 0 } };
    }
    this.onChange();
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.isDown) return;
    if (Math.hypot(pointer.x - this.downX, pointer.y - this.downY) > 4) this.moved = true;
    if (!this.panning) {
      if (!this.drag) return;
      const { type, id, start, value } = this.drag;
      const parent =
        type === 'slot'
          ? this.puppet.getBone(this.state.getSlot(id).bone).container
          : type === 'sprite'
            ? this.puppet.getBone(id).container
            : type === 'attachment'
              ? this.puppet.getSlotImage(this.state.selection!.id)!.parentContainer!
              : this.puppet.getBone(id).container.parentContainer!;
      const local = this.local(pointer, parent);
      if (!local) return;
      const x = value.x + local.x - start.x;
      const y = value.y + local.y - start.y;
      if (type === 'bone') {
        this.state.editBone(id, 'x', x);
        this.state.editBone(id, 'y', y);
      } else if (type === 'slot') {
        this.state.editSlot(id, 'x', x);
        this.state.editSlot(id, 'y', y);
      } else {
        this.state.editSprite(id, 'x', x, type === 'attachment');
        this.state.editSprite(id, 'y', y, type === 'attachment');
      }
      this.refresh();
      return;
    }
    const camera = this.scene.cameras.main;
    camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
    camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    this.update();
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.panning && !this.moved && !this.drag) {
      this.state.selection = this.overlay?.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false) ?? null;
      this.onChange();
      this.update();
    }
    this.panning = false;
    this.drag = undefined;
    this.state.validate();
  }

  private wheel(pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void {
    const camera = this.scene.cameras.main;
    const oldZoom = camera.zoom;
    const nextZoom = Phaser.Math.Clamp(oldZoom * Math.exp(-dy * 0.001), 0.35, 4);
    camera.scrollX += (pointer.x - camera.width / 2) * (1 / oldZoom - 1 / nextZoom);
    camera.scrollY += (pointer.y - camera.height / 2) * (1 / oldZoom - 1 / nextZoom);
    camera.setZoom(nextZoom);
    this.update();
  }
}
