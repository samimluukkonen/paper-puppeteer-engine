import type Phaser from 'phaser';
import type { Puppet } from '../../engine/Puppet.js';
import { blocksEditorShortcut, historyShortcut, isTypingTarget } from '../../shared/keyboardShortcuts.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import { textureOriginAt } from './artworkAlignment.js';
import { type Affine, type Point, worldToLocal } from './coordinates.js';
import type { RigEditor } from './RigEditor.js';
import type { RigEditorOverlay } from './RigEditorOverlay.js';
import type { RigEditorSelection } from './RigEditorState.js';

/** Owns canvas gestures, keyboard commands, and their activation lifetime. */
export class RigEditorInputController {
  private panning = false;
  private ikHit = false;
  private markerHit = false;
  private markerDrag: { id: string; start: Point; value: Point } | undefined;
  private ikDrag: { start: Point; value: Point } | undefined;
  private moved = false;
  private activePointerId: number | undefined;
  private downX = 0;
  private downY = 0;
  private characterDrag: { start: Point; value: Point } | undefined;
  private drag: { type: 'bone' | 'slot' | 'sprite' | 'attachment'; id: string; start: Point; value: Point } | undefined;
  private originDrag: { id: string; attachment: boolean; matrix: Affine; origin: Point; size: Point } | undefined;
  private artworkFrame: Phaser.GameObjects.Container | undefined;
  private enabled = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly puppet: Puppet,
    private readonly editor: Pick<
      RigEditor,
      'state' | 'editBone' | 'undo' | 'redo' | 'refresh' | 'moveCharacter' | 'previewArtwork' | 'finishArtworkGesture'
    > &
      Partial<Pick<RigEditor, 'previewName' | 'getArtworkOriginScale'>>,
    private readonly overlay: RigEditorOverlay,
    private readonly onChange: () => void,
    private readonly redraw: () => void,
    private readonly claimPointer?: (pointer: Phaser.Input.Pointer) => boolean,
  ) {}

  private get state() {
    return this.editor.state;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.on('pointerdown', this.pointerDown, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.on('pointermove', this.pointerMove, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.on('pointerup', this.pointerUp, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.on('pointerupoutside', this.pointerUp, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
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
    this.endGesture(false);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.off('pointerdown', this.pointerDown, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.off('pointermove', this.pointerMove, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.off('pointerup', this.pointerUp, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.off('pointerupoutside', this.pointerUp, this);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    this.scene.input.off('wheel', this.wheel, this);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('blur', this.interruptGesture);
    window.removeEventListener('pagehide', this.interruptGesture);
    window.removeEventListener('visibilitychange', this.visibilityChanged, true);
  }

  /** Commit authored changes once and release pointer ownership after any gesture ending. */
  endGesture(commit = true): void {
    const hadIKDrag = !!this.ikDrag;
    this.ikDrag = undefined;
    this.ikHit = false;
    this.state.endIKTargetDrag(commit);
    const hadDrag = !!this.drag || !!this.originDrag || !!this.markerDrag;
    this.editor.finishArtworkGesture(commit);
    if (!commit && hadDrag) this.state.cancelOperation();
    this.markerDrag = undefined;
    this.markerHit = false;
    this.panning = false;
    this.activePointerId = undefined;
    this.drag = undefined;
    this.originDrag = undefined;
    this.artworkFrame = undefined;
    this.characterDrag = undefined;
    this.moved = false;
    this.state.endOperation();
    if (hadIKDrag || (!commit && hadDrag)) this.editor.refresh(false);
  }

  private interruptGesture = (): void => {
    if (this.activePointerId === undefined) return;
    this.endGesture(false);
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

  private characterPoint(pointer: Phaser.Input.Pointer): Point | undefined {
    const parent = this.puppet.container.parentContainer;
    return parent ? this.local(pointer, parent) : this.world(pointer);
  }

  private imageContains(pointer: Phaser.Input.Pointer, image: Phaser.GameObjects.Image | undefined): boolean {
    if (!image || image.visible === false || !this.state.visibility.artwork) return false;
    for (let parent = image.parentContainer; parent; parent = parent.parentContainer) {
      if (parent.visible === false) return false;
    }
    const point = worldToLocal(this.world(pointer), image.getWorldTransformMatrix());
    return (
      !!point &&
      point.x >= -image.width * image.originX &&
      point.x <= image.width * (1 - image.originX) &&
      point.y >= -image.height * image.originY &&
      point.y <= image.height * (1 - image.originY)
    );
  }

  private pickArtwork(pointer: Phaser.Input.Pointer, selected: RigEditorSelection): RigEditorSelection {
    const candidates: { selection: NonNullable<RigEditorSelection>; image: Phaser.GameObjects.Image }[] = [];
    for (const bone of this.state.rig.bones) {
      const image = this.puppet.getBone(bone.id).sprite;
      if (bone.sprite && image && this.imageContains(pointer, image))
        candidates.push({ selection: { type: 'bone', id: bone.id }, image });
    }
    for (const slot of this.state.rig.slots) {
      const image = this.puppet.getSlotImage(slot.id);
      if (image && this.imageContains(pointer, image))
        candidates.push({ selection: { type: 'slot', id: slot.id }, image });
    }
    // Keep selected artwork draggable where other artwork or bone lines overlap it.
    const exact = candidates.find(({ selection }) => selection.type === selected?.type && selection.id === selected.id);
    if (exact) return exact.selection;
    const preferred = candidates.filter(
      ({ selection }) =>
        selected?.type === 'bone' && selection.type === 'slot' && this.state.getSlot(selection.id).bone === selected.id,
    );
    const hits = preferred.length ? preferred : candidates;
    // Phaser's container indices describe the actual draw order, including slot depth overrides.
    hits.sort((a, b) => {
      const aIndices = a.image.getIndexList();
      const bIndices = b.image.getIndexList();
      for (let i = 0; i < Math.max(aIndices.length, bIndices.length); i++) {
        const difference = (bIndices[i] ?? -1) - (aIndices[i] ?? -1);
        if (difference) return difference;
      }
      return 0;
    });
    return hits[0]?.selection ?? null;
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (blocksEditorShortcut(event)) return;
    const history = historyShortcut(event);
    if (history) {
      event.preventDefault();
      if (!event.repeat) {
        if (history === 'redo') this.editor.redo();
        else this.editor.undo();
      }
      return;
    }
    if (event.key === 'Escape' && this.activePointerId !== undefined) {
      event.preventDefault();
      this.endGesture(false);
      this.editor.refresh();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    if (event.key === 'Escape') {
      this.state.selection = null;
      this.state.selectedIKConstraintId = null;
      this.state.selectedFootContactMarkerId = null;
      this.editor.refresh();
      event.preventDefault();
      return;
    }
    const selection = this.state.selection;
    if (!selection) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (this.state.editMode !== 'joint') {
      if (!delta) return;
      const amount = (this.state.gridSnap || 1) * (event.shiftKey ? 10 : 1);
      if (this.state.editMode === 'slot') {
        if (selection.type !== 'slot') return;
        if (this.editor.previewName) return;
        const slot = this.state.getSlot(selection.id);
        this.state.editSlotFields(selection.id, {
          x: this.state.snapTranslation((slot.x ?? 0) + delta[0]! * amount),
          y: this.state.snapTranslation((slot.y ?? 0) + delta[1]! * amount),
        });
      } else {
        // Origin keyboard precision uses the inspector's normalized/pixel fields.
        if (this.state.editMode === 'origin') return;
        const attachment = selection.type === 'slot';
        const id = attachment ? this.puppet.getAttachment(selection.id) : selection.id;
        const sprite = id ? (attachment ? this.state.getAttachment(id) : this.state.getBone(id).sprite) : undefined;
        if (!id || !sprite) return;
        this.state.editSpriteFields(
          id,
          {
            x: this.state.snapTranslation((sprite.x ?? 0) + delta[0]! * amount),
            y: this.state.snapTranslation((sprite.y ?? 0) + delta[1]! * amount),
          },
          attachment,
        );
      }
      this.editor.refresh();
      event.preventDefault();
      return;
    }
    if (selection.type !== 'bone') return;
    if (this.editor.previewName) return;
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
    if (this.claimPointer?.(pointer)) return;
    this.activePointerId = pointer.id;
    this.panning = pointer.middleButtonDown();
    this.moved = false;
    this.downX = pointer.x;
    this.downY = pointer.y;
    this.drag = undefined;
    this.characterDrag = undefined;
    if (this.panning || !pointer.leftButtonDown()) return;
    const marker = this.overlay.pickFootContactMarker?.(pointer.x, pointer.y);
    this.markerHit = !!marker;
    if (marker) {
      this.state.selectFootContactMarker(marker.id);
      const start = this.local(pointer, this.puppet.getBone(marker.boneId).container);
      if (start) {
        this.state.endOperation();
        this.state.beginOperation();
        this.markerDrag = { id: marker.id, start, value: { x: marker.localX, y: marker.localY } };
      }
      this.editor.refresh();
      return;
    }
    const ik = this.overlay.pickIKTarget?.(pointer.x, pointer.y);
    this.ikHit = !!ik;
    if (ik) {
      this.state.selectIKConstraint(ik.id);
      const start = this.local(pointer, this.puppet.container);
      if (start && !ik.disabledReason) {
        this.state.beginIKTargetDrag(ik.id);
        this.ikDrag = { start, value: ik.target };
      }
      this.editor.refresh();
      return;
    }
    const selected = this.state.selection;
    const picked = this.overlay.pick(pointer.x, pointer.y, pointer.event?.altKey ?? false);
    const aligning = this.state.editMode === 'sprite' || this.state.editMode === 'origin';
    const artwork = aligning
      ? (this.overlay.pickArtworkPivot?.(pointer.x, pointer.y) ?? this.pickArtwork(pointer, selected))
      : null;
    const target = artwork ?? picked;
    if (!target) {
      const start = this.characterPoint(pointer);
      if (start) this.characterDrag = { start, value: { x: this.puppet.container.x, y: this.puppet.container.y } };
      return;
    }
    this.state.selectedIKConstraintId = null;
    this.state.selectedFootContactMarkerId = null;
    this.state.selection = target;
    if (aligning) {
      const attachment = target.type === 'slot';
      const id = attachment ? this.puppet.getAttachment(target.id) : target.id;
      const image = attachment ? this.puppet.getSlotImage(target.id) : this.puppet.getBone(target.id).sprite;
      const sprite = id ? (attachment ? this.state.getAttachment(id) : this.state.getBone(id).sprite) : undefined;
      if (id && image && sprite) {
        if (this.state.editMode === 'origin') {
          const m = image.getWorldTransformMatrix();
          const originScale = this.editor.getArtworkOriginScale?.() ?? { x: 1, y: 1 };
          this.originDrag = {
            id,
            attachment,
            matrix: { a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty },
            origin: { x: sprite.originX ?? 0.5, y: sprite.originY ?? 0.5 },
            size: { x: image.width * originScale.x, y: image.height * originScale.y },
          };
        } else {
          this.artworkFrame = image.parentContainer;
          const local = this.local(pointer, image.parentContainer);
          if (local)
            this.drag = {
              type: attachment ? 'attachment' : 'sprite',
              id,
              start: local,
              value: { x: sprite.x ?? 0, y: sprite.y ?? 0 },
            };
        }
      }
    } else if (!this.editor.previewName && this.state.editMode === 'slot' && target.type === 'slot') {
      const slot = this.state.getSlot(target.id);
      const local = this.local(pointer, this.puppet.getBone(slot.bone).container);
      if (local) this.drag = { type: 'slot', id: target.id, start: local, value: { x: slot.x ?? 0, y: slot.y ?? 0 } };
    } else if (!this.editor.previewName && this.state.editMode === 'joint' && target.type === 'bone') {
      const bone = this.state.getBone(target.id);
      const local = this.local(pointer, this.puppet.getBone(target.id).container.parentContainer);
      if (local) this.drag = { type: 'bone', id: target.id, start: local, value: { x: bone.x ?? 0, y: bone.y ?? 0 } };
    }
    if (this.drag?.type === 'bone' || this.drag?.type === 'slot') this.state.beginOperation();
    this.editor.refresh();
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId || !pointer.isDown) return;
    if (Math.hypot(pointer.x - this.downX, pointer.y - this.downY) > 4) this.moved = true;
    if (this.markerDrag) {
      if (!this.moved) return;
      const { id, start, value } = this.markerDrag;
      const marker = this.state.getFootContactMarker(id);
      const point = this.local(pointer, this.puppet.getBone(marker.boneId).container);
      if (!point) {
        this.endGesture(false);
        return;
      }
      this.state.updateFootContactMarker(id, {
        localX: this.state.snapTranslation(value.x + point.x - start.x),
        localY: this.state.snapTranslation(value.y + point.y - start.y),
      });
      this.editor.refresh();
      return;
    }
    if (this.ikDrag) {
      if (!this.moved) return;
      const handle = this.overlay.getIKTargets().find((entry) => entry.id === this.state.ikTargetDragId);
      if (!handle || handle.disabledReason) {
        this.endGesture(false);
        return;
      }
      const point = this.local(pointer, this.puppet.container);
      if (!point) {
        this.endGesture(false);
        return;
      }
      const { start, value } = this.ikDrag;
      this.state.moveIKTarget({
        x: this.state.snapTranslation(value.x + point.x - start.x),
        y: this.state.snapTranslation(value.y + point.y - start.y),
      });
      this.editor.refresh();
      return;
    }
    if (this.characterDrag) {
      if (!this.moved) return;
      const local = this.characterPoint(pointer);
      if (!local) return;
      const { start, value } = this.characterDrag;
      this.editor.moveCharacter(value.x + local.x - start.x, value.y + local.y - start.y);
      return;
    }
    if (!this.panning) {
      if (this.originDrag) {
        if (!this.moved) return;
        const { id, attachment, matrix, origin, size } = this.originDrag;
        const point = textureOriginAt(this.world(pointer), matrix, origin, size);
        if (point) this.editor.previewArtwork(id, { originX: point.x, originY: point.y }, attachment);
        return;
      }
      if (!this.drag) return;
      if (!this.moved) return;
      const { type, id, start, value } = this.drag;
      const parent =
        type === 'slot'
          ? this.puppet.getBone(this.state.getSlot(id).bone).container
          : type === 'sprite' || type === 'attachment'
            ? this.artworkFrame!
            : this.puppet.getBone(id).container.parentContainer;
      const local = this.local(pointer, parent);
      if (!local) return;
      const x = this.state.snapTranslation(value.x + local.x - start.x);
      const y = this.state.snapTranslation(value.y + local.y - start.y);
      if (type === 'bone') {
        this.state.editBoneFields(id, { x, y });
      } else if (type === 'slot') {
        this.state.editSlotFields(id, { x, y });
      } else {
        this.editor.previewArtwork(id, { x, y }, type === 'attachment');
        return;
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
    if (!this.panning && !this.moved && !this.drag && !this.originDrag && !this.ikHit && !this.markerHit) {
      this.state.selectedIKConstraintId = null;
      this.state.selectedFootContactMarkerId = null;
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
