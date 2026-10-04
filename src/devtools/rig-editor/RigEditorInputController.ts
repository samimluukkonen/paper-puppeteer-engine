import type Phaser from 'phaser';
import type { Puppet } from '../../engine/Puppet.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import { isEditorTypingTarget } from '../shared/editorShortcuts.js';
import { type Point, worldToLocal } from './coordinates.js';
import type { RigEditor } from './RigEditor.js';
import type { RigEditorOverlay } from './RigEditorOverlay.js';

/** Owns canvas gestures, keyboard commands, and their activation lifetime. */
export class RigEditorInputController {
  private panning = false;
  private moved = false;
  private activePointerId: number | undefined;
  private downX = 0;
  private downY = 0;
  private drag: { type: 'bone' | 'slot' | 'sprite' | 'attachment'; id: string; start: Point; value: Point } | undefined;
  private enabled = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly editor: Pick<RigEditor, 'state' | 'editBone' | 'undo' | 'redo' | 'refresh'>,
    private readonly overlay: RigEditorOverlay,
    private readonly onChange: () => void,
    private readonly redraw: () => void,
  ) {}

  private get state() {
    return this.editor.state;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.scene.input.on('pointerdown', this.pointerDown, this);
    this.scene.input.on('pointermove', this.pointerMove, this);
    this.scene.input.on('pointerup', this.pointerUp, this);
    this.scene.input.on('pointerupoutside', this.pointerUp, this);
    this.scene.input.on('wheel', this.wheel, this);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('blur', this.interruptGesture);
    window.addEventListener('pagehide', this.interruptGesture);
    // Capture document visibility changes, including when they do not bubble.
    window.addEventListener('visibilitychange', this.visibilityChanged, true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.endGesture();
    this.scene.input.off('pointerdown', this.pointerDown, this);
    this.scene.input.off('pointermove', this.pointerMove, this);
    this.scene.input.off('pointerup', this.pointerUp, this);
    this.scene.input.off('pointerupoutside', this.pointerUp, this);
    this.scene.input.off('wheel', this.wheel, this);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('blur', this.interruptGesture);
    window.removeEventListener('pagehide', this.interruptGesture);
    window.removeEventListener('visibilitychange', this.visibilityChanged, true);
  }

  /** Commit authored changes once and release pointer ownership after any gesture ending. */
  private endGesture(): void {
    this.panning = false;
    this.activePointerId = undefined;
    this.drag = undefined;
    this.moved = false;
    this.state.endOperation();
  }

  private interruptGesture = (): void => {
    if (this.activePointerId === undefined) return;
    this.endGesture();
    this.onChange();
    this.redraw();
  };

  private visibilityChanged = (): void => {
    if (document.visibilityState === 'hidden') this.interruptGesture();
  };

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
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      if (isEditorTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) this.editor.redo();
      else this.editor.undo();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || isEditorTypingTarget(event.target)) return;
    const selection = this.state.selection;
    if (selection?.type !== 'bone') return;
    const amount = event.shiftKey ? 10 : 1;
    const bone = this.state.getBone(selection.id);
    const gridAmount = this.state.gridSnap ? this.state.gridSnap * (event.shiftKey ? 10 : 1) : amount;
    if (event.key === 'ArrowLeft')
      this.editor.editBone(selection.id, 'x', this.state.snapTranslation((bone.x ?? 0) - gridAmount));
    else if (event.key === 'ArrowRight')
      this.editor.editBone(selection.id, 'x', this.state.snapTranslation((bone.x ?? 0) + gridAmount));
    else if (event.key === 'ArrowUp')
      this.editor.editBone(selection.id, 'y', this.state.snapTranslation((bone.y ?? 0) - gridAmount));
    else if (event.key === 'ArrowDown')
      this.editor.editBone(selection.id, 'y', this.state.snapTranslation((bone.y ?? 0) + gridAmount));
    else if (event.key === ',' || event.key === '<')
      this.editor.editBone(
        selection.id,
        'rotation',
        this.state.snapRotation(
          (bone.rotation ?? 0) -
            (this.state.rotationSnap
              ? ((this.state.rotationSnap * Math.PI) / 180) * (event.shiftKey ? 10 : 1)
              : event.shiftKey
                ? 0.1
                : 0.01),
        ),
      );
    else if (event.key === '.' || event.key === '>')
      this.editor.editBone(
        selection.id,
        'rotation',
        this.state.snapRotation(
          (bone.rotation ?? 0) +
            (this.state.rotationSnap
              ? ((this.state.rotationSnap * Math.PI) / 180) * (event.shiftKey ? 10 : 1)
              : event.shiftKey
                ? 0.1
                : 0.01),
        ),
      );
    else return;
    event.preventDefault();
  };

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.activePointerId !== undefined) return;
    this.activePointerId = pointer.id;
    this.panning = pointer.middleButtonDown();
    this.moved = false;
    this.downX = pointer.x;
    this.downY = pointer.y;
    this.drag = undefined;
    if (this.panning || !pointer.leftButtonDown()) return;
    const selected = this.state.selection;
    const picked = this.overlay.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false);
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
    if (this.drag) this.state.beginOperation();
    this.onChange();
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId || !pointer.isDown) return;
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
      const x = this.state.snapTranslation(value.x + local.x - start.x);
      const y = this.state.snapTranslation(value.y + local.y - start.y);
      if (type === 'bone') {
        this.state.editBoneFields(id, { x, y });
      } else if (type === 'slot') {
        this.state.editSlotFields(id, { x, y });
      } else {
        this.state.editSpriteFields(id, { x, y }, type === 'attachment');
      }
      this.editor.refresh();
      return;
    }
    panCamera(this.scene.cameras.main, pointer.x - pointer.prevPosition.x, pointer.y - pointer.prevPosition.y);
    this.redraw();
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    // Phaser also reports window mouse releases from hierarchy and inspector clicks.
    if (pointer.id !== this.activePointerId) return;
    if (!this.panning && !this.moved && !this.drag) {
      this.state.selection = this.overlay.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false) ?? null;
      this.onChange();
      this.redraw();
    }
    this.endGesture();
    this.onChange();
  }

  private wheel(pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void {
    zoomCameraAt(this.scene.cameras.main, pointer.x, pointer.y, dy);
    this.redraw();
  }
}
